import { NextResponse } from 'next/server';
import { actor, saveToDocuments } from '@/lib/thread';

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = (await req.json().catch(() => ({}))) as { app?: string; docType?: string; docLabel?: string };
  const a = await actor(b.app);
  if (!a) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const r = await saveToDocuments(a, (await params).id, b.docType || '', b.docLabel || '');
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
