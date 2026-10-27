import { NextResponse } from 'next/server';
import { assetLinks } from '@/lib/androidApp';
import { loadAndroid } from '@/lib/androidData';

// Digital Asset Links: tells Android that the WhiteRock app may open this address full screen. Public on purpose (Android and Google fetch it with no session).
export const dynamic = 'force-dynamic';
export async function GET() {
  const { fingerprints } = await loadAndroid();
  return NextResponse.json(assetLinks(fingerprints), { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60' } });
}
