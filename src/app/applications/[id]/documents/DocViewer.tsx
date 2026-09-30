'use client';
import { useEffect, useState } from 'react';
import { ALL_DOC_TYPES } from '@/lib/constants';
import { setDocType, uploadDocument } from '@/app/actions';

export type ViewerDoc = {
  id: string; name: string; type: string; path: string | null; size: number; mime: string; driveUrl: string; fromOther: boolean; added: string;
};

const INLINE_LIMIT = 4 * 1024 * 1024; // larger files can't be streamed through the portal
const isOffice = (m: string, n: string) => /officedocument|msword|ms-excel|ms-powerpoint/.test(m) || /\.(docx?|xlsx?|pptx?)$/i.test(n);

export default function DocViewer({ appId, docs, missing, initial, canUpload }: {
  appId: string; docs: ViewerDoc[]; missing: string[]; initial: string | null; canUpload: boolean;
}) {
  const [sel, setSel] = useState<string | null>(initial && docs.some((d) => d.id === initial) ? initial : docs[0]?.id ?? null);
  const [zoom, setZoom] = useState(false);
  const idx = docs.findIndex((d) => d.id === sel);
  const doc = idx >= 0 ? docs[idx] : null;
  const go = (n: number) => { if (docs.length) setSel(docs[(n + docs.length) % docs.length].id); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      if (e.key === 'ArrowRight') go(idx + 1);
      if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const types = [...new Set(docs.map((d) => d.type))];
  const returnTo = `/applications/${appId}/documents${doc ? `?file=${doc.id}` : ''}`;
  const viaPortal = doc && doc.size <= INLINE_LIMIT && !isOffice(doc.mime, doc.name);
  const isImage = doc?.mime.startsWith('image/');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ position: 'sticky', top: 12, maxHeight: '85vh', overflow: 'auto' }}>
        {types.map((t) => (
          <div key={t} style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>{t}</div>
            {docs.filter((d) => d.type === t).map((d) => (
              <div key={d.id} onClick={() => setSel(d.id)} style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: d.id === sel ? '#eceae1' : 'transparent' }}>
                {d.name}
                <div className="muted" style={{ fontSize: 12 }}>{d.path ? `📁 ${d.path} · ` : ''}{d.fromOther ? 'other submission · ' : ''}{d.added}</div>
              </div>
            ))}
          </div>
        ))}
        {!docs.length && <p className="muted">No documents yet.</p>}
        {missing.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase' }}>Missing</div>
            {missing.map((m) => <div key={m}><span className="badge amber" style={{ margin: '3px 0', display: 'inline-block' }}>{m}</span></div>)}
          </div>
        )}
        {canUpload && (
          <form action={uploadDocument} style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 10 }} className="grid">
            <input type="hidden" name="id" value={appId} /><input type="hidden" name="returnTo" value={returnTo} />
            <select name="docType" defaultValue={missing[0] || 'Other'}>{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <input type="file" name="file" required />
            <button>Upload to Drive</button>
          </form>
        )}
      </div>

      <div className="card">
        {!doc ? <p className="muted">Select a document.</p> : (
          <>
            <div className="filters" style={{ marginBottom: 10 }}>
              <button className="ghost" onClick={() => go(idx - 1)}>← Prev</button>
              <button className="ghost" onClick={() => go(idx + 1)}>Next →</button>
              <b style={{ flex: 1 }}>{doc.name} <span className="muted">({idx + 1}/{docs.length})</span></b>
              {isImage && <button className="ghost" onClick={() => setZoom(!zoom)}>{zoom ? 'Fit' : 'Zoom'}</button>}
              <a href={doc.driveUrl} target="_blank" rel="noreferrer">Open in Drive ↗</a>
              {viaPortal && <a href={`/api/files/${doc.id}?download=1`}>Download</a>}
            </div>
            {viaPortal ? (
              isImage
                ? <div style={{ overflow: 'auto', maxHeight: '75vh' }}><img src={`/api/files/${doc.id}`} alt={doc.name} style={zoom ? { maxWidth: 'none' } : { maxWidth: '100%' }} /></div>
                : <iframe key={doc.id} className="preview" style={{ height: '78vh' }} src={`/api/files/${doc.id}`} />
            ) : (
              <>
                <p className="muted">
                  {isOffice(doc.mime, doc.name) ? 'Word/Excel/PowerPoint files are shown through Google Drive.' : 'This file is too large to stream here, so it is shown through Google Drive.'}{' '}
                  You need to be signed in to a Google account that has access to the folder.
                </p>
                <iframe key={doc.id} className="preview" style={{ height: '78vh' }} src={`https://drive.google.com/file/d/${doc.id}/preview`} />
              </>
            )}
            <form action={setDocType} className="filters" style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={appId} /><input type="hidden" name="fileId" value={doc.id} /><input type="hidden" name="returnTo" value={returnTo} />
              <span className="muted">Document type:</span>
              <select name="docType" defaultValue={doc.type}>{ALL_DOC_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              <button className="ghost">Change</button>
              <span className="muted">Use ← → keys to move between documents.</span>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
