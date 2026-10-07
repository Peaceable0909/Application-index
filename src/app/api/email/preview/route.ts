import { currentStaff } from '@/lib/auth';
import { renderEmail } from '@/lib/emailTemplate';
import { sampleSpec } from '@/lib/emailSamples';
import { signFor } from '@/lib/mail';

// HTML preview of the email designs (signed in with your own signature), for the Settings page.
export async function GET(req: Request) {
  const me = await currentStaff();
  if (!me) return new Response('Sign in first', { status: 401 });
  const { subject: _s, body: _b, ...spec } = sampleSpec(new URL(req.url).searchParams.get('kind') || 'student');
  return new Response(renderEmail({ ...spec, sign: await signFor(me.email) }), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
