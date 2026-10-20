'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import Avatar from './Avatar';
import { sendNudge, skipNudge } from '@/app/outreachActions';

type R = { kind: string; text: string };
export type NudgeView = { appId: string; name: string; school: string | null; reasons: R[]; email: string | null };

const TONE: Record<string, string> = { reply: 'red', docs: 'amber', passport: 'amber', interview: 'blue', follow_up: '' };

/** One student on the follow-up list: why, a draft from the Brain, and send / skip. The person always reads and sends. */
export default function NudgeCard({ n, brain }: { n: NudgeView; brain: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState<'' | 'draft' | 'chat' | 'email' | 'skip'>(''), [note, setNote] = useState<{ ok: boolean; text: string } | null>(null), [gone, setGone] = useState(false);
  const kinds = n.reasons.map((r) => r.kind).join(',');

  async function draft() {
    setOpen(true); setBusy('draft'); setNote(null);
    try {
      const r = await fetch('/api/outreach/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: n.appId }) });
      const j = (await r.json()) as { reply?: string; needsHuman?: boolean; why?: string; error?: string };
      if (!r.ok || !j.reply) setNote({ ok: false, text: j.error || 'No draft this time. Write it yourself.' });
      else { setText(j.reply); setNote({ ok: !j.needsHuman, text: j.needsHuman ? `Check it carefully: ${j.why || 'the Brain wasn’t sure.'}` : 'Draft ready. Read it before you send.' }); }
    } catch { setNote({ ok: false, text: 'Couldn’t reach the Brain. Write it yourself.' }); }
    setBusy('');
  }
  async function send(channel: 'chat' | 'email') {
    if (!text.trim() || busy) return;
    setBusy(channel); setNote(null);
    const fd = new FormData(); fd.set('appId', n.appId); fd.set('body', text); fd.set('channel', channel); fd.set('kinds', kinds);
    const r = await sendNudge(fd);
    setBusy('');
    if (!r.ok) return setNote({ ok: false, text: r.error || 'Could not send.' });
    setNote({ ok: true, text: channel === 'chat' ? 'Sent in their chat.' : 'Sent by email.' }); setGone(true); setTimeout(() => router.refresh(), 900);
  }
  async function skip() {
    setBusy('skip');
    const fd = new FormData(); fd.set('appId', n.appId); fd.set('kinds', kinds); fd.set('days', '3');
    await skipNudge(fd); setGone(true); router.refresh();
  }

  return (
    <div className={`card nudge ${gone ? 'gone' : ''}`}>
      <div className="nudge-head">
        <Avatar name={n.name} size={42} />
        <div className="nudge-who"><Link href={`/applications/${encodeURIComponent(n.appId)}`}><b>{n.name}</b></Link><small className="muted">{n.school || ''}</small></div>
        <div className="nudge-act">
          {!open && brain && <button type="button" className="btn primary sm" onClick={draft}><Icon n="spark" size={14} /> Write it for me</button>}
          {!open && <button type="button" className="btn ghost sm" onClick={() => { setOpen(true); }}>Write myself</button>}
          <button type="button" className="btn ghost sm" onClick={skip} disabled={!!busy} title="Hide for 3 days">Not today</button>
        </div>
      </div>
      <ul className="nudge-why">{n.reasons.map((r, i) => <li key={i}><span className={`badge plain ${TONE[r.kind] || ''}`}>{r.kind === 'reply' ? 'Reply' : r.kind === 'docs' ? 'Documents' : r.kind === 'passport' ? 'Passport' : r.kind === 'interview' ? 'Interview' : 'Check in'}</span> {r.text}</li>)}</ul>
      {open && (
        <div className="grid" style={{ gap: 8, marginTop: 10 }}>
          {busy === 'draft' ? <p className="muted" style={{ margin: 0 }}><span className="pspin2" style={{ display: 'inline-block', width: 16, height: 16, borderWidth: 2, verticalAlign: 'middle', marginRight: 8 }} />The Brain is writing…</p>
            : <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder="Write your message" />}
          {note && <small className={note.ok ? 'ok-t' : 'bad-t'}>{note.text}</small>}
          <div className="filters">
            <button type="button" className="btn primary sm" onClick={() => send('chat')} disabled={!text.trim() || !!busy}>{busy === 'chat' ? 'Sending…' : 'Send in chat'}</button>
            <button type="button" className="btn ghost sm" onClick={() => send('email')} disabled={!text.trim() || !!busy}>{busy === 'email' ? 'Sending…' : 'Send by email'}</button>
            {brain && text && <button type="button" className="btn ghost sm" onClick={draft} disabled={!!busy}>Write another</button>}
          </div>
        </div>
      )}
    </div>
  );
}
