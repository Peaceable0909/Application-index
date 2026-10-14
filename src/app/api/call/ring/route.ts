import { NextResponse } from 'next/server';
import { ringingFor } from '@/lib/calls';

export const maxDuration = 15;

/** "Is anyone calling me?" Asked every few seconds from any page, so a call rings wherever you are in the app. */
export async function GET() {
  const r = await ringingFor();
  return NextResponse.json({ ok: true, ...(r || { call: null }) }, { headers: { 'Cache-Control': 'no-store' } });
}
