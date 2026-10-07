'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { studentUpload } from '@/app/actions';
import { buildPdf, type PdfPage } from '@/lib/pdf';
import Icon from './Icon';
import Confirmed from './Confirmed';

type Shot = { id: number; canvas: HTMLCanvasElement; url: string; warn: string | null };
const MAX_BYTES = 3.8 * 1024 * 1024;

/** Quick checks on a small copy of the photo: is it too dark, or too soft to read? Advice only; nothing is blocked. */
function quality(src: HTMLCanvasElement): string | null {
  const w = 240, h = Math.max(1, Math.round((src.height / src.width) * w)), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, gray = new Float32Array(w * h); let sum = 0;
  for (let i = 0; i < w * h; i++) { const v = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; gray[i] = v; sum += v; }
  if (sum / (w * h) < 55) return 'This looks too dark. Try more light.';
  let m = 0, n = 0, m2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]; n++; m += l; m2 += l * l; }
  const variance = m2 / n - (m / n) ** 2;
  return variance < 28 ? 'This looks a little blurry. Hold still and retake if it’s hard to read.' : null;
}

/** Stretches contrast so a photo of paper looks like a clean scan (colours are kept). */
function enhance(c: HTMLCanvasElement) {
  const g = c.getContext('2d', { willReadFrequently: true })!, img = g.getImageData(0, 0, c.width, c.height), d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2])]++;
  const total = d.length / 4; let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.015) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.12) { hi = v; break; } }
  if (hi - lo < 40) return;
  const k = 255 / (hi - lo);
  for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) d[i + j] = Math.max(0, Math.min(255, (d[i + j] - lo) * k));
  g.putImageData(img, 0, 0);
}

async function toCanvas(file: File, maxSide: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c;
}
const rotate = (c: HTMLCanvasElement) => { const r = document.createElement('canvas'); r.width = c.height; r.height = c.width; const g = r.getContext('2d')!; g.translate(r.width / 2, r.height / 2); g.rotate(Math.PI / 2); g.drawImage(c, -c.width / 2, -c.height / 2); return r; };
const jpeg = (c: HTMLCanvasElement, q: number): Promise<Blob> => new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', q));

export default function DocScanner({ appId, docType, docLabel, title, onClose }: { appId: string; docType: string; docLabel?: string; title: string; onClose: () => void }) {
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null), pick = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [clean, setClean] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const idc = useRef(1);
  useEffect(() => { const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose(); window.addEventListener('keydown', esc); document.body.style.overflow = 'hidden'; return () => { window.removeEventListener('keydown', esc); document.body.style.overflow = ''; }; }, [busy, onClose]);

  async function add(files: FileList | null) {
    if (!files?.length) return; setErr(''); setBusy(true);
    try {
      const next: Shot[] = [];
      for (const f of Array.from(files).slice(0, 12 - shots.length)) {
        if (!f.type.startsWith('image/')) { setErr('Only photos can be scanned. Use “Upload a file” for PDFs.'); continue; }
        const c = await toCanvas(f, 1700); const warn = quality(c); if (clean) enhance(c);
        next.push({ id: idc.current++, canvas: c, url: c.toDataURL('image/jpeg', 0.5), warn });
      }
      setShots((s) => [...s, ...next]);
    } catch { setErr('Could not read that photo. Please try again.'); }
    setBusy(false);
  }
  const redo = (id: number) => setShots((s) => s.map((x) => (x.id === id ? { ...x, canvas: rotate(x.canvas), url: rotate(x.canvas).toDataURL('image/jpeg', 0.5) } : x)));
  const drop = (id: number) => setShots((s) => s.filter((x) => x.id !== id));
  const move = (id: number, d: -1 | 1) => setShots((s) => { const i = s.findIndex((x) => x.id === id), j = i + d; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });

  async function upload() {
    if (!shots.length || busy) return; setBusy(true); setErr('');
    try {
      let q = 0.82, bytes: Uint8Array = new Uint8Array();
      for (let attempt = 0; attempt < 4; attempt++) {
        const pages: PdfPage[] = [];
        for (const s of shots) { const b = await jpeg(s.canvas, q); pages.push({ jpeg: new Uint8Array(await b.arrayBuffer()), w: s.canvas.width, h: s.canvas.height }); }
        bytes = buildPdf(pages); if (bytes.length <= MAX_BYTES) break; q -= 0.14;
      }
      if (bytes.length > MAX_BYTES) { setErr('That’s too large to send. Try fewer pages, or retake them with the camera further away.'); setBusy(false); return; }
      const fd = new FormData(); fd.set('appId', appId); fd.set('docType', docType); if (docLabel) fd.set('docLabel', docLabel);
      fd.set('file', new File([bytes as BlobPart], `${title.replace(/[^\w]+/g, '-')}.pdf`, { type: 'application/pdf' }));
      const r = await studentUpload(fd);
      if (r.ok) { setDone(true); router.refresh(); } else setErr(r.error || 'Upload failed');
    } catch { setErr('Something went wrong while building the PDF. Please try again.'); }
    setBusy(false);
  }

  if (done) return <Confirmed title={`${title} received`} lines={[`${shots.length} page${shots.length === 1 ? '' : 's'} sent as one PDF.`, 'Your counselor can see it now.']} onClose={onClose} seconds={4} />;
  return (
    <div className="st-sheet-bg" onClick={() => !busy && onClose()}>
      <div className="st-sheet" role="dialog" aria-label={`Scan ${title}`} onClick={(e) => e.stopPropagation()}>
        <div className="st-grab" />
        <div className="st-sheet-h"><div><h2>Scan {title}</h2><p className="st-sub" style={{ margin: 0 }}>Take a photo of each page. We’ll turn them into one PDF.</p></div><button className="iconbtn" onClick={onClose} aria-label="Close" disabled={busy}>×</button></div>
        <div className="st-shots">
          {shots.map((s, i) => (
            <div key={s.id} className="st-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}<img src={s.url} alt={`Page ${i + 1}`} />
              <span className="n">{i + 1}</span>
              <div className="act"><button onClick={() => move(s.id, -1)} aria-label="Move earlier" disabled={i === 0}>‹</button><button onClick={() => redo(s.id)} aria-label="Rotate">⟳</button><button onClick={() => move(s.id, 1)} aria-label="Move later" disabled={i === shots.length - 1}>›</button><button onClick={() => drop(s.id)} aria-label="Remove">×</button></div>
              {s.warn && <div className="warn">{s.warn}</div>}
            </div>
          ))}
          {shots.length < 12 && (
            <button className="st-add" onClick={() => cam.current?.click()} disabled={busy}><Icon n="camera" size={26} /><span>{shots.length ? 'Add another page' : 'Take a photo'}</span></button>
          )}
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        <div className="st-sheet-f">
          <label className="st-toggle"><input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} /><span>Clean up the photos</span></label>
          <button className="st-btn ghost sm" onClick={() => pick.current?.click()} disabled={busy}>Choose from gallery</button>
        </div>
        {err && <div className="st-err">{err}</div>}
        <button className="st-btn" style={{ width: '100%', marginTop: 12 }} disabled={!shots.length || busy} onClick={upload}>{busy ? 'Working…' : shots.length ? `Upload ${shots.length} page${shots.length === 1 ? '' : 's'} as PDF` : 'Take a photo to begin'}</button>
      </div>
    </div>
  );
}
