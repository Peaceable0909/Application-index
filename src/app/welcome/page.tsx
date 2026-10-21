import Script from 'next/script';
import { admin } from '@/lib/supabase';
import Logo from '@/components/Logo';
import Icon from '@/components/Icon';
import ScrollStory from './ScrollStory';
import OpenChat from './OpenChat';
import { BEATS, FEATURES, UNIVERSITIES } from './content';
import { frameUrl } from './frames';
import './welcome.css';

export const metadata = {
  title: 'Study abroad with WhiteRock',
  description: 'WhiteRock Educational Services helps you choose a course, send your documents and talk to a real counsellor, all in one place.',
  openGraph: { title: 'Study abroad with WhiteRock', description: 'Choose a course, send your documents and talk to a real counsellor, all in one place.', images: [{ url: '/brand/og.png', width: 1200, height: 630 }] },
};

/** Public front page. The scroll film plays the student's own video; the chat buttons only show for a country whose chat an admin switched on. */
export default async function Welcome({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const sp = await searchParams;
  const { data } = await admin().from('portal_workspaces').select('key, name').eq('active', true).eq('lead_chat', true).order('key');
  const open = data ?? [];
  const want = String(sp.ws || '').toLowerCase();
  const chat = open.find((w) => w.key === want) ?? open.find((w) => w.key === 'uk') ?? open[0] ?? null;
  const unis = chat ? UNIVERSITIES[chat.key] : undefined;

  const ChatButton = ({ className, children }: { className: string; children: React.ReactNode }) => chat ? <OpenChat ws={chat.key} className={className} label="Chat with an adviser">{children}</OpenChat> : null;

  return (
    <div className="wl">
      <header className="wl-top">
        <a href="/welcome" aria-label="WhiteRock home"><Logo height={28} alt="WhiteRock" /></a>
        <nav aria-label="Main">
          <a href="#how" className="wl-link hide-s">How it works</a>
          <a href="/student/login" className="wl-link">Student sign in</a>
          <ChatButton className="wl-btn sm"><Icon n="chat" size={16} /><span>Chat with an adviser</span></ChatButton>
        </nav>
      </header>

      <section className="wl-hero">
        <p className="wl-eyebrow">WhiteRock Educational Services</p>
        <h1>Study abroad, <em>one clear step at a time.</em></h1>
        <p className="wl-lede">Ask your questions, send your documents and speak to a real counsellor. Everything for your application lives in one place.</p>
        <div className="wl-cta">
          <ChatButton className="wl-btn"><Icon n="chat" size={18} /><span>Chat with an adviser</span></ChatButton>
          <a href="/student/login" className="wl-btn ghost"><span>Student sign in</span></a>
        </div>
        <a href="#how" className="wl-scroll" aria-label="See how it works"><span>Scroll to follow one student's journey</span><Icon n="down" size={18} /></a>
      </section>

      <section id="how" aria-labelledby="how-h">
        <h2 id="how-h" className="wl-sr">How it works</h2>
        <ScrollStory />
        {/* the same story as pictures and words, for people who have motion switched off (and for screen readers) */}
        <ol className="wl-still">
          {BEATS.map((b, i) => (
            <li key={b.title}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={frameUrl(b.still)} alt="" loading="lazy" width={1600} height={900} />
              <div><small>{String(i + 1).padStart(2, '0')} / {String(BEATS.length).padStart(2, '0')}</small><h3>{b.title}</h3><p>{b.text}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="wl-block" aria-labelledby="why-h">
        <p className="wl-eyebrow">Why WhiteRock</p>
        <h2 id="why-h">Everything you need, in one portal.</h2>
        <div className="wl-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="wl-feat">
              <span className="wl-ico"><Icon n={f.icon} size={22} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      {unis && (
        <section className="wl-block narrow" aria-labelledby="uni-h">
          <h2 id="uni-h" className="small">{unis.heading}</h2>
          <ul className="wl-pills">{unis.names.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}

      <section className="wl-end">
        <h2>Ready when you are.</h2>
        <p>Say hello and tell us what you would like to study. There is nothing to fill in first.</p>
        <div className="wl-cta center">
          <ChatButton className="wl-btn light"><Icon n="chat" size={18} /><span>Chat with an adviser</span></ChatButton>
          <a href="/student/login" className="wl-btn outline"><span>Student sign in</span></a>
        </div>
      </section>

      <footer className="wl-foot">
        <Logo height={24} alt="WhiteRock" />
        <span>WhiteRock Educational Services</span>
        <nav aria-label="Sign in"><a href="/student/login">Student sign in</a><a href="/login">Team sign in</a></nav>
      </footer>

      {chat && <Script src="/chat-bubble.js" strategy="afterInteractive" data-ws={chat.key} data-src="website" data-label="Chat with an adviser" />}
    </div>
  );
}
