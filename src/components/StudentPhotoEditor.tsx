'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Avatar from './Avatar';
import Icon from './Icon';
import { removeStudentPhoto, uploadStudentPhoto } from '@/app/studentPhotoActions';

/** Squares + shrinks the chosen photo in the browser (400×400 JPEG, ~40 KB) before it is uploaded. */
async function squash(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), S = 400;
  const c = document.createElement('canvas'); c.width = c.height = S;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.86));
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

/** The student's own profile picture: tap it to choose a photo. */
export default function StudentPhotoEditor({ name, url }: { name: string; url: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    setBusy(true); setErr('');
    try {
      const small = await squash(f);
      setPreview(URL.createObjectURL(small));
      const fd = new FormData(); fd.set('photo', small);
      const r = await uploadStudentPhoto(fd);
      if (!r.ok) { setErr(r.error || 'Could not save your photo.'); setPreview(null); } else router.refresh();
    } catch { setErr('Could not read that image. Try a JPG or PNG.'); setPreview(null); }
    setBusy(false);
  }
  async function remove() { setBusy(true); setErr(''); const r = await removeStudentPhoto(); if (!r.ok) setErr(r.error || 'Could not remove it.'); else { setPreview(null); router.refresh(); } setBusy(false); }
  return (
    <div className="st-photo">
      <button type="button" className="st-photo-pick" onClick={() => input.current?.click()} disabled={busy} aria-label={url || preview ? 'Change your photo' : 'Add your photo'}>
        <Avatar name={name} url={preview || url} size={92} />
        <span className="st-photo-cam"><Icon n="camera" size={16} /></span>
        {busy && <span className="st-photo-spin" />}
      </button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={picked} />
      <div className="st-photo-acts">
        <button type="button" className="st-link" onClick={() => input.current?.click()} disabled={busy}>{url || preview ? 'Change photo' : 'Add a photo'}</button>
        {(url || preview) && <button type="button" className="st-link bad" onClick={remove} disabled={busy}>Remove</button>}
      </div>
      {err && <small className="st-photo-err">{err}</small>}
    </div>
  );
}
