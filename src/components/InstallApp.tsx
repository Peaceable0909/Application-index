'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';

type BIP = Event & { prompt: () => Promise<void> };
/** Offers "install on your phone": native prompt where supported, a short how-to on iPhone. */
export default function InstallApp() {
  const [evt, setEvt] = useState<BIP | null>(null), [ios, setIos] = useState(false), [installed, setInstalled] = useState(false);
  useEffect(() => {
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    const h = (e: Event) => { e.preventDefault(); setEvt(e as BIP); }; window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (installed) return <p className="st-sub" style={{ margin: 0 }}>The app is installed on this device ✓</p>;
  return (
    <div>
      {evt ? <button className="st-btn" onClick={async () => { await evt.prompt(); setEvt(null); }}><Icon n="download" size={16} /> Install the app</button>
        : ios ? <p className="st-sub" style={{ margin: 0 }}>On iPhone: tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.</p>
        : <p className="st-sub" style={{ margin: 0 }}>Open the browser menu and choose <b>Install app</b> or <b>Add to Home Screen</b>.</p>}
    </div>
  );
}
