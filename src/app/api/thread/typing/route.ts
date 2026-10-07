import { NextResponse } from 'next/server';
import { actor, setTyping } from '@/lib/thread';

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { app?: string };
  const a = await actor(b.app);
  if (!a) return NextResponse.json({ ok: false }, { status: 401 });
  await setTyping(a);
  return NextResponse.json({ ok: true });
}
