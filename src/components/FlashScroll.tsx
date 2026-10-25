'use client';
import { useEffect } from 'react';

/** When a page comes back with a message (done, or something went wrong) after a form, bring that message into view so nobody has to hunt for it. */
export default function FlashScroll() {
  useEffect(() => { document.querySelector('[data-flash]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, []);
  return null;
}
