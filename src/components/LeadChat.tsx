'use client';
import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

type Msg = { id: string; mine: boolean; body: string; at: string; ai: boolean; staff: boolean };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** The new-student chat: bubbles like a messaging app, an AI label on the assistant, consent before the first message. */
/** In the bubble on another website the browser may not keep our cookie, so the chat's secret is also kept in the browser's own storage and sent along. */
const KEY = (ws: string) => `wr_lead_${ws}`;
const stored = (ws: string) => { try { return localStorage.getItem(KEY(ws)) || ''; } catch { return ''; } };

export default function LeadChat({ ws, country, src, embed }: { ws: string; country: string; src?: string | null; embed?: boolean }) {
  const hdr = (): Record<string, string> => (embed ? { 'x-lead-embed': '1', ...(stored(ws) ? { 'x-lead-token': stored(ws) } : {}) } : {});
  const [msgs, setMsgs] = useState<Msg[]>([]), [text, setText] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [consent, setConsent] = useState(false), [ready, setReady] = useState(false), [trap, setTrap] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const load = async () => { try { const r = await fetch(`/api/hello/${ws}`, { cache: 'no-store', headers: hdr() }); if (r.ok) { const j = (await r.json()) as { messages: Msg[] }; setMsgs((cur) => (j.messages.length >= cur.filter((m) => !m.id.startsWith('tmp')).length ? j.messages : cur)); } } catch { /* try again next time */ } setReady(true); };
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 6000); return () => clearInterval(t); }, [ws]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs.length, busy]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setErr(''); setBusy(true); setText('');
    setMsgs((m) => [...m, { id: 'tmp' + Date.now(), mine: true, body, at: new Date().toISOString(), ai: false, staff: false }]);
    try {
      const r = await fetch(`/api/hello/${ws}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr() }, body: JSON.stringify({ body, consent, website: trap, src: src || undefined }) });
      const j = (await r.json()) as { ok?: boolean; messages?: Msg[]; error?: string; token?: string };
      if (j.token) { try { localStorage.setItem(KEY(ws), j.token); } catch { /* the chat still works for this visit */ } }
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not send. Please try again.'); setText(body); setMsgs((m) => m.filter((x) => !x.id.startsWith('tmp'))); }
      else setMsgs(j.messages || []);
    } catch { setErr('No connection. Please try again.'); setText(body); setMsgs((m) => m.filter((x) => !x.id.startsWith('tmp'))); }
    setBusy(false);
  }
  const started = msgs.length > 0;
  return (
    <div className="hello-chat">
      <div className="hello-log" aria-live="polite">
        <div className="hello-note">You’re chatting with WhiteRock’s AI assistant. It answers from what our team has taught it, and a counselor can step in. Please don’t share passport numbers or bank details here.</div>
        {!started && ready && <div className="hello-b them"><p>Hi! I can help with studying in {country}: schools, requirements, costs and next steps. What would you like to study, and when are you hoping to start?</p><span className="meta"><i className="ai-tag">AI assistant</i></span></div>}
        {msgs.map((m) => (
          <div key={m.id} className={`hello-b ${m.mine ? 'me' : 'them'}`}>
            <p>{m.body}</p>
            <span className="meta">{m.ai && <i className="ai-tag">AI assistant</i>}{m.staff && <i className="ai-tag person">Counselor</i>}{clock(m.at)}</span>
          </div>
        ))}
        {busy && <div className="hello-b them typing"><p><i /><i /><i /></p></div>}
        <div ref={end} />
      </div>
      {!started && (
        <label className="hello-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree that WhiteRock keeps this chat and may contact me about studying abroad.</label>
      )}
      {err && <p className="hello-err">{err}</p>}
      <form className="hello-send" onSubmit={send}>
        <input type="text" name="website" value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hello-trap" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={600} placeholder="Type a message" aria-label="Message" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="hello-go" disabled={busy || !text.trim() || (!started && !consent)} aria-label="Send"><Icon n="send" size={20} /></button>
      </form>
    </div>
  );
}
