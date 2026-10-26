import Script from 'next/script';
import { admin } from '@/lib/supabase';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import ScrollStory, { PanelBody } from './ScrollStory';
import OpenChat from './OpenChat';
import { PANELS, UNIVERSITIES } from './content';
import { frameUrl } from './frames';
import './welcome.css';

export const metadata = {
  title: 'Study abroad with WhiteRock',
  description: 'WhiteRock Educational Services helps you choose a course, send your documents and talk to a real counsellor, all in one place.',
  openGraph: { title: 'Study abroad with WhiteRock', description: 'Choose a course, send your documents and talk to a real counsellor, all in one place.', images: [{ url: '/brand/og.png', width: 1200, height: 630 }] },
};

/** Public front page: one film that follows the scroll, with the information written into the white space around her. The chat buttons only show for a country whose chat an admin switched on. */
export default async function Welcome({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const sp = await searchParams;
  const { data } = await admin().from('portal_workspaces').select('key, name').eq('active', true).eq('lead_chat', true).order('key');
  const open = data ?? [];
  const want = String(sp.ws || '').toLowerCase();
  const chat = open.find((w) => w.key === want) ?? open.find((w) => w.key === 'uk') ?? open[0] ?? null;
  const ws = chat?.key ?? null;
  const unis = UNIVERSITIES[ws ?? (want || 'uk')] ?? null;
  const shown = PANELS.filter((p) => p.id !== 'apply' || unis);

  return (
    <div className="wl">
      <header className="wl-top">
        <a href="/welcome" aria-label="WhiteRock home"><Logo height={28} alt="WhiteRock" /></a>
        <nav aria-label="Main">
          <a href="/student/login" className="wl-link">Student sign in</a>
          {ws && <OpenChat ws={ws} className="wl-btn sm" label="Chat with an adviser"><Icon n="chat" size={16} /><span>Chat with an adviser</span></OpenChat>}
        </nav>
      </header>

      <ScrollStory ws={ws} unis={unis} />

      {/* the same story as pictures and words, for people who have motion switched off (and when scripts are blocked) */}
      <ol className="wl-still">
        {shown.map((p) => (
          <li key={p.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frameUrl(p.still)} alt="" loading="lazy" width={1600} height={900} />
            <div><PanelBody p={p} ws={ws} unis={unis} /></div>
          </li>
        ))}
      </ol>
      <noscript><style>{'.wl-story{display:none}.wl-still{display:grid;gap:48px;max-width:1100px;margin:0 auto;padding:96px 20px 40px;list-style:none}.wl-top{position:sticky}'}</style></noscript>

      <footer className="wl-foot">
        <Logo height={24} alt="WhiteRock" />
        <span>WhiteRock Educational Services</span>
        <nav aria-label="Sign in and policies"><a href="/student/login">Student sign in</a><a href="/login">Team sign in</a><a href="/privacy">Privacy policy</a></nav>
      </footer>

      {ws && <Script src="/chat-bubble.js" strategy="afterInteractive" data-ws={ws} data-src="website" data-label="Chat with an adviser" />}
    </div>
  );
}
