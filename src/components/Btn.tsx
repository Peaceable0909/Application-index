'use client';
import { useFormStatus } from 'react-dom';

// Submit button with a spinner + disabled state while its server action runs.
export default function Btn({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} className={className} disabled={pending || rest.disabled} aria-busy={pending}>
      {pending && <span className="spin" aria-hidden />}
      <span>{children}</span>
    </button>
  );
}
