import webpush from 'web-push';
import { admin } from './supabase';
import { site } from './emailTemplate';

/** Signing keys: taken from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if you set them, otherwise created once and kept in the database (service role only). */
let cached: { publicKey: string; privateKey: string } | null = null;
export async function vapid(): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached;
  const envPub = process.env.VAPID_PUBLIC_KEY, envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) return (cached = { publicKey: envPub, privateKey: envPriv });
  const db = admin();
  let { data } = await db.from('portal_push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (!data) {
    const k = webpush.generateVAPIDKeys();
    await db.from('portal_push_config').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
    ({ data } = await db.from('portal_push_config').select('public_key, private_key').eq('id', 1).maybeSingle());
  }
  if (!data) throw new Error('Could not load push keys');
  return (cached = { publicKey: data.public_key, privateKey: data.private_key });
}

export type PushOpts = { emails: string[]; title: string; body?: string; url?: string; tag?: string; skipIfActiveMs?: number; calmMs?: number; ignorePrefs?: boolean };

type Note = { email: string; result: string; detail?: string };

/** Sends a notification to every device the given people have turned on. Best effort: never throws, and removes devices that have gone away. Every decision is written to portal_push_log. */
export async function sendPush(o: PushOpts): Promise<{ sent: number }> {
  const notes: Note[] = [];
  const db = admin();
  const note = (emails: string[], result: string, detail?: string) => emails.forEach((email) => notes.push({ email, result, detail }));
  try {
    const emails = [...new Set(o.emails.map((e) => (e || '').trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return { sent: 0 };
    let targets = emails;
    if (o.skipIfActiveMs) {
      // someone looking at the portal right now doesn't need a pop-up
      const since = Date.now() - o.skipIfActiveMs;
      const [{ data: st }, { data: stu }] = await Promise.all([
        db.from('portal_staff').select('email, last_seen_at').in('email', emails),
        db.from('portal_student_seen').select('email, last_active_at').in('email', emails),
      ]);
      const active = new Set([...(st || []).filter((r) => r.last_seen_at && new Date(r.last_seen_at).getTime() > since).map((r) => r.email), ...(stu || []).filter((r) => new Date(r.last_active_at).getTime() > since).map((r) => r.email)]);
      note(emails.filter((e) => active.has(e)), 'skipped_active', 'was using the portal in the last few seconds');
      targets = emails.filter((e) => !active.has(e));
    }
    // each person's own setting: 'off' = nothing, 'every' (default, like WhatsApp) = every message, 'first' = calm
    const every = new Set<string>();
    if (!o.ignorePrefs && targets.length) {
      const { data: prefs } = await db.from('portal_push_prefs').select('email, mode').in('email', targets);
      const mode = new Map((prefs || []).map((p) => [p.email as string, p.mode as string]));
      note(targets.filter((e) => mode.get(e) === 'off'), 'skipped_off', 'turned phone alerts off');
      targets = targets.filter((e) => mode.get(e) !== 'off');
      for (const e of targets) if (mode.get(e) !== 'first') every.add(e);
    }
    if (!targets.length) return { sent: 0 };
    // only people with a device turned on count: otherwise the calm window would be used up by messages nobody could receive
    const { data: subs } = await db.from('portal_push_subs').select('id, email, endpoint, p256dh, auth').in('email', targets);
    const withDevice = new Set((subs || []).map((x) => x.email as string));
    note(targets.filter((e) => !withDevice.has(e)), 'no_device', 'no phone or browser has alerts turned on');
    targets = targets.filter((e) => withDevice.has(e));
    if (!subs?.length || !targets.length) return { sent: 0 };
    // calm mode: after one notification for a conversation, further ones wait until `calmMs` has passed
    const extra = new Map<string, number>();
    if (o.calmMs && o.tag) {
      const calm = targets.filter((e) => !every.has(e));
      const { data: rows } = await db.from('portal_push_throttle').select('email, last_sent_at, suppressed').eq('tag', o.tag).in('email', calm);
      const now = Date.now(), quiet: string[] = targets.filter((e) => every.has(e));
      for (const e of calm) {
        const r = (rows || []).find((x) => x.email === e);
        if (r && now - new Date(r.last_sent_at).getTime() < o.calmMs) { note([e], 'skipped_quiet', 'inside the quiet period'); await db.from('portal_push_throttle').update({ suppressed: r.suppressed + 1 }).eq('email', e).eq('tag', o.tag); }
        else { quiet.push(e); if (r?.suppressed) extra.set(e, r.suppressed); }
      }
      targets = quiet;
      if (targets.length) await db.from('portal_push_throttle').upsert(targets.filter((e) => !every.has(e)).map((e) => ({ email: e, tag: o.tag!, last_sent_at: new Date().toISOString(), suppressed: 0 })), { onConflict: 'email,tag' });
    }
    if (!targets.length) return { sent: 0 };
    const send = subs.filter((x) => targets.includes(x.email as string));
    const k = await vapid();
    webpush.setVapidDetails(process.env.PUSH_SUBJECT || site(), k.publicKey, k.privateKey);
    const more = Math.max(0, ...[...extra.values()]);
    const payload = JSON.stringify({ title: o.title.slice(0, 80), body: (more ? `${more + 1} new messages. Latest: ${o.body || ''}` : o.body || '').slice(0, 160), url: o.url || '/', tag: o.tag || 'portal' });
    let sent = 0; const dead: string[] = [], ok: string[] = [];
    await Promise.all(send.map(async (s) => {
      try {
        // high urgency + a day to live: the phone wakes for it straight away, and still gets it if it was off or out of signal for a while
        const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
        sent++; ok.push(s.id); note([s.email as string], 'sent', `accepted by the push service (HTTP ${r.statusCode})`);
      } catch (e) {
        const x = e as { statusCode?: number; body?: string; message?: string };
        if (x.statusCode === 404 || x.statusCode === 410) dead.push(s.id);
        note([s.email as string], 'failed', `HTTP ${x.statusCode ?? '?'} ${(x.body || x.message || '').toString().slice(0, 160)}`);
      }
    }));
    if (dead.length) await db.from('portal_push_subs').delete().in('id', dead);
    if (ok.length) await db.from('portal_push_subs').update({ last_ok_at: new Date().toISOString() }).in('id', ok);
    return { sent };
  } catch (e) { note(o.emails.map((x) => (x || '').trim().toLowerCase()).filter(Boolean), 'error', ((e as Error).message || 'unknown').slice(0, 160)); return { sent: 0 }; }
  finally {
    if (notes.length) { try { await db.from('portal_push_log').insert(notes.map((n) => ({ email: n.email, tag: o.tag || null, result: n.result, detail: n.detail || null }))); } catch { /* the log is optional */ } }
  }
}
