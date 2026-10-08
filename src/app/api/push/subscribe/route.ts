import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { pushUser } from '@/lib/pushUser';

const MAX_DEVICES = 8;

export async function POST(req: Request) {
  const u = await pushUser();
  if (!u) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } };
  const s = b.subscription;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys?.auth || s.endpoint.length > 1000) return NextResponse.json({ ok: false, error: 'That device could not be registered.' }, { status: 400 });
  try { if (new URL(s.endpoint).protocol !== 'https:') throw new Error('x'); } catch { return NextResponse.json({ ok: false, error: 'That device could not be registered.' }, { status: 400 }); }
  const db = admin();
  const { data: mine } = await db.from('portal_push_subs').select('id, endpoint, created_at').eq('email', u.email).order('created_at');
  const extra = (mine || []).filter((m) => m.endpoint !== s.endpoint);
  if (extra.length >= MAX_DEVICES) await db.from('portal_push_subs').delete().in('id', extra.slice(0, extra.length - MAX_DEVICES + 1).map((m) => m.id));
  const { error } = await db.from('portal_push_subs').upsert({ email: u.email, role: u.role, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, user_agent: (req.headers.get('user-agent') || '').slice(0, 200) }, { onConflict: 'endpoint' });
  return NextResponse.json({ ok: !error, error: error ? 'Could not save your notification settings.' : undefined }, { status: error ? 500 : 200 });
}

export async function DELETE(req: Request) {
  const u = await pushUser();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (b.endpoint) await admin().from('portal_push_subs').delete().eq('email', u.email).eq('endpoint', b.endpoint);
  return NextResponse.json({ ok: true });
}
