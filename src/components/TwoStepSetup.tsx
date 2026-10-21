'use client';
import { useState, useTransition } from 'react';
import { finishTwoStep, startTwoStep } from '@/app/twoStepActions';

type Started = { factorId: string; qr: string; secret: string };

/** Three small steps: install an authenticator app, scan the picture, type the code it shows. */
export default function TwoStepSetup({ next }: { next: string }) {
  const [s, setS] = useState<Started | null>(null), [code, setCode] = useState(''), [err, setErr] = useState('');
  const [busy, go] = useTransition();
  const start = () => go(async () => {
    setErr('');
    const r = await startTwoStep();
    if (r.ok) setS(r); else setErr(r.error);
  });
  const finish = () => go(async () => {
    if (!s) return;
    setErr('');
    const r = await finishTwoStep(s.factorId, code);
    if (r.ok) window.location.assign(next); else setErr(r.error);
  });
  if (!s) return (
    <div>
      <ol style={{ margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
        <li>On your phone, install an authenticator app (Google Authenticator, Microsoft Authenticator or Authy).</li>
        <li>Press the button below and scan the picture with the app.</li>
        <li>Type the 6 numbers the app shows.</li>
      </ol>
      <button type="button" className="btn primary" onClick={start} disabled={busy}>{busy ? 'Getting ready…' : 'Start setup'}</button>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
  return (
    <div className="grid" style={{ gap: 12, maxWidth: 380 }}>
      <p style={{ margin: 0 }}>Scan this with your authenticator app:</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={s.qr} alt="QR code to scan with your authenticator app" width={180} height={180} style={{ background: '#fff', padding: 8, borderRadius: 12 }} />
      <details><summary className="muted" style={{ cursor: 'pointer' }}>Can’t scan? Type this key into the app instead</summary><code style={{ wordBreak: 'break-all', display: 'block', marginTop: 6 }}>{s.secret}</code></details>
      <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="6-digit code" style={{ fontSize: 20, letterSpacing: 5, textAlign: 'center' }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } }} />
      <button type="button" className="btn primary" onClick={finish} disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? 'Checking…' : 'Turn on two-step sign-in'}</button>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
