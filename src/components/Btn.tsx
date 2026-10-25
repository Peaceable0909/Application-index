'use client';
import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

// Submit button with a spinner + disabled state while its server action runs. When the action ends it says so ("wr-form-done"), so the page-wide
// "Working…" indicator (NavProgress) stops at that moment instead of guessing from what changed on the page.
export default function Btn({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => { if (was.current && !pending) window.dispatchEvent(new Event('wr-form-done')); was.current = pending; }, [pending]);
  return (
    <button {...rest} className={className} disabled={pending || rest.disabled} aria-busy={pending}>
      {pending && <span className="spin" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}
