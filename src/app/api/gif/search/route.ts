import { NextResponse } from 'next/server';
import { currentStaff } from '@/lib/auth';
import { currentStudent } from '@/lib/student';

// GIF search for the chat's GIF tab, through GIPHY. The key lives only on the server (GIPHY_API_KEY in Vercel); without it the tab says so.
type G = { id: string; title?: string; images?: Record<string, { url?: string; width?: string; height?: string; size?: string }> };
export async function GET(req: Request) {
  if (!(await currentStaff()) && !(await currentStudent())) return NextResponse.json({ ok: false }, { status: 401 });
  const key = process.env.GIPHY_API_KEY;
  if (!key) return NextResponse.json({ ok: true, configured: false, results: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const u = new URL(req.url), q = (u.searchParams.get('q') || '').trim().slice(0, 60), offset = Math.max(0, Math.min(200, Number(u.searchParams.get('offset')) || 0));
  try {
    const r = await fetch(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?api_key=${encodeURIComponent(key)}&limit=24&offset=${offset}&rating=g&bundle=messaging_non_clips${q ? `&q=${encodeURIComponent(q)}` : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return NextResponse.json({ ok: false, error: 'GIF search is busy. Try again in a moment.' }, { status: 502 });
    const j = (await r.json()) as { data?: G[] };
    const results = (j.data || []).map((g) => {
      const small = g.images?.fixed_width_small || g.images?.fixed_width, big = g.images?.downsized_medium || g.images?.downsized || g.images?.original;
      return small?.url && big?.url ? { id: g.id, title: g.title || '', preview: small.url, url: big.url, w: Number(small.width) || 100, h: Number(small.height) || 100 } : null;
    }).filter(Boolean);
    return NextResponse.json({ ok: true, configured: true, results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ ok: false, error: 'GIF search is busy. Try again in a moment.' }, { status: 502 }); }
}
