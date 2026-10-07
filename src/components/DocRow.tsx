'use client';
import { useState } from 'react';
import Icon from './Icon';
import StudentUploader from './StudentUploader';
import DocScanner from './DocScanner';

export type DocRowProps = { type: string; appId: string; canUpload: boolean; got: { id: string; name: string; added: string; size: number | null } | null; tip?: { what: string; tips: string[] }; i: number };
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default function DocRow({ type, appId, canUpload, got, tip, i }: DocRowProps) {
  const [open, setOpen] = useState(false), [scan, setScan] = useState(false);
  return (
    <div className={`st-doc ${got ? 'got' : 'need'}`} style={{ '--i': i } as React.CSSProperties}>
      <div className="st-doc-main">
        <span className="st-doc-dot">{got ? <Icon n="check" size={14} /> : '!'}</span>
        <div className="st-doc-t"><b>{type}</b><small>{got ? `${got.name} · received ${new Date(got.added).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${got.size ? ` · ${kb(got.size)}` : ''}` : tip?.what || 'Still needed'}</small></div>
        {got && <a className="st-icon-link" href={`/api/files/${encodeURIComponent(got.id)}`} target="_blank" rel="noreferrer" aria-label={`View ${type}`}><Icon n="eye" size={16} /></a>}
        {tip && <button className="st-icon-link" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Tips">?</button>}
      </div>
      {open && tip && <ul className="st-tips">{tip.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
      {canUpload && (
        <div className="st-doc-act">
          <button className="st-btn sm" onClick={() => setScan(true)}><Icon n="camera" size={14} /> Scan</button>
          <StudentUploader appId={appId} docType={type} label={got ? 'Replace file' : 'Upload a file'} compact />
        </div>
      )}
      {scan && <DocScanner appId={appId} docType={type} title={type} onClose={() => setScan(false)} />}
    </div>
  );
}
