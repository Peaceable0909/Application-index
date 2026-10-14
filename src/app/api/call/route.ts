import { NextResponse } from 'next/server';
import { actor } from '@/lib/thread';
import { addSignal, answerCall, currentCall, declineCall, endCall, pollCall, startCall } from '@/lib/calls';

export const maxDuration = 30;
const no = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const u = new URL(req.url);
  const a = await actor(u.searchParams.get('app'));
  if (!a) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: no });
  const id = u.searchParams.get('call');
  return NextResponse.json(id ? await pollCall(a, id, Number(u.searchParams.get('after')) || 0) : { ok: true, call: await currentCall(a), signals: [] }, { headers: no });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { app?: string; action?: string; kind?: string; callId?: string; data?: unknown } | null;
  const a = b ? await actor(b.app || null) : null;
  if (!b || !a) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401, headers: no });
  const id = String(b.callId || '');
  switch (b.action) {
    case 'start': return NextResponse.json(await startCall(a, b.kind === 'video' ? 'video' : 'voice'), { headers: no });
    case 'answer': return NextResponse.json(await answerCall(a, id), { headers: no });
    case 'decline': return NextResponse.json(await declineCall(a, id), { headers: no });
    case 'end': return NextResponse.json(await endCall(a, id), { headers: no });
    case 'signal': return NextResponse.json(await addSignal(a, id, String(b.kind || ''), b.data), { headers: no });
    default: return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400, headers: no });
  }
}
