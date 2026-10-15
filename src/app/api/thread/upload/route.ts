import { NextResponse } from 'next/server';
import { actor, uploadSlot } from '@/lib/thread';
import { rtConfig } from '@/lib/realtime';

/** Step one of sending a big file: where in storage the browser may put it. Step two is the normal send with that place. */
export async function POST(req: Request) {
  const j = (await req.json().catch(() => null)) as { app?: string; name?: string; type?: string; size?: number } | null;
  const a = j ? await actor(j.app || null) : null;
  if (!j || !a) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const r = await uploadSlot(a, { name: String(j.name || 'file'), type: String(j.type || ''), size: Number(j.size) || 0 });
  return NextResponse.json(r.ok ? { ...r, key: rtConfig()?.key } : r, { status: r.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' } });
}
