import { after } from 'next/server';
import { admin } from './supabase';
import { sendPush } from './push';
import { addNotice } from './notices';
import { counselorKey } from './docs';
import { canAccessApp, currentStaff } from './auth';
import { currentStudent } from './student';
import { shownName } from './profile';
import type { Actor } from './thread';
import type { CallKind, CallSignal, CallStatus, CallView } from './callTypes';

export type { CallKind, CallSignal, CallStatus, CallView } from './callTypes';

type Row = {
  id: string; student_email: string; application_id: string; kind: CallKind; caller: 'student' | 'staff'; caller_email: string;
  staff_email: string | null; status: CallStatus; created_at: string; answered_at: string | null; ended_at: string | null; beat_at: string; end_reason: string | null;
};
const COLS = 'id, student_email, application_id, kind, caller, caller_email, staff_email, status, created_at, answered_at, ended_at, beat_at, end_reason';
const RING_MS = 45_000;   // how long it rings before it counts as missed
const BEAT_MS = 45_000;   // a live call with nobody checking in for this long is over
const MAX_SIGNAL = 24_000, MAX_SIGNALS = 300, MAX_PER_HOUR = 12;
const LIVE = ['ringing', 'active'];
const missing = (m?: string) => /does not exist|schema cache|portal_calls/i.test(m || '');

/** Who may see this call: the student; the staff member on it; and, while a student's call is still ringing, any staff who can see that student. */
function visible(a: Actor, c: Row): boolean {
  if (c.student_email !== a.studentEmail) return false;
  if (a.role === 'student') return true;
  if (c.staff_email) return c.staff_email === a.email;
  return c.caller === 'student' && c.status === 'ringing';
}
const view = (a: Actor, c: Row): CallView => ({ id: c.id, kind: c.kind, status: c.status, mine: c.caller === a.role, caller: c.caller, answeredAt: c.answered_at });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Puts a line in the chat ("Voice call · 2:31", "Missed voice call") so both sides keep a record. Never throws. */
async function logCall(c: Row) {
  try {
    const label = c.kind === 'video' ? 'video call' : 'voice call';
    const secs = c.answered_at && c.ended_at ? Math.max(0, Math.round((new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) / 1000)) : 0;
    const body = c.status === 'declined' ? `${label[0].toUpperCase()}${label.slice(1)} declined`
      : c.answered_at ? `${label[0].toUpperCase()}${label.slice(1)} · ${mmss(secs)}` : `Missed ${label}`;
    const now = new Date().toISOString();
    await admin().from('portal_student_msgs').insert({
      student_email: c.student_email, application_id: c.application_id, from_student: c.caller === 'student', sender_email: c.caller_email, body,
      ...(c.caller === 'student' ? { student_read_at: now } : { staff_read_at: now }),
    });
    if (c.caller === 'staff' && !c.answered_at && c.status === 'missed') {
      await addNotice({ email: c.student_email, applicationId: c.application_id, kind: 'message', title: `Missed ${label} from your counselor`, href: '/student/messages', by: c.caller_email });
    }
  } catch { /* the chat line is a nicety */ }
}

/** Moves a live call to its final state exactly once (whoever gets there first writes the chat line). */
async function finish(c: Row, status: CallStatus, reason: string): Promise<Row | null> {
  const { data } = await admin().from('portal_calls').update({ status, end_reason: reason, ended_at: new Date().toISOString() }).eq('id', c.id).in('status', LIVE).select(COLS).maybeSingle();
  if (!data) return null;
  await logCall(data as Row);
  return data as Row;
}

/** Ringing too long = missed; a live call nobody is checking in on = over. */
async function settle(c: Row): Promise<Row> {
  const now = Date.now();
  if (c.status === 'ringing' && now - new Date(c.created_at).getTime() > RING_MS) return (await finish(c, 'missed', 'no_answer')) || { ...c, status: 'missed' };
  if (c.status === 'active' && now - new Date(c.beat_at).getTime() > BEAT_MS) return (await finish(c, 'ended', 'lost')) || { ...c, status: 'ended' };
  return c;
}

async function liveFor(studentEmail: string): Promise<Row | null> {
  const { data } = await admin().from('portal_calls').select(COLS).eq('student_email', studentEmail).in('status', LIVE).order('created_at', { ascending: false }).limit(1);
  const c = (data?.[0] as Row | undefined) || null;
  if (!c) return null;
  const s = await settle(c);
  return LIVE.includes(s.status) ? s : null;
}

/** The call (if any) this person should be offered right now. Used by the chat's regular refresh. */
export async function currentCall(a: Actor): Promise<CallView | null> {
  try { const c = await liveFor(a.studentEmail); return c && visible(a, c) ? view(a, c) : null; } catch { return null; }
}

export type RingView = { call: CallView; appId: string; peer: { name: string; avatar: { name: string; url: string | null; color: string | null } | null } };

/** A call that is ringing for this person right now, on whatever page they are on. Staff see students' calls for students they can see; students see their counselor's. */
export async function ringingFor(): Promise<RingView | null> {
  try {
    const db = admin();
    const staff = await currentStaff();
    if (staff) {
      const { data } = await db.from('portal_calls').select(COLS).eq('status', 'ringing').eq('caller', 'student').order('created_at', { ascending: false }).limit(10);
      for (const row of (data || []) as Row[]) {
        const c = await settle(row);
        if (c.status !== 'ringing' || !(await canAccessApp(staff, c.application_id))) continue;
        const a: Actor = { role: 'staff', email: staff.email, appId: c.application_id, studentEmail: c.student_email, staff };
        if (!visible(a, c)) continue;
        const { data: ap } = await db.from('portal_applications').select('name').eq('application_id', c.application_id).maybeSingle();
        return { call: view(a, c), appId: c.application_id, peer: { name: (ap?.name || 'Student').trim(), avatar: null } };
      }
      return null;
    }
    const me = await currentStudent();
    if (!me) return null;
    const c = await liveFor(me.email);
    if (!c || c.status !== 'ringing' || c.caller !== 'staff') return null;
    const a: Actor = { role: 'student', email: me.email, appId: c.application_id, studentEmail: me.email };
    const { data: st } = await db.from('portal_staff').select('email, display_name, avatar_url, color').eq('email', c.caller_email).maybeSingle();
    const name = (st?.display_name || '').trim() || 'Your counselor';
    return { call: view(a, c), appId: c.application_id, peer: { name, avatar: { name, url: st?.avatar_url || null, color: st?.color || null } } };
  } catch { return null; }
}

async function ring(c: Row, callerName: string) {
  try {
    const db = admin();
    const text = c.kind === 'video' ? 'video call' : 'voice call';
    if (c.caller === 'staff') {
      await sendPush({ emails: [c.student_email], title: `${callerName} is calling`, body: `Incoming ${text}. Tap to answer.`, url: '/student/messages', tag: `call-${c.id}`, ring: true });
    } else {
      const { data: ap } = await db.from('portal_applications').select('counselor').eq('application_id', c.application_id).maybeSingle();
      const { data: co } = ap?.counselor ? await db.from('portal_counselors').select('email').eq('name_key', counselorKey(ap.counselor)).maybeSingle() : { data: null };
      let to = co?.email ? [co.email] : [];
      if (!to.length) { const { data: ad } = await db.from('portal_staff').select('email').eq('role', 'admin'); to = (ad || []).map((x) => x.email); }
      await sendPush({ emails: to, title: `${callerName} is calling`, body: `Incoming ${text}. Tap to answer.`, url: `/applications/${encodeURIComponent(c.application_id)}?tab=messages`, tag: `call-${c.id}`, ring: true });
    }
  } catch { /* the call still rings for anyone with the chat open */ }
}

export async function startCall(a: Actor, kind: CallKind): Promise<{ ok: true; call: CallView } | { ok: false; error: string }> {
  try {
    const db = admin();
    const live = await liveFor(a.studentEmail);
    if (live) {
      if (visible(a, live) && live.caller === a.role && (a.role === 'student' || live.staff_email === a.email)) return { ok: true, call: view(a, live) };
      return { ok: false, error: live.status === 'ringing' ? 'There’s already a call ringing.' : 'A call is already in progress.' };
    }
    const { count } = await db.from('portal_calls').select('id', { count: 'exact', head: true }).eq('caller_email', a.email).gte('created_at', new Date(Date.now() - 3600_000).toISOString());
    if ((count || 0) >= MAX_PER_HOUR) return { ok: false, error: 'That’s a lot of calls in an hour. Try again a little later.' };
    const { data, error } = await db.from('portal_calls').insert({
      student_email: a.studentEmail, application_id: a.appId, kind, caller: a.role, caller_email: a.email, staff_email: a.role === 'staff' ? a.email : null,
    }).select(COLS).single();
    if (error || !data) return { ok: false, error: missing(error?.message) ? 'Calling isn’t switched on yet. An admin needs to finish the one-time calling setup.' : 'Could not start the call.' };
    const c = data as Row;
    let name = 'Your counselor';
    if (a.role === 'staff') name = (a.staff && shownName(a.staff)) || name;
    else { const { data: ap } = await db.from('portal_applications').select('name').eq('application_id', a.appId).maybeSingle(); name = (ap?.name || 'A student').split(/[\s,]+/).filter(Boolean)[0] || 'A student'; }
    after(() => ring(c, name));
    return { ok: true, call: view(a, c) };
  } catch { return { ok: false, error: 'Could not start the call.' }; }
}

async function load(a: Actor, id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin().from('portal_calls').select(COLS).eq('id', id).maybeSingle();
  return data && (data as Row).student_email === a.studentEmail ? await settle(data as Row) : null;
}

export async function answerCall(a: Actor, id: string): Promise<{ ok: boolean; error?: string; call?: CallView }> {
  const c = await load(a, id);
  if (!c || !visible(a, c) || c.caller === a.role) return { ok: false, error: 'That call is no longer there.' };
  if (c.status !== 'ringing') return { ok: false, error: c.status === 'active' ? 'Someone already picked up.' : 'The call has ended.' };
  const now = new Date().toISOString();
  const { data } = await admin().from('portal_calls').update({ status: 'active', answered_at: now, beat_at: now, staff_email: a.role === 'staff' ? a.email : c.staff_email }).eq('id', id).eq('status', 'ringing').select(COLS).maybeSingle();
  return data ? { ok: true, call: view(a, data as Row) } : { ok: false, error: 'Someone already picked up.' };
}

/** A student turning a counselor's call down ends it. A staff member dismissing a student's call only hides it for themselves, so a colleague can still pick up. */
export async function declineCall(a: Actor, id: string): Promise<{ ok: boolean }> {
  const c = await load(a, id);
  if (c && a.role === 'student' && c.caller === 'staff' && c.status === 'ringing') await finish(c, 'declined', 'declined');
  return { ok: true };
}

export async function endCall(a: Actor, id: string): Promise<{ ok: boolean }> {
  const c = await load(a, id);
  if (!c || !visible(a, c)) return { ok: true };
  if (c.status === 'ringing') { if (c.caller === a.role) await finish(c, 'missed', 'cancelled'); else await declineCall(a, id); }
  else if (c.status === 'active') await finish(c, 'ended', 'hangup');
  return { ok: true };
}

export async function addSignal(a: Actor, id: string, kind: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!['offer', 'answer', 'ice'].includes(kind)) return { ok: false, error: 'Bad signal.' };
  if (JSON.stringify(data ?? null).length > MAX_SIGNAL) return { ok: false, error: 'Signal too large.' };
  const c = await load(a, id);
  if (!c || !visible(a, c) || !LIVE.includes(c.status)) return { ok: false, error: 'That call is over.' };
  if (a.role === 'staff' && c.staff_email !== a.email) return { ok: false, error: 'Pick up the call first.' };
  const db = admin();
  const { count } = await db.from('portal_call_signals').select('id', { count: 'exact', head: true }).eq('call_id', id);
  if ((count || 0) >= MAX_SIGNALS) return { ok: false, error: 'Too many signals.' };
  const { error } = await db.from('portal_call_signals').insert({ call_id: id, from_role: a.role, kind, data: data ?? {} });
  return error ? { ok: false, error: 'Could not send.' } : { ok: true };
}

/** What the other side has sent since `after`, and whether the call is still on. Doubles as the "I'm still here" heartbeat. */
export async function pollCall(a: Actor, id: string, after: number): Promise<{ ok: boolean; call: CallView | null; signals: CallSignal[] }> {
  const c = await load(a, id);
  if (!c || !visible(a, c)) return { ok: true, call: null, signals: [] };
  const mine = a.role === 'student' || c.staff_email === a.email;
  if (c.status === 'active' && mine) await admin().from('portal_calls').update({ beat_at: new Date().toISOString() }).eq('id', id).eq('status', 'active');
  let signals: CallSignal[] = [];
  if (mine && LIVE.includes(c.status)) {
    const { data } = await admin().from('portal_call_signals').select('id, kind, data').eq('call_id', id).neq('from_role', a.role).gt('id', Math.max(0, after)).order('id').limit(100);
    signals = (data || []) as CallSignal[];
  }
  return { ok: true, call: view(a, c), signals };
}

type Ice = { urls: string | string[]; username?: string; credential?: string };
let iceCache: { at: number; list: Ice[]; relay: boolean } | null = null;

/** Where the browsers look for each other. Free STUN always; a relay (TURN) when one is configured, which is what makes calls work on strict mobile networks. */
export async function iceServers(): Promise<{ iceServers: Ice[]; relay: boolean }> {
  if (iceCache && Date.now() - iceCache.at < 20 * 60_000) return { iceServers: iceCache.list, relay: iceCache.relay };
  const list: Ice[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  let relay = false;
  const keyId = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (keyId && token) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 3600 }), cache: 'no-store',
      });
      if (r.ok) {
        const j = (await r.json()) as { iceServers?: Ice | Ice[] };
        const got = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
        for (const s of got) {
          const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)); // browsers warn about port 53
          if (urls.length && s.username) { list.push({ urls, username: s.username, credential: s.credential }); relay = true; }
        }
      }
    } catch { /* fall back to STUN only */ }
  }
  const urls = (process.env.TURN_URLS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) { list.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }); relay = true; }
  iceCache = { at: Date.now(), list, relay };
  return { iceServers: list, relay };
}
