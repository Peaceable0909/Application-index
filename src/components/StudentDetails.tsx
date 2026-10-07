'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { studentSaveDetails } from '@/app/actions';
import Icon from './Icon';

type Row = [string, string];
export default function StudentDetails({ locked, phone, city, preferred }: { locked: Row[]; phone: string; city: string; preferred: string }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ t: string; bad?: boolean } | null>(null);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setMsg(null);
    const r = await studentSaveDetails(new FormData(e.currentTarget));
    if (r.ok) { setEdit(false); setMsg({ t: r.sheet === false ? 'Saved. Your counselor will see the update shortly.' : 'Saved ✓' }); router.refresh(); } else setMsg({ t: r.error || 'Could not save', bad: true });
    setBusy(false);
  }
  return (
    <div className="card scard-big rise">
      <div className="sb-head"><h2 style={{ margin: 0 }}><Icon n="user" size={18} /> My details</h2>{!edit && <button className="btn ghost sm" onClick={() => { setEdit(true); setMsg(null); }}>Edit contact details</button>}</div>
      <div className="sgrid">
        <dl className="kv narrow-k">
          {locked.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v || '—'}</dd></Fragment>)}
        </dl>
        {edit ? (
          <form onSubmit={save} className="grid" style={{ gap: 12, alignContent: 'start' }}>
            <label>Phone number<input name="phone" defaultValue={phone} placeholder="+234…" inputMode="tel" maxLength={30} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>City<input name="city" defaultValue={city} maxLength={60} style={{ width: '100%', marginTop: 6 }} /></label>
            <label>What should we call you?<input name="preferred" defaultValue={preferred} placeholder="e.g. Felix" maxLength={40} style={{ width: '100%', marginTop: 6 }} /></label>
            <div className="filters"><button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button><button type="button" className="btn ghost" onClick={() => setEdit(false)}>Cancel</button>{msg && <small className={msg.bad ? 'bad-t' : 'ok-t'}>{msg.t}</small>}</div>
          </form>
        ) : (
          <dl className="kv narrow-k" style={{ alignContent: 'start' }}>
            <dt>Phone</dt><dd>{phone || <span className="muted">Not added yet</span>}</dd>
            <dt>City</dt><dd>{city || <span className="muted">Not added yet</span>}</dd>
            <dt>Called</dt><dd>{preferred || <span className="muted">Not set</span>}</dd>
            {msg && <><dt /><dd><small className={msg.bad ? 'bad-t' : 'ok-t'}>{msg.t}</small></dd></>}
          </dl>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '14px 0 0' }}>Spotted a mistake in your name, email or other details? Message your counselor and they will correct it.</p>
    </div>
  );
}
