import { NextResponse } from 'next/server';
import { sendPush } from '@/lib/push';
import { pushUser } from '@/lib/pushUser';

/** "Send me a test": one notification to the signed-in person's own devices. */
export async function POST() {
  const u = await pushUser();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  const r = await sendPush({ emails: [u.email], title: 'Notifications are on', body: 'You will now get alerts like this one.', url: u.role === 'student' ? '/student' : '/', tag: 'test' });
  return NextResponse.json({ ok: r.sent > 0, sent: r.sent, error: r.sent ? undefined : 'No device received it. Turn notifications on first, on this device.' });
}
