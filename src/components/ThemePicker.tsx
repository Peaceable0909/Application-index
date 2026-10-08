'use client';
import { useEffect, useState } from 'react';
import { ACCENTS, ACCENT_COLOR, MODES, MODE_LABEL, type Accent, type Mode } from '@/lib/theme';

/** Look & feel: pick light / soft / dark / auto and an accent colour. Applies instantly (with a soft circular reveal where the browser supports it) and is remembered. */
export default function ThemePicker({ initial }: { initial: { mode: Mode; accent: Accent } }) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [accent, setAccent] = useState<Accent>(initial.accent);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (mode !== 'system') return;
    const q = matchMedia('(prefers-color-scheme: dark)'), f = () => document.documentElement.setAttribute('data-theme', q.matches ? 'dark' : 'light');
    q.addEventListener('change', f);
    return () => q.removeEventListener('change', f);
  }, [mode]);

  function apply(m: Mode, a: Accent, at?: { x: number; y: number }) {
    const el = document.documentElement;
    const run = () => {
      el.setAttribute('data-accent', a);
      if (m === 'system') { el.setAttribute('data-pref', 'system'); el.setAttribute('data-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
      else { el.removeAttribute('data-pref'); el.setAttribute('data-theme', m); }
    };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vt = (document as unknown as { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (!reduce && vt && at) {
      el.style.setProperty('--tx', `${at.x}px`); el.style.setProperty('--ty', `${at.y}px`);
      vt.call(document, run);
    } else {
      el.classList.add('theme-fade'); run();
      setTimeout(() => el.classList.remove('theme-fade'), 450);
    }
  }
  async function save(m: Mode, a: Accent) {
    setMsg('');
    const r = (await fetch('/api/theme', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m, accent: a }) }).then((x) => x.json()).catch(() => ({ ok: false }))) as { ok: boolean };
    if (!r.ok) setMsg('Applied here, but could not be saved to your account.');
  }
  const pickMode = (m: Mode, e: React.MouseEvent) => { setMode(m); apply(m, accent, { x: e.clientX, y: e.clientY }); save(m, accent); };
  const pickAccent = (a: Accent, e: React.MouseEvent) => { setAccent(a); apply(mode, a, { x: e.clientX, y: e.clientY }); save(mode, a); };

  return (
    <div className="th-box">
      <div>
        <p className="th-lbl">Theme</p>
        <div className="th-modes" role="radiogroup" aria-label="Theme">
          {MODES.map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className="th-mode" onClick={(e) => pickMode(m, e)}>
              <span className={`th-prev ${m}`} aria-hidden><i className="bar" /><i className="c1" /><i className="c2" /><i className="c3" /></span>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="th-lbl">Accent colour</p>
        <div className="th-acc" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => <button key={a} role="radio" aria-checked={accent === a} aria-label={a} title={a} className="th-dot" style={{ background: ACCENT_COLOR[a] }} onClick={(e) => pickAccent(a, e)} />)}
        </div>
      </div>
      {msg && <p className="muted" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
