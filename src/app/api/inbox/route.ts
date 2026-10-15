import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { inboxList } from '@/lib/inbox';

/** The student conversations for the messenger's list (refreshed whenever something arrives). */
export async function GET(req: Request) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ ok: false }, { status: 401 });
  const u = new URL(req.url);
  return NextResponse.json({ ok: true, list: await inboxList(staff, { q: u.searchParams.get('q') || '', unread: u.searchParams.get('f') === 'unread' }) }, { headers: { 'Cache-Control': 'no-store' } });
}
