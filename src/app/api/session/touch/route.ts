import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { ACT_COOKIE, actCookie } from '@/lib/session';

const no = { 'Cache-Control': 'no-store' };

// The page calls this (at most every few minutes, and only after the person touched the screen) to say "still here".
// A sign-in that has already timed out cannot be revived this way: currentStaff() is empty for it.
export async function POST() {
  if (!(await currentStaff())) return new NextResponse('expired', { status: 401, headers: no });
  const res = NextResponse.json({ ok: true }, { headers: no });
  res.cookies.set(ACT_COOKIE, String(Date.now()), actCookie());
  return res;
}
