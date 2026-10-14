'use client';
import { useEffect } from 'react';
import { tick } from '@/lib/haptics';

/** Gives taps on tabs, tiles, checkboxes and call buttons a light buzz on phones that can. Mounted once. */
export default function Haptics() {
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.st-tabs a, .st-qt, .st-check, .cbtn, .wa-ic, .tab, [data-haptic]')) tick();
    };
    document.addEventListener('pointerdown', on, { passive: true });
    return () => document.removeEventListener('pointerdown', on);
  }, []);
  return null;
}
