'use client';
import { useState } from 'react';
import Icon from './Icon';

export default function CopyLink({ href }: { href: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm" onClick={async () => { try { await navigator.clipboard.writeText(href); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* the link is shown anyway */ } }}>
      <Icon n={done ? 'check' : 'link'} size={14} /> {done ? 'Copied' : 'Copy link'}
    </button>
  );
}
