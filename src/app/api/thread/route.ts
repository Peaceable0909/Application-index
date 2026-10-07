import { NextResponse } from 'next/server';
import { actor, loadThread, postMessage } from '@/lib/thread';

export const maxDuration = 60;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const a = await actor(u.searchParams.get('app'));
  if (!a) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await loadThread(a, u.searchParams.get('read') === '1'), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const f = await req.formData();
  const a = await actor(String(f.get('appId') || ''));
  if (!a) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const file = f.get('file');
  const r = await postMessage(a, { body: String(f.get('body') || ''), replyTo: String(f.get('replyTo') || '') || null, file: file instanceof File ? file : null, durationMs: Number(f.get('durationMs')) || null });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
