'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-reads the page's data every few seconds while it is visible (a visitor may be typing). */
export default function AutoRefresh({ every = 8000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, every); return () => clearInterval(t); }, [router, every]);
  return null;
}
