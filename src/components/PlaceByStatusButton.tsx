'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeByStatus } from '@/app/stageActions';

/** Admin: puts every application that has no stage yet into the stage its pipeline status points at. Nothing else is changed. */
export default function PlaceByStatusButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const run = () => start(async () => {
    setMsg('');
    const r = await placeByStatus();
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(r.placed ? `Placed ${r.placed} application${r.placed === 1 ? '' : 's'}.${r.left ? ` ${r.left} left: no matching stage, or run again for more.` : ''}` : 'Nothing could be placed from the pipeline status.');
    router.refresh();
  });
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" className="btn ghost sm" disabled={pending || !count} onClick={run}>{pending ? 'Placing…' : `Place ${count} by pipeline status`}</button>
      {msg && <small className="muted" role="status">{msg}</small>}
    </span>
  );
}
