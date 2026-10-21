import { NextResponse } from 'next/server';
import { sessionClient } from '@/lib/supabase';
import { cookies } from 'next/headers';
import { ACT_COOKIE, actCookie } from '@/lib/session';

// Google redirects back here with ?code=...; swap it for a session cookie.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const origin = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  if (code) {
    const sb = await sessionClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      const store = await cookies();
      store.set(ACT_COOKIE, String(Date.now()), actCookie());   // a fresh sign-in restarts the "still here" clock
      // came here from a "forgot password" email: take them to the place where the new password is typed
      if (store.get('pw_reset')) { store.delete('pw_reset'); return NextResponse.redirect(`${origin}/profile?msg=${encodeURIComponent('You are signed in. Type your new password below.')}#password`); }
      return NextResponse.redirect(`${origin}/`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Google sign-in failed')}`);
}
