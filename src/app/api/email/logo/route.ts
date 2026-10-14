import { NextResponse, type NextRequest } from 'next/server';

// Emails sent before the rename point here for their logo. It now just hands over the new one (new emails use /brand/extravel-email.png directly).
// Public on purpose (mail apps fetch it without a login).
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL('/brand/extravel-tile.png', req.url), { status: 302, headers: { 'Cache-Control': 'public, max-age=3600' } });
}
