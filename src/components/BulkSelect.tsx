'use client';
import { useEffect, useRef, useState } from 'react';

/** Header checkbox: ticks / unticks every row checkbox (name="ids") in the same form. */
export function SelectAll() {
  const ref = useRef<HTMLInputElement>(null);
  return <input ref={ref} type="checkbox" aria-label="Select all" onChange={(e) => {
    ref.current?.closest('form')?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => { c.checked = e.target.checked; });
    ref.current?.closest('form')?.dispatchEvent(new Event('change', { bubbles: true }));
  }} />;
}

/** Live "3 selected" counter for the bulk bar. */
export function SelectedCount() {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form'); if (!form) return;
    const update = () => setN(form.querySelectorAll('input[name="ids"]:checked').length);
    form.addEventListener('change', update); update();
    return () => form.removeEventListener('change', update);
  }, []);
  return <span ref={ref} className="badge blue plain">{n} selected</span>;
}
