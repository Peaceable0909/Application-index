'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Keeps the student's dashboard current: looks again the moment the team moves their application, and when they come back to the tab. */
export default function StageLive() {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt = 0;
    const nudge = (e: Event) => { if ((e as CustomEvent).detail?.event === 'stage') router.refresh(); };
    const vis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 20_000) router.refresh();
      hiddenAt = 0;
    };
    window.addEventListener('wr:nudge', nudge); document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('wr:nudge', nudge); document.removeEventListener('visibilitychange', vis); };
  }, [router]);
  return null;
}
