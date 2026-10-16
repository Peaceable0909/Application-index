'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';

type Status = { total: number; checked: number; unchecked: number; uncheckedOther: number; used: number; limit: number; budget: number };
type Step = { ok: number; flagged: number; failed: { id: string; error: string }[]; stop: 'limit' | 'time' | 'off' | null; left: number; budget: number; error?: string };

/** Reads every unchecked document in small batches, so the page can show progress and be stopped at any time. */
export default function ScanAll({ initial }: { initial: Status }) {
  const router = useRouter();
  const [st, setSt] = useState(initial), [run, setRun] = useState(false), [done, setDone] = useState(0), [flagged, setFlagged] = useState(0), [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const stop = useRef(false);

  useEffect(() => setSt(initial), [initial]);

  async function go() {
    stop.current = false; setRun(true); setNote(null); setDone(0); setFlagged(0);
    const skip: string[] = []; let n = 0, fl = 0, left = st.unchecked, budget = st.budget, why = '', bad = false;
    while (!stop.current) {
      let j: Step;
      try {
        const r = await fetch('/api/scan/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skip }) });
        j = (await r.json()) as Step;
        if (!r.ok) { why = j.error || `The server answered ${r.status}.`; bad = true; break; }
      } catch { why = 'Lost the connection. Press the button to carry on.'; bad = true; break; }
      n += j.ok; fl += j.flagged; left = j.left; budget = j.budget; setDone(n); setFlagged(fl);
      setSt((s) => ({ ...s, checked: s.checked + j.ok, unchecked: j.left + j.failed.length, budget: j.budget }));
      j.failed.forEach((f) => skip.push(f.id));
      if (j.failed.length && !j.ok) { why = `Couldn’t read a file: ${j.failed[0].error}`; bad = true; break; }
      if (j.stop === 'off') { why = 'The AI document check is switched off in Vercel.'; bad = true; break; }
      if (j.stop === 'limit') { why = `Today’s AI limit is used up. Raise AI_DAILY_LIMIT in Vercel, or carry on after midnight UTC.`; break; }
      if (j.left <= 0 || (!j.ok && !j.failed.length && j.stop !== 'time')) break;
    }
    setRun(false);
    setNote({ ok: !bad, text: stop.current ? `Stopped after ${n}.` : why ? `Checked ${n}. ${why}` : `Checked ${n} document${n === 1 ? '' : 's'}${fl ? ` — ${fl} need a look` : ' — nothing unusual'}.` });
    void left; void budget;
    router.refresh();
  }

  const pct = st.total ? Math.round((st.checked / st.total) * 100) : 0;
  return (
    <div className="card scanall">
      <h2><Icon n="spark" size={17} /> AI document check</h2>
      <p className="muted" style={{ marginTop: 0 }}>Reads each unchecked document, says what it is, and flags a wrong type, a name that doesn’t match, or a passport close to expiry. Files filed as “Other” go first, and what it sees is offered below for you to accept.</p>
      <div className="scanall-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
      <div className="scanall-row">
        <span><b>{st.checked}</b> of {st.total} checked{st.uncheckedOther ? <> · <b>{st.uncheckedOther}</b> filed as “Other”</> : null}</span>
        <span className="muted">AI calls today: {st.limit - st.budget} of {st.limit}</span>
      </div>
      <div className="filters" style={{ marginTop: 10 }}>
        {!run
          ? <button type="button" className="btn primary" onClick={go} disabled={!st.unchecked || st.budget <= 0}>{st.unchecked ? `Check all unchecked (${st.unchecked})` : 'Everything is checked'}</button>
          : <button type="button" className="btn ghost" onClick={() => { stop.current = true; }}>Stop</button>}
        {run && <span className="muted"><span className="pspin2" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />Reading… {done} done{flagged ? `, ${flagged} flagged` : ''}</span>}
      </div>
      {!run && st.unchecked > 0 && st.budget < st.unchecked && <p className="muted" style={{ margin: '10px 0 0' }}>Only {st.budget} AI calls are left today, so this will cover {st.budget} of {st.unchecked}. The limit is <code>AI_DAILY_LIMIT</code> in Vercel.</p>}
      {note && <p className={note.ok ? 'ok-t' : 'bad-t'} style={{ margin: '10px 0 0' }}>{note.text}</p>}
    </div>
  );
}
