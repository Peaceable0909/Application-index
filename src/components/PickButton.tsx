'use client';
import { useTransition } from 'react';
import { assignApp } from '@/app/assignActions';

/** "Give to [counselor]" on the Team Head queue. It sits inside another form, so it runs its own action and shows its own progress. */
export default function PickButton({ id, counselor, label, returnTo = '/head', reason = 'Chosen between equal counselors' }: { id: string; counselor: string; label: string; returnTo?: string; reason?: string }) {
  const [pending, start] = useTransition();
  const go = () => {
    // announced before the transition starts: updates made inside an async transition are held back until it ends, and the page-wide indicator must show at once
    window.dispatchEvent(new CustomEvent('wr-busy', { detail: 'Assigning and updating the sheet…' }));
    start(async () => {
      const fd = new FormData();
      fd.set('id', id); fd.set('counselor', counselor); fd.set('reason', reason); fd.set('returnTo', returnTo);
      try { await assignApp(fd); } finally { setTimeout(() => window.dispatchEvent(new Event('wr-form-done')), 0); }
    });
  };
  return (
    <button type="button" className="btn sm" disabled={pending} aria-busy={pending} onClick={go}>
      {pending && <span className="spin" aria-hidden />}<span>{pending ? 'Assigning…' : label}</span>
    </button>
  );
}
