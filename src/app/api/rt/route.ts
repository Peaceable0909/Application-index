import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';
import { rtConfig, topicFor } from '@/lib/realtime';

/** Where this signed-in person's app should listen for "look again now" nudges. */
export async function GET() {
  const cfg = rtConfig();
  const staff = await currentStaff();
  const student = staff ? null : await currentStudent();
  const email = staff?.email || student?.email;
  if (!cfg || !email) return NextResponse.json({ ok: false }, { status: cfg ? 401 : 200, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ ok: true, url: cfg.url, key: cfg.key, topic: topicFor({ role: staff ? 'staff' : 'student', email }) }, { headers: { 'Cache-Control': 'no-store' } });
}
