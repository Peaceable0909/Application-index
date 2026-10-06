'use client';
import { useEffect, useState } from 'react';

/** A moment shown in the viewer's own time zone (the server doesn't know it). */
export default function LocalTime({ iso, long = false, withZone = true }: { iso: string; long?: boolean; withZone?: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const d = new Date(iso);
    const day = d.toLocaleDateString(undefined, long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value;
    setText(`${day}, ${time}${withZone && zone ? ` ${zone}` : ''}`);
  }, [iso, long, withZone]);
  return <span suppressHydrationWarning>{text || new Date(iso).toUTCString().slice(0, 22) + ' UTC'}</span>;
}
