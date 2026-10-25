'use client';
import { useFormStatus } from 'react-dom';

/** Inside a form: while its action runs, says what is happening (and that clicking again is not needed). Nothing is drawn when idle. */
export default function PendingNote({ title, children }: { title: string; children?: React.ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="slot-working" role="status" aria-live="polite">
      <span className="spin" aria-hidden />
      <div><b>{title}</b>{children && <small>{children} Please do not click again; you will see a confirmation as soon as it is done.</small>}</div>
    </div>
  );
}
