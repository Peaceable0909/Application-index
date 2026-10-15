import { NextResponse } from 'next/server';
import { actor, loadThread, postMessage, type Uploaded } from '@/lib/thread';

export const maxDuration = 60;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const a = await actor(u.searchParams.get('app'));
  if (!a) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await loadThread(a, u.searchParams.get('read') === '1'), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  // Small things arrive as a form with the file inside. Big files (GIFs, PDFs) were uploaded straight to storage first, and only their place is sent here.
  if ((req.headers.get('content-type') || '').includes('application/json')) {
    const j = (await req.json().catch(() => null)) as { appId?: string; body?: string; replyTo?: string | null; durationMs?: number | null; uploaded?: Uploaded } | null;
    const a = j ? await actor(String(j.appId || '')) : null;
    if (!j || !a) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
    const u = j.uploaded && typeof j.uploaded.path === 'string' ? { path: j.uploaded.path, name: String(j.uploaded.name || 'file'), type: String(j.uploaded.type || ''), size: Number(j.uploaded.size) || 0 } : null;
    const r = await postMessage(a, { body: String(j.body || ''), replyTo: j.replyTo || null, durationMs: Number(j.durationMs) || null, uploaded: u });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  const f = await req.formData();
  const a = await actor(String(f.get('appId') || ''));
  if (!a) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  const file = f.get('file');
  const r = await postMessage(a, { body: String(f.get('body') || ''), replyTo: String(f.get('replyTo') || '') || null, file: file instanceof File ? file : null, durationMs: Number(f.get('durationMs')) || null });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
