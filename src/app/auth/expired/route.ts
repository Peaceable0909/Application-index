import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sessionClient } from '@/lib/supabase';
import { ACT_COOKIE } from '@/lib/session';

// A team sign-in that sat unused for too long (or ran past the working-day limit) lands here: sign out this browser only, then show the sign-in page.
export async function GET(req: Request) {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
  try { await (await sessionClient()).auth.signOut({ scope: 'local' }); } catch { /* already signed out */ }
  (await cookies()).delete(ACT_COOKIE);
  return NextResponse.redirect(`${origin}/login?notice=${encodeURIComponent('You were signed out to keep student documents safe. Sign in again to carry on.')}`);
}
