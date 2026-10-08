'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** The student app's outer frame. On the Messages page it goes "immersive": no logo bar, no tab bar, just the chat, like WhatsApp. */
export default function StudentFrame({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '';
  const immersive = path.startsWith('/student/messages');
  useEffect(() => {
    if (!immersive) return;
    // tint the phone's status bar to match the chat header while chatting
    const m = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null, was = m?.content;
    if (m) m.content = document.documentElement.getAttribute('data-theme') === 'dark' ? '#1f2c34' : '#008069';
    return () => { if (m && was) m.content = was; };
  }, [immersive]);
  return <div className={`stu-shell ${immersive ? 'immersive' : ''}`}>{children}</div>;
}
