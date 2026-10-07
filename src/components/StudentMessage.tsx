'use client';
import { useState } from 'react';
import { studentMessage } from '@/app/actions';
import Icon from './Icon';

export default function StudentMessage({ appId, counselor }: { appId: string; counselor: string }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  async function send() {
    if (text.trim().length < 3 || busy) return;
    setBusy(true); setMsg(null);
    const fd = new FormData(); fd.set('appId', appId); fd.set('body', text);
    const r = await studentMessage(fd);
    if (r.ok) { setText(''); setMsg({ t: `Sent to ${counselor}. They’ll reply to your email.` }); } else setMsg({ t: r.error || 'Could not send', bad: true });
    setBusy(false);
  }
  return (
    <div className="smsg">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Write to ${counselor}…`} maxLength={1500} rows={3} />
      <div className="filters"><button className="btn sm" onClick={send} disabled={busy || text.trim().length < 3}><Icon n="send" size={14} /> {busy ? 'Sending…' : 'Send message'}</button>{msg && <small className={msg.bad ? 'bad-t' : 'ok-t'}>{msg.t}</small>}<small className="muted" style={{ marginLeft: 'auto' }}>{text.length}/1500</small></div>
    </div>
  );
}
