'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Global "something is happening" feedback: a top progress bar + dimmed page the moment you click a link,
 * switch a tab, apply a filter or submit a form, and a "Working…" pill if it takes more than a moment.
 * It ends when the new page content arrives (URL change or the page body updating), or when the button that started it says it is done
 * ("wr-form-done"). A button's own spinner, and anything else inside the form that was just sent, is not "the page arriving".
 * Buttons that are not inside a form can ask for it too: window.dispatchEvent(new CustomEvent('wr-busy', { detail: 'Assigning…' })).
 */
function Inner() {
  const path = usePathname();
  const sp = useSearchParams().toString();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sent = useRef<Element | null>(null);   // the form that was just submitted: what changes inside it does not count as the page updating

  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; sent.current = null; setBusy(false); setMsg(null); document.body.classList.remove('is-busy'); };
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
      sent.current = f;   // after start(), which clears it
    };
    const asked = (e: Event) => start(String((e as CustomEvent).detail || '') || undefined);
    const done = () => { if (document.body.classList.contains('is-busy')) timers.current.push(setTimeout(stop, 60)); };
    window.addEventListener('wr-busy', asked); window.addEventListener('wr-form-done', done);
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    // The page body updating (server action finished, tab content swapped) also ends the busy state.
    const main = document.querySelector('main');
    const mo = main ? new MutationObserver((records) => {
      if (!document.body.classList.contains('is-busy')) return;
      const own = sent.current;
      // a spinner appearing in the button, or the sent form's own pending state, is not the answer arriving
      const arrived = records.some((m) => { const t = m.target as Element; return !(own && own.contains(t)) && !t.closest?.('button'); });
      if (arrived) timers.current.push(setTimeout(stop, 120));
    }) : null;
    if (main && mo) mo.observe(main, { childList: true, subtree: true });
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('submit', submit, true); window.removeEventListener('wr-busy', asked); window.removeEventListener('wr-form-done', done); mo?.disconnect(); };
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
