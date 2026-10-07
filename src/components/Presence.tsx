'use client';
import { useEffect } from 'react';

/** Quiet heartbeat while the portal is open and visible. */
export default function Presence() {
  useEffect(() => {
    const ping = () => { if (document.hidden) return; fetch('/api/presence', { cache: 'no-store' }).then((r) => r.json()).then((j) => window.dispatchEvent(new CustomEvent('chat-unread', { detail: j.unread || 0 }))).catch(() => {}); };
    ping(); const t = setInterval(ping, 45_000);
    document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, []);
  return null;
}
