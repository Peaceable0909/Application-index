import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { canAccessApp, currentStaff } from '@/lib/auth';

export const dynamic = 'force-dynamic';
const COLS = 'id, from_email, to_email, body, application_id, created_at, read_at, portal_applications(name)';
const shape = (m: Record<string, unknown>) => { const { portal_applications, ...rest } = m as { portal_applications?: { name: string } | null }; return { ...rest, student: portal_applications?.name ?? null }; };

// New messages in one conversation since a timestamp (also marks incoming ones as read), plus the unread total.
export async function GET(req: Request) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url), other = (url.searchParams.get('with') || '').toLowerCase(), since = url.searchParams.get('since');
  const db = admin();
  let messages: unknown[] = [];
  if (other) {
    let q = db.from('portal_chat').select(COLS).or(`and(from_email.eq.${me.email},to_email.eq.${other}),and(from_email.eq.${other},to_email.eq.${me.email})`).order('created_at', { ascending: true }).limit(300);
    if (since) q = q.gt('created_at', since);
    const { data } = await q;
    messages = (data || []).map(shape);
    await db.from('portal_chat').update({ read_at: new Date().toISOString() }).eq('to_email', me.email).eq('from_email', other).is('read_at', null);
  }
  const { count } = await db.from('portal_chat').select('id', { count: 'exact', head: true }).eq('to_email', me.email).is('read_at', null);
  // "seen" state of my own messages to this person
  let seenUpTo: string | null = null;
  if (other) { const { data } = await db.from('portal_chat').select('created_at').eq('from_email', me.email).eq('to_email', other).not('read_at', 'is', null).order('created_at', { ascending: false }).limit(1); seenUpTo = data?.[0]?.created_at ?? null; }
  return NextResponse.json({ messages, unread: count || 0, seenUpTo });
}

export async function POST(req: Request) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { to?: string; body?: string; applicationId?: string | null };
  const to = (b.to || '').toLowerCase(), body = (b.body || '').trim().slice(0, 2000);
  if (!body) return NextResponse.json({ error: 'Write a message first.' }, { status: 400 });
  if (to === me.email) return NextResponse.json({ error: 'You can’t message yourself.' }, { status: 400 });
  const db = admin();
  const { data: person } = await db.from('portal_staff').select('email').eq('email', to).maybeSingle();
  if (!person) return NextResponse.json({ error: 'That person isn’t on the portal.' }, { status: 400 });
  let application_id: string | null = b.applicationId || null;
  if (application_id && !(await canAccessApp(me, application_id))) application_id = null;   // can only tag students you can see
  const { data, error } = await db.from('portal_chat').insert({ from_email: me.email, to_email: to, body, application_id }).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: shape(data) });
}
