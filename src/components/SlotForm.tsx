'use client';
import { useMemo, useState } from 'react';
import Icon from './Icon';

export type Invitee = { id: string; name: string; school: string; counselor: string; hasEmail: boolean };

export default function SlotForm({ action, people, defaultTrainer, defaultUrl, students }: { action: (f: FormData) => void; people: { email: string; name: string }[]; defaultTrainer: string; defaultUrl: string; students: Invitee[] }) {
  const tomorrow = new Date(Date.now() + 864e5), pad = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
  const [time, setTime] = useState('15:00');
  const [weeks, setWeeks] = useState(1);
  const [mode, setMode] = useState<'auto' | 'paste'>('auto');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const shown = students.filter((s) => !q.trim() || `${s.name} ${s.school} ${s.counselor}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 20 ? p : [...p, id]));
  const starts = useMemo(() => {
    const out: string[] = [];
    for (let w = 0; w < weeks; w++) { const d = new Date(`${date}T${time}`); if (isNaN(d.getTime())) return []; d.setDate(d.getDate() + w * 7); out.push(d.toISOString()); }
    return out;
  }, [date, time, weeks]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <form action={action} className="card">
      <h2><Icon n="video" size={17} /> New interview-training session</h2>
      <input type="hidden" name="starts" value={JSON.stringify(starts)} />
      {picked.map((id) => <input key={id} type="hidden" name="invite" value={id} />)}
      <div className="pgrid">
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ width: '100%', marginTop: 6 }} /></label>
        <label>Start time <span className="muted">({zone})</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} required style={{ width: '100%', marginTop: 6 }} /></label>
        <label>Repeat weekly for<select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ width: '100%', marginTop: 6 }}>{[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n === 1 ? 'This date only' : `${n} weeks`}</option>)}</select></label>
        <label>Length<select name="duration" defaultValue="45" style={{ width: '100%', marginTop: 6 }}>{[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
        <label>Students per session<select name="capacity" defaultValue="1" style={{ width: '100%', marginTop: 6 }}>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n === 1 ? '1 (one-to-one)' : n}</option>)}</select></label>
        <label>Trainer<select name="trainer" defaultValue={defaultTrainer} style={{ width: '100%', marginTop: 6 }}>{people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></label>
        <div style={{ gridColumn: '1 / -1' }} className="linkmode">
          <label className={mode === 'auto' ? 'on' : ''}><input type="radio" name="link_mode" value="auto" checked={mode === 'auto'} onChange={() => setMode('auto')} /><span><b>Create a Google Meet link for each session</b><small>Recommended. Every session gets its own link and appears in your Google Calendar.</small></span></label>
          <label className={mode === 'paste' ? 'on' : ''}><input type="radio" name="link_mode" value="paste" checked={mode === 'paste'} onChange={() => setMode('paste')} /><span><b>Use a link I paste</b><small>One Google Meet (or Teams) link reused for every session.</small></span></label>
        </div>
        {mode === 'paste' && <label style={{ gridColumn: '1 / -1' }}>Meeting link<input name="teams_url" defaultValue={defaultUrl} required placeholder="https://meet.google.com/abc-defg-hij" style={{ width: '100%', marginTop: 6 }} /></label>}
        <div style={{ gridColumn: '1 / -1' }} className="invitebox">
          <div className="stat-l" style={{ marginBottom: 6 }}>Invite students <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(optional · they and their counselors get an email straight away)</span></div>
          {picked.length > 0 && <div className="refchips">{picked.map((id) => { const st = students.find((x) => x.id === id); return <span key={id} className="refchip">{st?.name || 'Student'}<button type="button" aria-label="Remove" onClick={() => toggle(id)}>×</button></span>; })}</div>}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students by name, university or counselor…" style={{ width: '100%' }} />
          <div className="pick-list" style={{ maxHeight: 200, marginTop: 8 }}>
            {shown.map((st) => { const on = picked.includes(st.id); return (
              <button type="button" key={st.id} className={`pick ${on ? 'on' : ''}`} onClick={() => toggle(st.id)} disabled={!st.hasEmail}>
                <span className="sinit">{st.name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
                <div><b>{st.name}</b><small>{[st.school, st.counselor || 'no counselor', st.hasEmail ? '' : 'no email'].filter(Boolean).join(' · ')}</small></div>
                <span className="tick">{on && <Icon n="check" size={15} />}</span>
              </button>); })}
            {!shown.length && <p className="muted" style={{ padding: 14, margin: 0 }}>No students match.</p>}
          </div>
          {weeks > 1 && picked.length > 0 && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>With weekly repeats, the invited students are booked into the first session only.</div>}
        </div>
        <label style={{ gridColumn: '1 / -1' }}>Note for students (optional)<input name="notes" maxLength={300} placeholder="e.g. Bring your CV and passport" style={{ width: '100%', marginTop: 6 }} /></label>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>{mode === 'paste' ? <>To get a link: open <b>meet.google.com</b>, press <b>New meeting → Create a meeting for later</b>, and copy it. </> : null}{starts.length > 1 && `This will create ${starts.length} sessions.`}</p>
      <div className="filters" style={{ marginTop: 14 }}><button className="btn" disabled={!starts.length}>Create {starts.length > 1 ? `${starts.length} sessions` : 'session'}{picked.length ? ` and invite ${picked.length}` : ''}</button></div>
    </form>
  );
}
