'use client';
import { useEffect, useState } from 'react';
import Icon from './Icon';
import { looksLikePhoneInDesktopMode, noticeScale } from '@/lib/desktopMode';

const KEY = 'wr_desktop_notice';

/** Shown only when a phone is displaying the desktop version of the portal: says how to turn that off. It is enlarged by however much the page was shrunk, so it can be read. */
export default function DesktopModeNotice() {
  const [show, setShow] = useState(false), [k, setK] = useState(1);
  useEffect(() => {
    const check = () => {
      const vv = window.visualViewport;
      const hit = looksLikePhoneInDesktopMode({
        touchPoints: navigator.maxTouchPoints || 0, coarse: window.matchMedia('(pointer: coarse)').matches,
        innerWidth: window.innerWidth, innerHeight: window.innerHeight, screenW: screen.width, screenH: screen.height, scale: vv ? vv.scale : null, ua: navigator.userAgent,
      });
      let closed = false;
      try { closed = sessionStorage.getItem(KEY) === '1'; } catch { /* optional */ }
      setShow(hit && !closed);
      setK(noticeScale(vv ? vv.scale : null, window.innerWidth, screen.width, screen.height));
    };
    check();
    window.addEventListener('resize', check);
    window.visualViewport?.addEventListener('resize', check);
    return () => { window.removeEventListener('resize', check); window.visualViewport?.removeEventListener('resize', check); };
  }, []);
  if (!show) return null;
  return (
    <div className="dm-notice" role="status" style={{ ['--dm-k' as string]: k }}>
      <Icon n="alert" size={20} />
      <p><b>This looks like the desktop version of the site.</b> To get the phone layout, open your browser menu (in Chrome, the three dots) and turn off <b>Desktop site</b>.</p>
      <button type="button" className="dm-x" aria-label="Close this message" onClick={() => { try { sessionStorage.setItem(KEY, '1'); } catch { /* optional */ } setShow(false); }}><Icon n="x" size={18} /></button>
    </div>
  );
}
