'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { ScanLoader } from './Loaders';

/** Drop a file in, the Brain reads it and can quote from it. */
export default function BrainLearn({ schools }: { schools: string[] }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null), [title, setTitle] = useState(''), [school, setSchool] = useState(''), [busy, setBusy] = useState(false), [note, setNote] = useState<{ ok: boolean; text: string } | null>(null), [over, setOver] = useState(false);
  const choose = (f: File | null | undefined) => { if (!f) return; setFile(f); setNote(null); if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 120)); };
  async function go() {
    if (!file || busy) return;
    setBusy(true); setNote(null);
    const fd = new FormData(); fd.set('file', file); fd.set('title', title); fd.set('school', school);
    try {
      const r = await fetch('/api/brain/learn', { method: 'POST', body: fd });
      const j = (await r.json()) as { ok?: boolean; chars?: number; truncated?: boolean; error?: string };
      if (!r.ok || !j.ok) setNote({ ok: false, text: j.error || `The server answered ${r.status}.` });
      else { setNote({ ok: true, text: `Learned ${j.chars?.toLocaleString()} characters${j.truncated ? ' (the first 120,000; the rest was left out)' : ''}.` }); setFile(null); setTitle(''); if (pick.current) pick.current.value = ''; router.refresh(); }
    } catch { setNote({ ok: false, text: 'Lost the connection. Try again.' }); }
    setBusy(false);
  }
  return (
    <div>
      <div className={`learn-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files?.[0]); }} onClick={() => pick.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') pick.current?.click(); }}>
        <Icon n="upload" size={22} />
        <b>{file ? file.name : 'Drop a file here, or choose one'}</b>
        <small>PDF, Word, photo or text · up to 4 MB</small>
      </div>
      <input ref={pick} type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt,.md,.csv,application/pdf,image/*,text/plain" onChange={(e) => choose(e.target.files?.[0])} />
      {file && (
        <div className="filters" style={{ marginTop: 10 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={120} style={{ flex: 1, minWidth: 220 }} aria-label="Title" />
          <select value={school} onChange={(e) => setSchool(e.target.value)} aria-label="School"><option value="">All schools</option>{schools.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <button type="button" className="btn primary" onClick={go} disabled={busy || title.trim().length < 2}>{busy ? 'Reading…' : 'Teach the Brain'}</button>
        </div>
      )}
      {busy && <ScanLoader label="Reading the file" sub="This takes a few seconds" />}
      {note && <p className={note.ok ? 'ok-t' : 'bad-t'} style={{ margin: '10px 0 0' }}>{note.text}</p>}
    </div>
  );
}
