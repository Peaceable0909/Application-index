import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { pushUser } from '@/lib/pushUser';
import { COOKIE, isAccent, isMode } from '@/lib/theme';

/** Saves the signed-in person's look (mode + accent): in a cookie for instant, flash-free loads and in the database so it follows them to other devices. */
export async function POST(req: Request) {
  const u = await pushUser();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { mode?: string; accent?: string };
  if (!isMode(b.mode) || !isAccent(b.accent)) return NextResponse.json({ ok: false }, { status: 400 });
  const { error } = await admin().from('portal_theme_prefs').upsert({ email: u.email, mode: b.mode, accent: b.accent, updated_at: new Date().toISOString() }, { onConflict: 'email' });
  const res = NextResponse.json({ ok: !error }, { status: error ? 500 : 200 });
  res.cookies.set(COOKIE, `${b.mode}.${b.accent}`, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: true });
  return res;
}
