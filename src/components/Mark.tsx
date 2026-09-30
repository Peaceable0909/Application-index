// The Peaceable mark: a ringed monogram. `draw` animates it (splash screen).
export default function Mark({ size = 28, draw = false }: { size?: number; draw?: boolean }) {
  if (draw) {
    return (
      <svg className="splash-mark" viewBox="0 0 32 32" fill="none" aria-hidden>
        <rect className="ring" x="1.5" y="1.5" width="29" height="29" rx="9" stroke="#b8952a" strokeWidth="1.2" pathLength={100} />
        <path className="p" d="M11 23V9.5h5.2a4.2 4.2 0 0 1 0 8.4H11" stroke="#f6f4ef" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength={50} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0d1b3a" />
      <path d="M11 23V9.5h5.2a4.2 4.2 0 0 1 0 8.4H11" stroke="#b8952a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
