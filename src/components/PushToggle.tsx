'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';

type State = 'loading' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';
const b64 = (s: string) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

/** Turn phone/browser notifications on or off for this device. `banner` is a small dismissible invitation for the home screen. */
export default function PushToggle({ banner = false }: { banner?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    (async () => {
      try { if (localStorage.getItem('push-banner-dismissed') === '1') setHidden(true); } catch { /* optional */ }
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState(ios && !standalone ? 'install' : 'unsupported'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.getRegistration('/sw.js') || await navigator.serviceWorker.register('/sw.js').catch(() => undefined);
      const sub = reg ? await (await navigator.serviceWorker.ready).pushManager.getSubscription() : null;
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  async function enable() {
    setBusy(true); setMsg('');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); setBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      const k = (await (await fetch('/api/push/key')).json()) as { key?: string };
      if (!k.key) throw new Error('Notifications are not available right now.');
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.key) }));
      const r = (await (await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })).json()) as { ok: boolean; error?: string };
      if (!r.ok) throw new Error(r.error || 'Could not turn notifications on.');
      setState('on'); setMsg('Notifications are on for this device.');
    } catch (e) { setMsg((e as Error).message || 'Could not turn notifications on.'); }
    setBusy(false);
  }
  async function disable() {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { await fetch('/api/push/subscribe', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setState('off'); setMsg('Notifications are off for this device.');
    } catch { setMsg('Could not turn notifications off.'); }
    setBusy(false);
  }
  async function test() {
    setBusy(true); setMsg('');
    const r = (await fetch('/api/push/test', { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Network error' }))) as { ok: boolean; error?: string };
    setMsg(r.ok ? 'Sent. It should appear in a few seconds.' : r.error || 'Could not send a test.');
    setBusy(false);
  }

  if (banner) {
    if (hidden || state !== 'off') return null;
    return (
      <section className="st-card pn-banner">
        <span className="ic"><Icon n="bell" size={22} /></span>
        <div className="tx"><b>Get alerts on your phone</b><small>Know straight away when your counselor replies or something needs your attention.</small></div>
        <button className="st-btn sm" onClick={enable} disabled={busy}>{busy ? 'Turning on…' : 'Turn on'}</button>
        <button className="x" aria-label="Not now" onClick={() => { try { localStorage.setItem('push-banner-dismissed', '1'); } catch { /* optional */ } setHidden(true); }}>×</button>
        {msg && <small className="msg">{msg}</small>}
      </section>
    );
  }
  return (
    <div className="pn-box">
      {state === 'loading' && <p className="st-sub" style={{ margin: 0 }}>Checking…</p>}
      {state === 'unsupported' && <p className="st-sub" style={{ margin: 0 }}>This browser can’t show notifications. Try Chrome on Android, or Safari on iPhone after adding the app to your home screen.</p>}
      {state === 'install' && <p className="st-sub" style={{ margin: 0 }}>On iPhone, first add this app to your home screen (Share, then <b>Add to Home Screen</b>), open it from there, then come back here to turn notifications on.</p>}
      {state === 'denied' && <p className="st-sub" style={{ margin: 0 }}>Notifications are blocked for this site. Allow them in your browser or phone settings for this site, then reload this page.</p>}
      {state === 'off' && <button className="st-btn" onClick={enable} disabled={busy}><Icon n="bell" size={16} /> {busy ? 'Turning on…' : 'Turn on notifications'}</button>}
      {state === 'on' && <div className="pn-on"><span className="ok"><i /> Notifications are on for this device</span><div className="row"><button className="st-btn ghost sm" onClick={test} disabled={busy}>Send me a test</button><button className="st-btn ghost sm" onClick={disable} disabled={busy}>Turn off</button></div></div>}
      {msg && <p className="pn-msg">{msg}</p>}
    </div>
  );
}
