'use client';
import { useEffect, useState } from 'react';
import Confirmed from './Confirmed';

/** Staff side: shows the animated confirmation once for a success message in the URL, then tidies the URL so a refresh doesn't replay it. */
export default function FlashSuccess({ message, title }: { message: string; title: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => { const u = new URL(location.href); if (u.searchParams.has('msg')) { u.searchParams.delete('msg'); history.replaceState(null, '', u.pathname + (u.search || '')); } }, []);
  return open ? <Confirmed title={title} lines={[message]} onClose={() => setOpen(false)} seconds={5} /> : null;
}
