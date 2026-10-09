import { NextResponse } from 'next/server';
import { sendPush } from '@/lib/push';
import { pushUser } from '@/lib/pushUser';
import { admin } from '@/lib/supabase';

/** "Send me a test": one notification to the signed-in person's own devices. */
export async function POST() {
  const u = await pushUser();
  if (!u) return NextResponse.json({ ok: false }, { status: 401 });
  const r = await sendPush({ emails: [u.email], title: 'Notifications are on', body: 'You will now get alerts like this one.', url: u.role === 'student' ? '/student' : '/', tag: 'test', ignorePrefs: true });
  let why = '';
  if (!r.sent) { const { data } = await admin().from('portal_push_log').select('result, detail').eq('email', u.email).eq('tag', 'test').order('created_at', { ascending: false }).limit(1); if (data?.[0]) why = ` (${data[0].result.replace(/_/g, ' ')}${data[0].detail ? `: ${data[0].detail}` : ''})`; }
  return NextResponse.json({ ok: r.sent > 0, sent: r.sent, error: r.sent ? undefined : `No device received it${why}. Turn notifications off and on again on this device.` });
}
