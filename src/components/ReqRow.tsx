'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { setRequirement, uploadForRequirement } from '@/app/stageActions';
import { STATE_WORD, type ReqEval } from '@/lib/stageEngine';

export type FileLite = { id: string; name: string; type: string; at: string };

const TONE: Record<string, string> = { missing: 'red', uploaded: 'blue', received: 'amber', reviewed: 'amber', approved: 'green', accepted: 'green', done: 'green', rejected: 'red', failed: 'red' };
// a conditional requirement is only listed when it applies to this student, so here it is simply required
const NEED = (r: ReqEval) => (r.need === 'optional' ? 'Optional' : 'Required');
const WORD = (r: ReqEval) => (r.kind === 'outcome' ? r.value || 'Not recorded' : r.kind === 'confirmation' && r.status === 'missing' ? 'Not confirmed' : r.kind === 'confirmation' && r.status === 'approved' ? 'Confirmed' : r.status === 'uploaded' ? 'Uploaded' : STATE_WORD[r.status] || r.status);
const day = (t: string) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** One requirement of a stage: what it is, where it stands, and the controls to move it along. Uploading a file never completes it: someone reviews it. */
export default function ReqRow({ r, appId, files, canEdit = true, compact = false }: { r: ReqEval; appId: string; files: FileLite[]; canEdit?: boolean; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [reason, setReason] = useState('');
  const [busyUp, setBusyUp] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tone = !r.satisfied && !r.blocking && r.status === 'missing' ? 'gray' : TONE[r.status] || 'gray';
  // the pill already says "not received" or "not recorded"; the line below is for what the pill cannot say
  const why = r.why && !r.satisfied && r.status !== 'missing' && r.kind !== 'outcome' ? r.why : r.status === 'failed' ? r.why : null;
  const busy = pending || busyUp;

  const act = (state: Parameters<typeof setRequirement>[2]['state'], extra: { note?: string; docId?: string | null; value?: string | null } = {}) => {
    setErr('');
    start(async () => {
      const res = await setRequirement(appId, r.ref, { state, ...extra });
      if (!res.ok) setErr(res.error); else { setReason(''); router.refresh(); }
    });
  };
  async function upload(file: File) {
    setErr(''); setBusyUp(true);
    const fd = new FormData(); fd.set('appId', appId); fd.set('kind', r.docType || r.label); fd.set('file', file);
    const res = await uploadForRequirement(fd);
    setBusyUp(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }
  const close = (e: React.MouseEvent) => (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  const typed = r.docType ? files.filter((f) => f.type.toLowerCase() === r.docType!.toLowerCase()) : [];

  return (
    <div className={`sg-req tone-${tone}${r.satisfied ? ' ok' : ''}${compact ? ' compact' : ''}`} aria-busy={busy}>
      <span className="sg-dot" aria-hidden>{r.satisfied ? <Icon n="check" size={13} /> : r.status === 'rejected' || r.status === 'failed' ? <Icon n="x" size={12} /> : <i />}</span>
      <div className="sg-main">
        <div className="sg-line">
          <b>{r.label}</b>
          <span className={`sg-need ${r.need}`}>{NEED(r)}</span>
          <span className={`badge plain ${tone}`}>{WORD(r)}</span>
        </div>
        {why && <small className="sg-why">{why}</small>}
        {r.carriedFrom && <small className="sg-note">Already approved in “{r.carriedFrom}”.</small>}
        {r.satisfied && r.check && <small className="sg-note">{r.kind === 'outcome' ? `Recorded ${day(r.check.at)}` : `${STATE_WORD[r.status]} ${day(r.check.at)}`}{r.note ? ` · ${r.note}` : ''}</small>}
        {r.hint && !r.satisfied && !compact && <small className="sg-hint">{r.hint}</small>}
        {r.kind === 'document' && r.doc && <small className="sg-file"><Icon n="file" size={12} /> <a href={`/api/files/${encodeURIComponent(r.doc.id)}`} target="_blank" rel="noreferrer">{r.doc.name.split(' - ').pop()}</a> · {day(r.doc.created_at)}</small>}
        {err && <small className="sg-err" role="alert">{err}</small>}

        {canEdit && (
          <div className="sg-act">
            {r.kind === 'document' && r.upload && (
              <>
                <input ref={input} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => input.current?.click()}><Icon n="upload" size={13} /> {busyUp ? 'Uploading…' : r.doc ? 'Upload a new file' : 'Upload'}</button>
              </>
            )}
            {r.kind === 'document' && (
              <details className="dd">
                <summary className="btn ghost sm" style={{ listStyle: 'none' }}>Review <Icon n="down" size={12} /></summary>
                <div className="menu sg-menu">
                  {files.length > 0 && (
                    <label className="sg-link"><span>This requirement is covered by</span>
                      <select value={r.doc?.id || ''} onChange={(e) => e.target.value && act('received', { docId: e.target.value })}>
                        <option value="">{r.doc ? r.doc.name.split(' - ').pop() : 'Choose a file…'}</option>
                        {(typed.length ? typed : files).filter((f) => f.id !== r.doc?.id).map((f) => <option key={f.id} value={f.id}>{f.type} · {f.name.split(' - ').pop()} · {day(f.at)}</option>)}
                      </select></label>
                  )}
                  <button type="button" className="item" onClick={(e) => { act('received'); close(e); }}><Icon n="check" /> Mark received</button>
                  <button type="button" className="item" onClick={(e) => { act('reviewed'); close(e); }}><Icon n="eye" /> Mark reviewed</button>
                  <button type="button" className="item" onClick={(e) => { act('approved'); close(e); }}><Icon n="check-circle" /> Approve</button>
                  <button type="button" className="item" onClick={(e) => { act('accepted'); close(e); }}><Icon n="graduation" /> Accepted by the school</button>
                  <div className="sg-rej"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it rejected?" maxLength={200} /><button type="button" className="btn ghost sm" disabled={reason.trim().length < 3} onClick={(e) => { act('rejected', { note: reason }); close(e); }}>Reject</button></div>
                  {r.check && <button type="button" className="item" onClick={(e) => { act(null); close(e); }}><Icon n="rotate" /> Clear</button>}
                </div>
              </details>
            )}
            {r.kind === 'confirmation' && (
              <>
                {!r.satisfied && <button type="button" className="btn sm" disabled={busy} onClick={() => act(r.satisfiedAt === 'accepted' ? 'accepted' : 'approved')}><Icon n="check" size={13} /> {r.satisfiedAt === 'accepted' ? 'Accepted by the school' : 'Confirm'}</button>}
                {r.check && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act(null)}>Undo</button>}
              </>
            )}
            {r.kind === 'outcome' && (
              <>
                <select className="sg-out" value={r.value || ''} disabled={busy} onChange={(e) => e.target.value && act(null, { value: e.target.value })} aria-label={r.label}>
                  <option value="">Record the outcome…</option>
                  {(r.options || []).map((o) => <option key={o}>{o}</option>)}
                </select>
                {r.check && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => act(null)}>Clear</button>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
