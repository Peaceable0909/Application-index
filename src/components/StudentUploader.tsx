'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { studentUpload } from '@/app/actions';
import Icon from './Icon';

async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif' || f.size < 900_000) return f;
  try {
    const bmp = await createImageBitmap(f), k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.85));
    return new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return f; }
}

/** One upload slot. `docType` is fixed for the required-document rows; for "other" the student picks. */
export default function StudentUploader({ appId, docType, label, choose, types, compact = false }: { appId: string; docType?: string; label: string; choose?: boolean; types?: string[]; compact?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(docType || types?.[0] || 'Other');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const [custom, setCustom] = useState('');
  const needsLabel = type === 'Other' && custom.trim().length < 2;

  async function send(file: File) {
    if (needsLabel) { setMsg({ t: 'First type what kind of document this is.', bad: true }); return; }
    setBusy(true); setMsg(null);
    try {
      const small = await shrink(file), fd = new FormData();
      fd.set('appId', appId); fd.set('docType', type); fd.set('docLabel', custom); fd.set('file', small);
      const r = await studentUpload(fd);
      if (r.ok) { setMsg({ t: 'Uploaded ✓' }); setCustom(''); router.refresh(); } else setMsg({ t: r.error || 'Upload failed', bad: true });
    } catch { setMsg({ t: 'Upload failed. Please try again.', bad: true }); }
    setBusy(false);
  }
  return (
    <div className={`upl ${over ? 'over' : ''} ${compact ? 'compact' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) send(f); }}>
      {choose && <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Document type">{(types || []).map((t) => <option key={t} value={t}>{t === 'Other' ? 'Other (name it)' : t}</option>)}</select>}
      {choose && type === 'Other' && <input value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={40} placeholder="What kind of document? e.g. Bank statement" aria-label="Name of the document" style={{ flex: '1 1 220px' }} />}
      <input ref={input} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ''; }} />
      <button type="button" className="btn sm" disabled={busy || (choose && needsLabel)} onClick={() => input.current?.click()}>{busy ? <><span className="pspin2" style={{ width: 14, height: 14, borderWidth: 2 }} /> Uploading…</> : <><Icon n="upload" size={14} /> {label}</>}</button>
      {!compact && !msg && <small className="muted">or drop a file here · PDF, photo or Word · max 4 MB</small>}
      {msg && <small className={msg.bad ? 'bad-t' : 'ok-t'}>{msg.t}</small>}
    </div>
  );
}
