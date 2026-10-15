'use client';
import { useEffect } from 'react';

type Cfg = { url: string; key: string; topic: string };

/** Listens for "look again now" nudges from the server and tells the rest of the app with a `wr:nudge` event. Reconnects by itself. */
export default function RealtimeNudge() {
  useEffect(() => {
    let ws: WebSocket | null = null, stop = false, tries = 0, ref = 0, cfg: Cfg | null = null;
    let hb: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    const emit = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('wr:nudge', { detail }));
    const later = () => { if (!stop) { clearTimeout(retry); retry = setTimeout(open, Math.min(20_000, 1000 * 2 ** Math.min(tries++, 5))); } };
    async function open() {
      if (stop || (ws && ws.readyState <= 1)) return;
      try {
        if (!cfg) { const r = await fetch('/api/rt', { cache: 'no-store' }); const j = r.ok ? ((await r.json()) as Cfg & { ok: boolean }) : null; if (!j?.ok) return; cfg = j; }
        const c = cfg, u = new URL(c.url), sock = new WebSocket(`${u.protocol === 'http:' ? 'ws' : 'wss'}://${u.host}/realtime/v1/websocket?apikey=${encodeURIComponent(c.key)}&vsn=1.0.0`);
        ws = sock;
        sock.onopen = () => {
          tries = 0;
          sock.send(JSON.stringify({ topic: `realtime:${c.topic}`, event: 'phx_join', payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, private: false, postgres_changes: [] }, access_token: c.key }, ref: String(++ref), join_ref: '1' }));
          clearInterval(hb); hb = setInterval(() => { if (sock.readyState === 1) sock.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) })); }, 25_000);
          emit({ event: 'wake' }); // anything that happened while we were disconnected
        };
        sock.onmessage = (e) => { try { const m = JSON.parse(e.data as string); if (m.event === 'broadcast' && m.payload?.event) emit({ ...(m.payload.payload || {}), event: m.payload.event }); } catch { /* not for us */ } };
        sock.onclose = () => { clearInterval(hb); if (ws === sock) ws = null; later(); };
        sock.onerror = () => { try { sock.close(); } catch { /* already closed */ } };
      } catch { later(); }
    }
    void open();
    const back = () => { if (document.visibilityState === 'visible') { if (!ws || ws.readyState > 1) { tries = 0; void open(); } else emit({ event: 'wake' }); } };
    document.addEventListener('visibilitychange', back); window.addEventListener('online', back);
    return () => { stop = true; clearTimeout(retry); clearInterval(hb); document.removeEventListener('visibilitychange', back); window.removeEventListener('online', back); ws?.close(); };
  }, []);
  return null;
}
