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

export type PushOpts = { emails: string[]; title: string; body?: string; url?: string; tag?: string; skipIfActiveMs?: number };

/** Sends a notification to every device the given people have turned on. Best effort: never throws, and removes devices that have gone away. */
export async function sendPush(o: PushOpts): Promise<{ sent: number }> {
  try {
    const emails = [...new Set(o.emails.map((e) => (e || '').trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return { sent: 0 };
    const db = admin();
    let targets = emails;
    if (o.skipIfActiveMs) {
      // someone looking at the portal right now doesn't need a pop-up
      const since = Date.now() - o.skipIfActiveMs;
      const [{ data: st }, { data: stu }] = await Promise.all([
        db.from('portal_staff').select('email, last_seen_at').in('email', emails),
        db.from('portal_student_seen').select('email, last_active_at').in('email', emails),
      ]);
      const active = new Set([...(st || []).filter((r) => r.last_seen_at && new Date(r.last_seen_at).getTime() > since).map((r) => r.email), ...(stu || []).filter((r) => new Date(r.last_active_at).getTime() > since).map((r) => r.email)]);
      targets = emails.filter((e) => !active.has(e));
    }
    if (!targets.length) return { sent: 0 };
    const { data: subs } = await db.from('portal_push_subs').select('id, endpoint, p256dh, auth').in('email', targets);
    if (!subs?.length) return { sent: 0 };
    const k = await vapid();
    webpush.setVapidDetails(process.env.PUSH_SUBJECT || site(), k.publicKey, k.privateKey);
    const payload = JSON.stringify({ title: o.title.slice(0, 80), body: (o.body || '').slice(0, 160), url: o.url || '/', tag: o.tag || 'portal' });
    let sent = 0; const dead: string[] = [], ok: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'normal' }); sent++; ok.push(s.id); }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.push(s.id); }
    }));
    if (dead.length) await db.from('portal_push_subs').delete().in('id', dead);
    if (ok.length) await db.from('portal_push_subs').update({ last_ok_at: new Date().toISOString() }).in('id', ok);
    return { sent };
  } catch { return { sent: 0 }; }
}
