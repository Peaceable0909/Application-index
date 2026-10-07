'use client';
import { useEffect } from 'react';

/** Tells us the student is here right now, so we don't email them about things they can already see. */
export default function StudentPing() {
  useEffect(() => {
    const ping = () => { if (!document.hidden) fetch('/api/student/ping', { method: 'POST', cache: 'no-store' }).catch(() => {}); };
    ping(); const t = setInterval(ping, 45_000); document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', ping); };
  }, []);
  return null;
}
