import { NextResponse } from 'next/server';
import { sessionClient } from '@/lib/supabase';

// Google redirects back here with ?code=...; swap it for a session cookie.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const origin = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  if (code) {
    const sb = await sessionClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/overview`);
  }
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Google sign-in failed')}`);
}
