import { NextResponse } from 'next/server';
import { actor } from '@/lib/thread';
import { iceServers } from '@/lib/calls';

export async function GET(req: Request) {
  const a = await actor(new URL(req.url).searchParams.get('app'));
  if (!a) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await iceServers(), { headers: { 'Cache-Control': 'no-store' } });
}
