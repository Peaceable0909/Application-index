'use client';
import { useState } from 'react';
import Icon from './Icon';

/** Collapsible section on phones; always open on desktop. */
export default function Fold({ label, badge, icon = 'filter', defaultOpen = false, children }: { label: string; badge?: number | string; icon?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`fold ${open ? 'open' : ''}`}>
      <button type="button" className="fold-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon n={icon} size={17} /><span>{label}</span>{badge ? <span className="n">{badge}</span> : null}<Icon n="down" size={16} />
      </button>
      <div className="fold-body">{children}</div>
    </div>
  );
}
