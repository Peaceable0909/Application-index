'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { retrySheetMove, undoMoves } from '@/app/moveActions';

/** "Undo this change" under the latest move in the activity feed. */
export function UndoMove({ activityId }: { activityId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  return (
    <span className="mv-pending">
      <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => {
        setBusy(true); setMsg('');
        try { const r = await undoMoves([activityId]); if (r.undone) router.refresh(); else setMsg(r.problems.join(' ') || 'Nothing was undone.'); } catch { setMsg('Could not undo. Please try again.'); }
        setBusy(false);
      }}><Icon n="left" size={14} /> {busy ? 'Undoing…' : 'Undo this change'}</button>
      {msg && <small className="err-line" style={{ margin: 0 }}>{msg}</small>}
    </span>
  );
}

/** Shown when a move reached the portal but Sheet1 still has the old school or programme. */
export function RetrySheet({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  return (
    <span className="mv-pending">
      <span className="badge plain amber" title="The portal shows the new school or programme, but Sheet1 still has the old one.">Sheet1 not updated</span>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={async () => {
        setBusy(true); setMsg('');
        try { const r = await retrySheetMove(id); if (r.ok) router.refresh(); else setMsg(r.error || 'Sheet1 was not changed.'); } catch { setMsg('Could not reach Sheet1. Please try again.'); }
        setBusy(false);
      }}>{busy ? 'Updating…' : 'Update Sheet1'}</button>
      {msg && <small className="err-line" style={{ margin: 0 }}>{msg}</small>}
    </span>
  );
}
