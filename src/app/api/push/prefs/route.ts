import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { pushUser } from '@/lib/pushUser';

const MODES = ['first', 'every', 'off'];

export async function GET() {
  const u = await pushUser();
  if (!u) return NextResponse.json({ mode: 'first' }, { status: 401 });
  const { data } = await admin().from('portal_push_prefs').select('mode').eq('email', u.email).maybeSingle();
  return NextResponse.json({ mode: data?.mode || 'first' }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const u = await pushUser();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { mode?: string };
  if (!b.mode || !MODES.includes(b.mode)) return NextResponse.json({ ok: false }, { status: 400 });
  const { error } = await admin().from('portal_push_prefs').upsert({ email: u.email, mode: b.mode, updated_at: new Date().toISOString() }, { onConflict: 'email' });
  return NextResponse.json({ ok: !error }, { status: error ? 500 : 200 });
}
