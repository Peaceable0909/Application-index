import { NextResponse } from 'next/server';
import { actor, react, unsend } from '@/lib/thread';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = (await req.json().catch(() => ({}))) as { app?: string; emoji?: string };
  const a = await actor(b.app);
  if (!a) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: await react(a, (await params).id, b.emoji || '') });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await actor(new URL(req.url).searchParams.get('app'));
  if (!a) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: await unsend(a, (await params).id) });
}
