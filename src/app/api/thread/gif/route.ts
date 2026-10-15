import { NextResponse } from 'next/server';
import { actor, postMessage } from '@/lib/thread';

export const maxDuration = 30;

/** Sends a GIF chosen from the GIF tab: we keep our own copy so it still shows later, and it is drawn like a sticker. */
export async function POST(req: Request) {
  const j = (await req.json().catch(() => null)) as { app?: string; url?: string; replyTo?: string | null } | null;
  const a = j ? await actor(j.app || null) : null;
  if (!j || !a) return NextResponse.json({ ok: false, error: 'Please sign in again.' }, { status: 401 });
  let u: URL;
  try { u = new URL(String(j.url || '')); } catch { return NextResponse.json({ ok: false, error: 'That GIF can’t be used.' }, { status: 400 }); }
  if (u.protocol !== 'https:' || !/(^|\.)giphy\.com$/i.test(u.hostname)) return NextResponse.json({ ok: false, error: 'That GIF can’t be used.' }, { status: 400 });
  try {
    const r = await fetch(u.href, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    if (!buf || buf.length < 100 || buf.length > 8 * 1024 * 1024 || buf.subarray(0, 3).toString('latin1') !== 'GIF') return NextResponse.json({ ok: false, error: 'Could not get that GIF. Try another.' }, { status: 400 });
    const res = await postMessage(a, { body: '', replyTo: j.replyTo || null, file: new File([buf], `sticker_gif_${Date.now()}.gif`, { type: 'image/gif' }), big: true });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch { return NextResponse.json({ ok: false, error: 'Could not get that GIF. Try another.' }, { status: 400 }); }
}
