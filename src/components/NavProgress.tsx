'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Global "something is happening" feedback: a top progress bar + dimmed page the moment you click a link,
 * switch a tab, apply a filter or submit a form, and a "Working…" pill if it takes more than a moment.
 * It ends when the new page content arrives (URL change or the page body updating).
 */
function Inner() {
  const path = usePathname();
  const sp = useSearchParams().toString();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; setBusy(false); setMsg(null); document.body.classList.remove('is-busy'); };
  const start = (label?: string) => {
    stop();
    setBusy(true); document.body.classList.add('is-busy');
    timers.current = [setTimeout(() => setMsg(label || 'Working…'), 700), setTimeout(stop, 60_000)];
  };

  useEffect(() => { stop(); }, [path, sp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('/api/')) return;
      let url: URL; try { url = new URL(href, location.href); } catch { return; }
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      start();
    };
    const submit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement, b = e.submitter as HTMLElement | null;
      const act = b?.getAttribute('formaction') || f.getAttribute('action') || '';
      if (act.startsWith('/api/')) return; // file downloads don't navigate
      start(b?.getAttribute('data-busy') || f.getAttribute('data-busy') || undefined);
    };
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    // The page body updating (server action finished, tab content swapped) also ends the busy state.
    const main = document.querySelector('main');
    const mo = main ? new MutationObserver(() => { if (document.body.classList.contains('is-busy')) { timers.current.push(setTimeout(stop, 120)); } }) : null;
    if (main && mo) mo.observe(main, { childList: true, subtree: true });
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('submit', submit, true); mo?.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!busy) return null;
  return (
    <>
      <div className="topload" />
      {msg && <div className="busy-toast" role="status"><span className="spin" />{msg}</div>}
    </>
  );
}

export default function NavProgress() { return <Suspense fallback={null}><Inner /></Suspense>; }
