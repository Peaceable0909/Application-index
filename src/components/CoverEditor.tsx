'use client';
import { useRef, useState } from 'react';
import Icon from './Icon';
import Btn from './Btn';
import { COVER_PRESETS, coverBackground } from '@/lib/covers';
import { removeCover, saveCover, setCoverPos, setCoverPreset } from '@/app/profileActions';

/** Fits a chosen picture into a banner: at most 1600 × 1100, JPEG, under ~1.8 MB, so it uploads quickly and the server limit (2 MB) is never hit. */
async function fit(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / bmp.width, 1100 / bmp.height);
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
  let q = 0.86, blob: Blob;
  do { blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', q)); q -= 0.12; } while (blob.size > 1_800_000 && q > 0.3);
  return new File([blob], 'cover.jpg', { type: 'image/jpeg' });
}

/**
 * The "Cover" button over a profile's cover and the panel it opens: upload a photo, slide which part of it shows, pick a built-in cover, or remove
 * the photo. `email` is set when an admin changes someone else's. When an admin has locked covers, only a note is shown.
 */
export default function CoverEditor({ email, url, pos, preset, color, returnTo, locked = false }: { email?: string; url: string | null; pos: number; preset: string | null; color: string | null; returnTo: string; locked?: boolean }) {
  const form = useRef<HTMLFormElement>(null), input = useRef<HTMLInputElement>(null), box = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState(pos);
  if (locked) return <div className="cvt cvt-locked"><span className="btn ghost sm"><Icon n="lock" size={14} /> Cover set by an admin</span></div>;

  async function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setBusy(true);
    try {
      const small = await fit(f);
      const dt = new DataTransfer(); dt.items.add(small);
      input.current!.files = dt.files;
      form.current!.requestSubmit();
    } catch { setBusy(false); alert('Could not read that picture. Try a JPG or PNG.'); }
  }
  const move = (v: number) => { setP(v); const img = box.current?.closest('.ph')?.querySelector<HTMLImageElement>('.cvr img'); if (img) img.style.objectPosition = `50% ${v}%`; };
  const ids = (<>{email && <input type="hidden" name="email" value={email} />}<input type="hidden" name="returnTo" value={returnTo} /></>);

  return (
    <div className="cvt">
      <details ref={box} className="cvt-menu">
        <summary className="btn sm cvt-btn"><Icon n="camera" size={15} /> <span>{url || preset ? 'Change cover' : 'Add cover'}</span></summary>
        <div className="cvt-panel">
          <form ref={form} action={saveCover} className="cvt-up" data-busy="Uploading your cover…">
            {ids}<input type="hidden" name="pos" value={p} />
            <input ref={input} type="file" name="cover" accept="image/jpeg,image/png,image/webp" hidden onChange={picked} />
            <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={busy}><Icon n="upload" size={14} /> {busy ? 'Preparing…' : url ? 'Upload a different photo' : 'Upload a photo'}</button>
            <small className="muted">Wide photos work best (at least 1200 px across). It is resized for you; JPG, PNG or WebP.</small>
          </form>
          {url && (
            <form action={setCoverPos} className="cvt-pos" data-busy="Saving the position…">
              {ids}
              <label>Which part of the photo shows<input type="range" name="pos" min={0} max={100} value={p} onChange={(e) => move(Number(e.target.value))} /></label>
              <Btn className="btn ghost sm" data-busy="Saving the position…">Save position</Btn>
            </form>
          )}
          <div className="cvt-h">Or choose a cover</div>
          <div className="cvt-tiles">
            {Object.entries(COVER_PRESETS).map(([k, c]) => (
              <form key={k} action={setCoverPreset} data-busy="Changing your cover…">
                {ids}<input type="hidden" name="preset" value={k} />
                <Btn className={`cvt-tile ${!url && preset === k ? 'on' : ''}`} style={{ backgroundImage: c.css }} aria-label={`${c.label} cover`} title={c.label} data-busy="Changing your cover…"><span>{c.label}</span></Btn>
              </form>
            ))}
            <form action={setCoverPreset} data-busy="Changing your cover…">
              {ids}<input type="hidden" name="preset" value="" />
              <Btn className={`cvt-tile ${!url && !preset ? 'on' : ''}`} style={{ backgroundImage: coverBackground(null, color) }} aria-label="Match my accent colour" title="Match my accent colour" data-busy="Changing your cover…"><span>My colour</span></Btn>
            </form>
          </div>
          {url && (
            <form action={removeCover} data-busy="Removing the photo…" className="cvt-rm">
              {ids}<Btn className="btn ghost sm" data-busy="Removing the photo…"><Icon n="trash" size={14} /> Remove photo</Btn>
            </form>
          )}
        </div>
      </details>
    </div>
  );
}
