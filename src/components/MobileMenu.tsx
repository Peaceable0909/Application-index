'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/** Hamburger + backdrop that slide the sidebar in as a drawer on phones/tablets. */
export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', open);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); document.documentElement.classList.remove('menu-open'); };
  }, [open]);
  return (
    <>
      <button type="button" className="burger iconbtn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span /><span /><span />
      </button>
      <div className="scrim" onClick={() => setOpen(false)} />
    </>
  );
}
