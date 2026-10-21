'use client';
import { useEffect } from 'react';

/** Signs the team member out when nobody has touched the screen for a while, so a passport is never left open on an unattended computer.
 *  It also tells the server "still here" (at most every 4 minutes) so the server can enforce the same limit if the tab is closed. */
export default function IdleLock({ idleMinutes }: { idleMinutes: number }) {
  useEffect(() => {
    const limit = idleMinutes * 60_000;
    let lastInput = Date.now(), lastTouch = 0;
    const out = () => { window.location.href = '/auth/expired'; };
    const touch = () => {
      lastTouch = Date.now();
      fetch('/api/session/touch', { method: 'POST', cache: 'no-store' }).then((r) => { if (r.status === 401) out(); }).catch(() => {});
    };
    const seen = () => { lastInput = Date.now(); if (lastInput - lastTouch > 4 * 60_000) touch(); };
    // a call in progress counts as being at the computer, even when nobody touches the screen
    const check = () => { if (document.querySelector('.callui, .callpill')) { seen(); return; } if (Date.now() - lastInput > limit) out(); };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, seen, { passive: true, capture: true }));
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(check, 30_000);
    touch();
    return () => { events.forEach((e) => window.removeEventListener(e, seen, { capture: true })); document.removeEventListener('visibilitychange', onVisible); clearInterval(t); };
  }, [idleMinutes]);
  return null;
}
