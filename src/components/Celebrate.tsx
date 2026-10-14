'use client';
import { useEffect, useState } from 'react';
import { confetti, confettiRain } from '@/lib/confetti';
import { success } from '@/lib/haptics';

export type Unlocked = { key: string; label: string; emoji: string };

/**
 * Remembers which milestones this device has already seen. When a NEW one appears, it throws confetti and shows a small banner.
 * The first visit only records what is already unlocked, so nobody gets confetti for old news.
 */
export default function Celebrate({ scope, unlocked }: { scope: string; unlocked: Unlocked[] }) {
  const [shown, setShown] = useState<Unlocked | null>(null);
  useEffect(() => {
    const k = `wr_ms_${scope}`;
    let seen: string[] | null = null;
    try { const raw = localStorage.getItem(k); seen = raw ? (JSON.parse(raw) as string[]) : null; } catch { /* storage off */ }
    const now = unlocked.map((u) => u.key);
    try { localStorage.setItem(k, JSON.stringify(now)); } catch { /* optional */ }
    if (seen === null) return;                       // first visit: stay quiet
    const fresh = unlocked.filter((u) => !seen!.includes(u.key));
    if (!fresh.length) return;
    const t = setTimeout(() => { setShown(fresh[fresh.length - 1]); success(); fresh.some((f) => f.key === 'enrolled' || f.key === 'offer') ? confettiRain() : confetti(); }, 700);
    const hide = setTimeout(() => setShown(null), 6500);
    return () => { clearTimeout(t); clearTimeout(hide); };
  }, [scope, unlocked]);
  if (!shown) return null;
  return <button type="button" className="st-toast" onClick={() => setShown(null)} aria-live="polite"><span className="e">{shown.emoji}</span><span><b>New milestone unlocked</b><small>{shown.label}</small></span></button>;
}
