'use client';
import { useMemo, useState } from 'react';
import Icon from './Icon';

export default function SlotForm({ action, people, defaultTrainer, defaultUrl }: { action: (f: FormData) => void; people: { email: string; name: string }[]; defaultTrainer: string; defaultUrl: string }) {
  const tomorrow = new Date(Date.now() + 864e5), pad = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
  const [time, setTime] = useState('15:00');
  const [weeks, setWeeks] = useState(1);
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
      <div className="pgrid">
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={{ width: '100%', marginTop: 6 }} /></label>
        <label>Start time <span className="muted">({zone})</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} required style={{ width: '100%', marginTop: 6 }} /></label>
        <label>Repeat weekly for<select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ width: '100%', marginTop: 6 }}>{[1, 2, 3, 4, 6, 8, 12].map((n) => <option key={n} value={n}>{n === 1 ? 'This date only' : `${n} weeks`}</option>)}</select></label>
        <label>Length<select name="duration" defaultValue="45" style={{ width: '100%', marginTop: 6 }}>{[30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
        <label>Students per session<select name="capacity" defaultValue="1" style={{ width: '100%', marginTop: 6 }}>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n === 1 ? '1 (one-to-one)' : n}</option>)}</select></label>
        <label>Trainer<select name="trainer" defaultValue={defaultTrainer} style={{ width: '100%', marginTop: 6 }}>{people.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</select></label>
        <label style={{ gridColumn: '1 / -1' }}>Microsoft Teams meeting link<input name="teams_url" defaultValue={defaultUrl} required placeholder="https://teams.microsoft.com/l/meetup-join/…" style={{ width: '100%', marginTop: 6 }} /></label>
        <label style={{ gridColumn: '1 / -1' }}>Note for students (optional)<input name="notes" maxLength={300} placeholder="e.g. Bring your CV and passport" style={{ width: '100%', marginTop: 6 }} /></label>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>In Teams: <b>Calendar → New meeting</b> (or <b>Meet now</b>), then <b>Copy meeting link</b>. One link can be reused for every session. {starts.length > 1 && `This will create ${starts.length} sessions.`}</p>
      <div className="filters" style={{ marginTop: 14 }}><button className="btn" disabled={!starts.length}>Create {starts.length > 1 ? `${starts.length} sessions` : 'session'}</button></div>
    </form>
  );
}
