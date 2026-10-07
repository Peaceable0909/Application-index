'use client';
import { useEffect, useRef, useState } from 'react';

type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> }> } };
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf';
let loading: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  loading ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = `${CDN}.min.js`;
    s.onload = () => { w.pdfjsLib!.GlobalWorkerOptions.workerSrc = `${CDN}.worker.min.js`; res(w.pdfjsLib!); };
    s.onerror = () => rej(new Error('Could not load the PDF reader')); document.head.appendChild(s);
  });
  return loading;
}
const MAX_PAGES = 30;

/** A page-by-page preview drawn in the page itself (PDFs as sharp page images, photos with zoom). Separate from the browser's built-in viewer used on the Documents page. */
export default function PagePreview({ id, mime, name, size, driveUrl }: { id: string; mime: string; name: string; size: number; driveUrl: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState('');
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(name), isImg = mime.startsWith('image/'), tooBig = size > 4 * 1024 * 1024;

  useEffect(() => {
    if (!isPdf || tooBig) return;
    let dead = false; const el = box.current!; el.innerHTML = ''; setState('loading'); setPages(0);
    (async () => {
      try {
        const lib = await loadPdfJs();
        const pdf = await lib.getDocument({ url: `/api/files/${encodeURIComponent(id)}`, withCredentials: true }).promise;
        if (dead) return;
        setPages(pdf.numPages);
        const width = Math.max(280, el.clientWidth - 8) * zoom, dpr = Math.min(2, window.devicePixelRatio || 1);
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
          const page = await pdf.getPage(n), base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: width / base.width });
          const c = document.createElement('canvas'); c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr); c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
          const wrap = document.createElement('div'); wrap.className = 'pv-page'; const tag = document.createElement('span'); tag.textContent = `Page ${n}`; wrap.append(c, tag);
          if (dead) return; el.appendChild(wrap);
          await page.render({ canvasContext: c.getContext('2d'), viewport: page.getViewport({ scale: (width / base.width) * dpr }), transform: undefined }).promise;
          if (n === 1) setState('ready');
        }
        setState('ready');
      } catch (e) { if (!dead) { setErr((e as Error).message || 'Could not draw this PDF'); setState('error'); } }
    })();
    return () => { dead = true; };
  }, [id, isPdf, tooBig, zoom]);

  if (isImg && !tooBig) return (
    <div className="pv"><div className="pv-bar"><span>{name}</span><span className="pv-zoom"><button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button><b>{Math.round(zoom * 100)}%</b><button onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</button></span></div>
      <div className="pv-scroll">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/files/${encodeURIComponent(id)}`} alt={name} style={{ width: `${zoom * 100}%`, maxWidth: 'none' }} /></div></div>
  );
  if (isPdf && !tooBig) return (
    <div className="pv">
      <div className="pv-bar"><span>{name}{pages ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}</span><span className="pv-zoom"><button onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button><b>{Math.round(zoom * 100)}%</b><button onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}>+</button></span></div>
      <div className="pv-scroll">
        {state === 'loading' && <div className="pv-note"><span className="pspin2" /> Drawing pages…</div>}
        {state === 'error' && <div className="pv-note">{err}. <a href={`/api/files/${encodeURIComponent(id)}`} target="_blank">Open it in a new tab</a></div>}
        <div ref={box} />
        {pages > MAX_PAGES && <div className="pv-note">Showing the first {MAX_PAGES} of {pages} pages.</div>}
      </div>
    </div>
  );
  return (
    <div className="pv"><div className="pv-bar"><span>{name}</span></div>
      <div className="pv-scroll"><div className="pv-note">{tooBig ? 'This file is too large to draw here.' : 'This kind of file can’t be drawn here.'} <a href={driveUrl} target="_blank" rel="noreferrer">Open in Drive ↗</a></div></div></div>
  );
}
