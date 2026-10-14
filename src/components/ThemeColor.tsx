'use client';
import { useEffect } from 'react';

const COLOR: Record<string, string> = { light: '#f2f2f7', soft: '#f4efe3', dark: '#000000' };
/** Keeps the phone's status-bar colour in step with the chosen theme (the installed app's top edge). */
export default function ThemeColor() {
  useEffect(() => {
    const el = document.documentElement;
    const apply = () => { const m = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null; if (m) m.content = COLOR[el.getAttribute('data-theme') || 'light'] || COLOR.light; };
    apply();
    const mo = new MutationObserver(apply); mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return null;
}
