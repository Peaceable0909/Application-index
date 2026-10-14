'use client';
import { useEffect } from 'react';

type Nav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
/** Puts the unread count on the app icon (installed app, where the phone or computer allows it). */
export default function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    const n = navigator as Nav;
    try { if (count > 0) void n.setAppBadge?.(count); else void n.clearAppBadge?.(); } catch { /* not supported */ }
  }, [count]);
  return null;
}
