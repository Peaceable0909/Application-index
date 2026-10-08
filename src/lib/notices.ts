import { admin } from './supabase';
import { REQUIRED_DOCS } from './constants';
import type { StudentView } from './student';
import { sendPush } from './push';

export type NoticeKind = 'docs' | 'payment' | 'offer' | 'interview' | 'message';
export type Notice = { id: string; kind: NoticeKind; title: string; body: string | null; href: string | null; created_at: string; read: boolean; done: boolean };

/** Mirrors an email we just sent into the student's portal. Never blocks or fails the email itself. */
export async function addNotice(o: { email: string | null | undefined; applicationId?: string | null; kind: NoticeKind; title: string; body?: string; href?: string; by?: string }) {
  const email = (o.email || '').trim().toLowerCase();
  if (!email) return;
  try {
    const db = admin();
    const { data: dup } = await db.from('portal_student_notices').select('id').eq('email', email).eq('kind', o.kind).eq('title', o.title).gte('created_at', new Date(Date.now() - 60_000).toISOString()).limit(1);
    if (dup?.length) return;
    await db.from('portal_student_notices').insert({ email, application_id: o.applicationId || null, kind: o.kind, title: o.title.slice(0, 160), body: (o.body || '').slice(0, 600) || null, href: o.href || null, created_by: o.by || null });
    // also a phone notification, if they turned that on and aren't already looking at the portal
    await sendPush({ emails: [email], title: o.title, body: o.body, url: o.href || '/student', tag: `n-${o.kind}`, skipIfActiveMs: 45_000, ...(o.kind === 'message' ? { calmMs: 30 * 60_000 } : {}) });
  } catch { /* a missing notice must never break the action that caused it */ }
}

/** The student's recent notices. Requests that have been fulfilled since (documents now complete, payment received) show as done. */
export async function noticesFor(me: StudentView): Promise<Notice[]> {
  const { data } = await admin().from('portal_student_notices').select('id, kind, title, body, href, created_at, read_at').eq('email', me.email).order('created_at', { ascending: false }).limit(30);
  const have = new Set(me.docs.map((d) => d.type));
  const docsDone = REQUIRED_DOCS.every((t) => have.has(t));
  const paid = me.apps.some((a) => a.in_regent && /^paid/i.test(a.payment || ''));
  return (data || []).map((n) => ({ id: n.id, kind: n.kind as NoticeKind, title: n.title, body: n.body, href: n.href, created_at: n.created_at, read: !!n.read_at,
    done: (n.kind === 'docs' && docsDone) || (n.kind === 'payment' && paid) }));
}
