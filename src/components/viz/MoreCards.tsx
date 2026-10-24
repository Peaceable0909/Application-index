'use client';
import { useState } from 'react';
import Link from 'next/link';
import Icon from '../Icon';
import { Empty, Legend, PHASE_VAR, Tip, useTip, VizCard, pctOf, plural } from './VizKit';
import { PHASES, type PhaseKey, type Portfolio, type Track, type Viz } from '@/lib/vizData';
import type { Funnel } from '@/lib/funnel';

const RAMP = ['var(--ph-start)', 'var(--ph-offer)', 'var(--ph-cas)', 'var(--ph-visa)', 'var(--ph-enrolled)'];

// ---------- chat to enrolment ----------
/** The road from first contact to enrolment, with how many move on at each step. Thin bars, one step darker each time. */
export function FunnelCard({ funnel, csv }: { funnel: Funnel; csv?: string }) {
  const t = funnel.total, top = Math.max(1, t.students);
  const steps = [{ label: 'Applications started', n: t.students, from: null as number | null }, { label: 'Reached an offer', n: t.offers, from: t.students }, { label: 'Enrolled', n: t.enrolled, from: t.offers }];
  const leak = steps.slice(1).map((s, i) => ({ label: s.label, lost: (steps[i].n || 0) - s.n, rate: pctOf(s.n, steps[i].n) })).filter((s) => s.lost > 0 && steps[steps.findIndex((x) => x.label === s.label) - 1].n >= 5).sort((a, b) => a.rate - b.rate)[0];
  const table = { head: ['Step', 'Students', 'Of the step before'], rows: [...(t.chats ? [['Chats started', t.chats, ''], ['Chats that became students', t.fromChats, `${pctOf(t.fromChats, t.chats)}%`]] : []), ...steps.map((s) => [s.label, s.n, s.from === null ? '' : `${pctOf(s.n, s.from)}%`])] };
  return (
    <VizCard title="From application to enrolment" sub="How many of the applications started in this period have moved on. “Reached an offer” stays counted even if the student was later rejected or withdrew." csv={csv} table={table}>
      {t.students === 0 ? <Empty icon="trend" title="No applications in this period" /> : (
        <div className="rv-ladder">
          {t.chats > 0 && <p className="rv-chat"><Icon n="chat" size={14} /> The website chat started <b>{plural(t.chats, 'conversation')}</b>; <b>{t.fromChats}</b> became students ({pctOf(t.fromChats, t.chats)}%).</p>}
          {steps.map((s, i) => (
            <div key={s.label}>
              {s.from !== null && <div className="rv-step"><Icon n="down" size={13} /><b>{pctOf(s.n, s.from)}%</b> move on{s.from - s.n > 0 ? <em> · {s.from - s.n} stop here</em> : null}</div>}
              <div className="rv-row" style={{ ['--w' as string]: `${Math.max(s.n ? 1.5 : 0, (s.n / top) * 100)}%`, ['--c' as string]: RAMP[Math.min(4, i * 2)] }}>
                <span className="rv-rl">{s.label}</span>
                <span className="rv-rt"><i /></span>
                <span className="rv-rv">{s.n.toLocaleString('en-GB')}</span>
              </div>
            </div>
          ))}
          {leak && <p className="rv-callout"><Icon n="alert" size={14} /> The biggest drop is before <b>{leak.label.toLowerCase()}</b>: {leak.rate}% get there.</p>}
        </div>
      )}
    </VizCard>
  );
}

// ---------- counselor portfolios ----------
export function PortfolioCard({ rows, csv, headHref }: { rows: Portfolio[]; csv?: string; headHref: string | null }) {
  const { host, tip, on } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.total));
  const table = { head: ['Counselor', ...PHASES.map((p) => p.label), 'Total', 'Quiet a week or more'], rows: rows.map((r) => [r.label, ...PHASES.map((p) => r.byPhase[p.key]), r.total, r.quiet]) };
  return (
    <VizCard title="Counselor portfolios" sub="Everyone's students, by where they are now. Bars share one scale, so a longer bar is a bigger caseload." csv={csv} table={table}
      legend={<Legend items={PHASES.filter((p) => rows.some((r) => r.byPhase[p.key] > 0)).map((p) => ({ label: p.label, color: PHASE_VAR[p.key], note: p.hint }))} label="Where students are now" />}>
      {!rows.length ? <Empty icon="users" title="No students in this period" /> : (
        <div className="rv-plot" ref={host}>
          <div className="rv-port">
            {rows.map((r) => (
              <div key={r.key} className={`rv-prow${r.key === '(unassigned)' ? ' none' : ''}`}>
                <span className="rv-pn" title={r.label}>{r.key === '(unassigned)' ? <Icon n="alert" size={13} /> : null}{r.label}</span>
                <div className="rv-pbar" role="img" aria-label={`${r.label}: ${r.total} students`} style={{ width: `${(r.total / max) * 100}%` }}>
                  {PHASES.filter((p) => r.byPhase[p.key] > 0).map((p) => (
                    <i key={p.key} tabIndex={0} aria-label={`${p.label}: ${r.byPhase[p.key]}`} style={{ flex: r.byPhase[p.key], background: PHASE_VAR[p.key] }}
                      {...on({ title: r.label, rows: [{ color: PHASE_VAR[p.key], label: p.label, value: String(r.byPhase[p.key]) }], note: `${plural(r.total, 'student')} in all` })} />
                  ))}
                </div>
                <span className="rv-pt">{r.total}</span>
                <span className="rv-pq">{r.quiet > 0 ? <span title={`${r.quiet} with nothing happening for a week or more`}><Icon n="clock" size={12} /> {r.quiet}</span> : null}</span>
              </div>
            ))}
          </div>
          <Tip tip={tip} />
          {headHref && rows.some((r) => r.key === '(unassigned)') && <p className="rv-callout"><Icon n="alert" size={14} /> Some students have no counselor yet. <Link href={headHref}>Assign them on the Team Head page</Link>.</p>}
        </div>
      )}
    </VizCard>
  );
}

// ---------- stage tracks ----------
/** Each university's own route, stage by stage, with how many are at each and how many are running late. */
export function StageTracksCard({ tracks }: { tracks: Track[] }) {
  const [pick, setPick] = useState(0);
  const t = tracks[Math.min(pick, tracks.length - 1)];
  const max = t ? Math.max(1, ...t.stages.map((s) => s.n), t.unplaced) : 1;
  const table = t ? { head: ['Stage', 'Students', 'Running late'], rows: [...(t.unplaced ? [['Not placed in a stage yet', t.unplaced, '']] : []), ...t.stages.map((s) => [s.name, s.n, s.late])] } : undefined;
  const tools = tracks.length > 1 && (
    <div className="rv-seg wrap" role="group" aria-label="University">
      {tracks.map((x, i) => <button key={x.id} type="button" aria-pressed={i === pick} onClick={() => setPick(i)}>{x.school.replace(/\s*\(.*\)/, '')}{x.late ? <span className="rv-dot" aria-label={`${x.late} late`} /> : null}</button>)}
    </div>
  );
  return (
    <VizCard title="Stage tracks" sub="Each university has its own route. The bars show how many students are at each stage right now." table={table} tools={tools}>
      {!t ? <Empty icon="trend" title="No stage workflows in use for this period">Stages appear here for universities that have a workflow and students placed in it.</Empty> : (
        <div className="rv-track">
          <p className="rv-tsum"><b>{t.school}</b> · {plural(t.total, 'student')}{t.late ? <span className="rv-late"><Icon n="alert" size={13} /> {t.late} running late</span> : <span className="rv-ontime"><Icon n="check-circle" size={13} /> None running late</span>}</p>
          {t.unplaced > 0 && <div className="rv-srow none"><span className="rv-sn">Not placed in a stage yet</span><span className="rv-sb"><i style={{ width: `${(t.unplaced / max) * 100}%` }} /></span><span className="rv-sv">{t.unplaced}</span></div>}
          {t.stages.map((s, i) => (
            <div key={s.key} className={`rv-srow${s.n ? '' : ' empty'}`}>
              <span className="rv-sn" title={s.name}><em>{i + 1}</em>{s.name}</span>
              <span className="rv-sb"><i style={{ width: `${s.n ? Math.max(2, (s.n / max) * 100) : 0}%`, background: RAMP[Math.min(4, Math.floor((i / Math.max(1, t.stages.length - 1)) * 4))] }} /></span>
              <span className="rv-sv">{s.n || ''}{s.late ? <span className="rv-late" title={`${s.late} past the time this stage allows`}><Icon n="alert" size={12} />{s.late}</span> : null}</span>
            </div>
          ))}
        </div>
      )}
    </VizCard>
  );
}

// ---------- pace ----------
const MIN_POINTS = 3;
function Bars({ rows, hotFrom, unit = '' }: { rows: { label: string; n: number; hot?: boolean }[]; hotFrom?: number; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="rv-hbars">
      {rows.map((r, i) => (
        <div key={r.label} className="rv-hrow">
          <span className="rv-hl">{r.label}</span>
          <span className="rv-ht"><i className={r.hot || (hotFrom !== undefined && i >= hotFrom) ? 'hot' : ''} style={{ width: `${r.n ? Math.max(2, (r.n / max) * 100) : 0}%` }} /></span>
          <span className="rv-hv">{r.n}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** How long things take and where they sit. Only the parts with enough behind them are drawn; the rest say how they fill in. */
export function PaceCard({ viz, csv, headHref }: { viz: Viz; csv?: string; headHref: string | null }) {
  const q = viz.quiet, p = viz.pace, slow = [...viz.dwell].sort((a, b) => b.avg - a.avg)[0];
  const table = { head: ['Measure', 'Group', 'Value'], rows: [...q.buckets.map((b) => ['Days since anything happened (active students)', b.label, b.n]), ...p.toOffer.buckets.map((b) => ['Days from application to first offer', b.label, b.n]), ...viz.dwell.map((d) => ['Average days in a status', d.label, d.avg])] };
  return (
    <VizCard title="How long things sit" sub="Where the waiting is, and how fast applications move when they do." csv={csv} table={table} wide>
      <div className="rv-pace">
        <section>
          <h4>Time since anything happened</h4>
          {q.active === 0 ? <p className="rv-note">No active applications.</p> : (
            <>
              <Bars rows={q.buckets} />
              <p className="rv-callout">{q.quiet ? <><Icon n="clock" size={14} /> <b>{q.quiet}</b> of {q.active} active {q.quiet === 1 ? 'application has' : 'applications have'} been quiet for a week or more{headHref ? <> · <Link href={`${headHref}?show=quiet`}>See them</Link></> : null}.</> : <><Icon n="check-circle" size={14} /> Nothing has been quiet for a week.</>}{q.median !== null && <> The middle one last moved {q.median === 0 ? 'today' : `${q.median} day${q.median === 1 ? '' : 's'} ago`}.</>}</p>
            </>
          )}
        </section>
        <section>
          <h4>Days from application to first offer</h4>
          {p.toOffer.n >= MIN_POINTS ? (
            <><Bars rows={p.toOffer.buckets} /><p className="rv-callout"><Icon n="trend" size={14} /> The middle student got an offer after <b>{Math.round(p.toOffer.median ?? 0)} days</b> ({p.toOffer.n} measured){p.toEnrolled.n >= MIN_POINTS ? <>; enrolment after <b>{Math.round(p.toEnrolled.median ?? 0)} days</b></> : null}.</p></>
          ) : <p className="rv-note">Fills in as status changes are recorded in the portal ({p.toOffer.n} measured so far, {MIN_POINTS} needed). Move a student to a new status and it starts counting.</p>}
        </section>
        <section>
          <h4>Where students wait longest</h4>
          {viz.dwell.length >= 2 && slow ? (
            <><Bars rows={viz.dwell.map((d) => ({ label: d.label, n: d.avg, hot: d === slow }))} unit=" d" /><p className="rv-callout"><Icon n="alert" size={14} /> Longest wait: <b>{slow.label}</b>, {slow.avg} days on average ({plural(slow.n, 'move')}).</p></>
          ) : <p className="rv-note">Needs a few recorded status changes to compare how long each status lasts.</p>}
        </section>
      </div>
    </VizCard>
  );
}

// ---------- sources ----------
export function SourceCard({ funnel, csv }: { funnel: Funnel; csv?: string }) {
  const rows = funnel.bySource.filter((s) => s.source !== '(not recorded)' && s.students + s.chats > 0);
  const unknown = funnel.bySource.find((s) => s.source === '(not recorded)');
  const max = Math.max(1, ...rows.map((r) => r.students + r.chats));
  const table = { head: ['Where they heard', 'Chats', 'Applications', 'Reached an offer', 'Enrolled', 'Offer rate', 'Enrolment rate'], rows: funnel.bySource.map((x) => [x.source, x.chats, x.students, x.offers, x.enrolled, `${pctOf(x.offers, x.students)}%`, `${pctOf(x.enrolled, x.students)}%`]) };
  return (
    <VizCard title="Where students come from" sub="Which channels bring students, and which of them go on to get an offer." csv={csv} table={table}>
      {!rows.length ? (
        <Empty icon="globe" title="No source recorded yet">Pick “How did you hear about WhiteRock?” on a student’s page, use the question on the document form, or share the tracked chat links in Settings. This chart fills in from then on.</Empty>
      ) : (
        <div className="rv-src">
          {rows.map((r) => (
            <div key={r.source} className="rv-srcrow">
              <span className="rv-hl" title={r.source}>{r.source}</span>
              <span className="rv-ht"><i style={{ width: `${Math.max(2, ((r.students + r.chats) / max) * 100)}%` }} /></span>
              <span className="rv-hv">{r.students + r.chats}</span>
              <span className="rv-conv" title="Applications that reached an offer">{r.students >= 5 ? `${pctOf(r.offers, r.students)}% offer` : <em>few so far</em>}</span>
            </div>
          ))}
          {unknown && <p className="rv-note">{plural(unknown.students + unknown.chats, 'more')} with no source recorded.</p>}
        </div>
      )}
    </VizCard>
  );
}

// ---------- countries ----------
export function CountriesCard({ funnel, csv }: { funnel: Funnel; csv?: string }) {
  const rows = funnel.byWorkspace.filter((w) => w.students + w.chats > 0);
  if (rows.length < 2) return null;
  const max = Math.max(1, ...rows.map((r) => r.students));
  const table = { head: ['Country', 'Chats', 'Became students', 'Applications', 'Reached an offer', 'Enrolled'], rows: rows.map((w) => [w.name, w.chats, w.fromChats, w.students, w.offers, w.enrolled]) };
  return (
    <VizCard title="Countries side by side" sub="Applications started in each country and how many reached an offer or enrolled." csv={csv} table={table}>
      <div className="rv-src">
        {rows.map((w) => (
          <div key={w.key} className="rv-srcrow">
            <span className="rv-hl">{w.name}</span>
            <span className="rv-ht"><i style={{ width: `${Math.max(2, (w.students / max) * 100)}%` }} /></span>
            <span className="rv-hv">{w.students}</span>
            <span className="rv-conv">{w.students ? `${pctOf(w.offers, w.students)}% offer · ${pctOf(w.enrolled, w.students)}% enrolled` : ''}</span>
          </div>
        ))}
      </div>
    </VizCard>
  );
}

export type { PhaseKey };
