'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Icon from './Icon';
import StageSheet from './StageSheet';
import InformStudent, { type InformShown } from './InformStudent';
import type { FileLite } from './ReqRow';
import { placeStage } from '@/app/stageActions';
import { applicableStages, readiness, suggestPlacement, type AppState, type Role, type Workflow } from '@/lib/stageEngine';

const day = (t: string | null) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ago = (t: string | null) => {
  if (!t) return '';
  const d = Math.floor((Date.now() - new Date(t).getTime()) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

export type CardApp = { id: string; name: string; school: string; programme: string | null; counselor: string | null; status: string | null };

/** The stage of one application at a glance: where it is on the school's route, what is still open, and the button that moves it on. */
export default function StageCard({ app, wf, st, role, files, stageBy, detailsHref, inform, who }: { app: CardApp; wf: Workflow; st: AppState; role: Role; files: FileLite[]; stageBy: string | null; detailsHref: string; inform?: InformShown | null; who?: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const rd = readiness(wf, st);
  const route = applicableStages(wf, st.flags);
  const started = !!rd.current;
  const first = route[0] ?? null;
  const guess = !started ? suggestPlacement(wf, app.status) : null;
  const open_ = rd.blockers;
  const verified = rd.reqs.filter((r) => r.satisfied);
  const outstandingDocs = rd.reqs.filter((r) => r.kind === 'document' && r.need !== 'optional' && !r.satisfied);
  const nxt = started ? rd.next : first;
  const place = (key: string) => { setErr(''); start(async () => { const r = await placeStage(app.id, key); if (!r.ok) setErr(r.error); else router.refresh(); }); };

  return (
    <section className={`card sg-card${rd.delayed ? ' is-late' : ''}`} aria-label="Application stage">
      <div className="sg-top">
        <div className="sg-title">
          <small className="sg-eyebrow">{wf.school_name} workflow</small>
          <h2>{started ? rd.current!.name : 'Not started'}</h2>
          <div className="sg-meta">
            <span>{app.name}</span>{app.programme && <span>{app.programme}</span>}<span>{app.school}</span>
          </div>
        </div>
        <div className="sg-cta">
          {started && !rd.current!.active && <span className="badge plain amber" title="An admin switched this stage off. Nothing is asked here.">Stage switched off</span>}
          {started && rd.delayed > 0 && <span className="badge plain red" title={`This stage should take about ${rd.current!.delay_days} days`}>{rd.delayed} day{rd.delayed === 1 ? '' : 's'} overdue</span>}
          {started && rd.ready && <span className="badge plain green">Ready for the next stage</span>}
          {started && !rd.ready && nxt && <span className="badge plain amber">{open_.length} to finish</span>}
          {started && !nxt && <span className="badge plain green">Final stage</span>}
          {started && nxt && <button type="button" className="btn primary" onClick={() => setOpen(nxt.key)}>Move to next stage <Icon n="arrow" size={15} /></button>}
          {started && !nxt && <button type="button" className="btn ghost" onClick={() => setOpen('')}>Change stage</button>}
          {!started && first && <button type="button" className="btn primary" onClick={() => setOpen(first.key)}>Start at “{first.name}” <Icon n="arrow" size={15} /></button>}
        </div>
      </div>

      <div className="sg-track" role="img" aria-label={started ? `Stage ${rd.progress.index} of ${rd.progress.total}` : 'Not started'}>
        {route.map((s, i) => {
          const idx = rd.progress.index;
          const cls = !started ? '' : i < idx - 1 ? 'done' : i === idx - 1 ? 'cur' : '';
          return <i key={s.id} className={cls} title={s.name} />;
        })}
      </div>
      <div className="sg-count">{started ? <>Stage <b>{rd.progress.index}</b> of {rd.progress.total}{nxt ? <> · next: <b>{nxt.name}</b></> : null}</> : <>{route.length} stages in this workflow</>}</div>

      {!started && guess && (
        <div className="sg-banner is-info"><Icon n="spark" size={18} /><div><b>This application already has the status “{app.status}”</b><span>That matches “{guess.name}”. Put it there without changing anything else, or start from the beginning.</span></div>
          <button type="button" className="btn ghost sm" disabled={pending} onClick={() => place(guess.key)}>{pending ? 'Placing…' : `Place in “${guess.name}”`}</button></div>
      )}
      {!started && !guess && app.status && <p className="sg-hint">The pipeline status “{app.status}” does not match any stage, so this application is left where it is until someone starts it. Nothing has been changed.</p>}
      {err && <p className="sg-err" role="alert">{err}</p>}

      <div className="sg-facts">
        <div><small>Next recommended</small><b>{nxt ? nxt.name : started ? 'None, this is the last stage' : '—'}</b></div>
        <div><small>Outstanding documents</small><b className={outstandingDocs.length ? 'bad' : 'good'}>{started ? (outstandingDocs.length ? `${outstandingDocs.length}: ${outstandingDocs.slice(0, 2).map((r) => r.label).join(', ')}${outstandingDocs.length > 2 ? '…' : ''}` : 'None') : '—'}</b></div>
        <div><small>Verified items</small><b>{started ? `${verified.length} of ${rd.reqs.length}` : '—'}</b></div>
        <div><small>Last change</small><b>{started ? day(st.stage_at) : '—'}</b>{started && <em>{ago(st.stage_at)}{stageBy ? ` · ${stageBy}` : ''}</em>}</div>
        <div><small>Counselor</small><b>{app.counselor || 'Unassigned'}</b></div>
        <div><small>Pipeline status</small><b>{app.status || 'Not set'}</b></div>
      </div>

      {started && open_.length > 0 && (
        <ul className="sg-open">
          {open_.slice(0, 4).map((r) => <li key={r.ref}><Icon n="alert" size={14} /><span><b>{r.label}</b>{r.why ? ` · ${r.why}` : ''}</span></li>)}
          {open_.length > 4 && <li className="more">and {open_.length - 4} more</li>}
        </ul>
      )}
      {started && inform && <InformStudent appId={app.id} info={inform} who={who} compact />}
      <div className="sg-foot"><Link href={detailsHref} scroll={false} className="linkish">Open the full checklist and history <Icon n="right" size={13} /></Link></div>

      {open !== null && <StageSheet wf={wf} st={st} appId={app.id} appName={app.name} role={role} files={files} initialTarget={open || undefined} onClose={() => setOpen(null)} />}
    </section>
  );
}
