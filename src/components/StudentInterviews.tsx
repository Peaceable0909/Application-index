'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { studentBookSlot, studentCancelBooking } from '@/app/actions';
import LocalTime from './LocalTime';
import Icon from './Icon';

export type SlotView = { id: string; starts_at: string; duration_min: number; notes: string | null; free: number };
export type MyBooking = { id: string; starts_at: string; duration_min: number; teams_url: string; notes: string | null; status: string; feedback: string | null; canCancel: boolean; gcal: string };

export default function StudentInterviews({ slots, upcoming, past, hasUpcoming }: { slots: SlotView[]; upcoming: MyBooking[]; past: MyBooking[]; hasUpcoming: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(key); setMsg(null);
    const r = await fn();
    setMsg(r.ok ? { t: okText } : { t: r.error || 'Something went wrong', bad: true });
    setBusy(null); router.refresh();
  }
  return (
    <div className="card scard-big rise">
      <div className="sb-head"><h2 style={{ margin: 0 }}><Icon n="video" size={18} /> Interview training</h2></div>
      <p className="muted" style={{ marginTop: -8 }}>Practise real interview questions with a trainer on Microsoft Teams. Pick a time that suits you.</p>
      {msg && <div className={`xnote ${msg.bad ? 'bad' : ''}`} style={{ marginBottom: 12 }}>{msg.t}</div>}

      {upcoming.map((b) => (
        <div key={b.id} className="ibook">
          <div><div className="eyebrow">Your booking</div><b style={{ fontSize: 18, color: 'var(--ink)' }}><LocalTime iso={b.starts_at} long /></b><div className="muted" style={{ fontSize: 13 }}>{b.duration_min} minutes · Microsoft Teams{b.notes ? ` · ${b.notes}` : ''}</div></div>
          <div className="filters">
            <a className="btn" href={b.teams_url} target="_blank" rel="noreferrer"><Icon n="video" size={15} /> Join on Teams</a>
            <a className="btn ghost sm" href={b.gcal} target="_blank" rel="noreferrer">Add to Google Calendar</a>
            {b.canCancel && <button className="btn ghost sm" disabled={busy === b.id} onClick={() => confirm('Cancel this session?') && run(b.id, () => studentCancelBooking(b.id), 'Your session was cancelled.')}>Cancel</button>}
          </div>
        </div>
      ))}

      {!hasUpcoming && (
        <>
          <h3 style={{ margin: '4px 0 10px', fontSize: 15.5 }}>Available times</h3>
          {!slots.length && <p className="muted" style={{ margin: 0 }}>No sessions are open right now. Please check back soon, or message your counselor.</p>}
          <ul className="dlist">
            {slots.map((sl) => (
              <li key={sl.id}><span className="dstat" style={{ background: '#eef3ff', color: 'var(--blue)' }}><Icon n="clock" size={14} /></span>
                <div className="dmain"><b><LocalTime iso={sl.starts_at} /></b><small>{sl.duration_min} minutes{sl.notes ? ` · ${sl.notes}` : ''}{sl.free > 1 ? ` · ${sl.free} places left` : ''}</small></div>
                <button className="btn sm" disabled={!!busy} onClick={() => run(sl.id, () => studentBookSlot(sl.id), 'Booked! We’ve emailed you the Teams link and a calendar invite.')}>{busy === sl.id ? 'Booking…' : 'Book'}</button></li>
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 18 }}><h3 style={{ margin: '0 0 8px', fontSize: 15.5 }}>Past sessions</h3>
          {past.map((b) => <div key={b.id} className="pastb"><div><b><LocalTime iso={b.starts_at} /></b> <span className="muted">· {b.status === 'completed' ? 'Completed' : b.status === 'no_show' ? 'Missed' : b.status}</span></div>{b.feedback && <div className="fb"><b>Feedback from your trainer</b><div>{b.feedback}</div></div>}</div>)}
        </div>
      )}
    </div>
  );
}
