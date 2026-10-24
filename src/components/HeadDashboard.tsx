import Link from 'next/link';
import Btn from './Btn';
import Icon from './Icon';
import { assignApp, assignSelected, routeWaiting } from '@/app/assignActions';
import type { HeadApp, HeadBoard } from '@/lib/headBoard';
import { actorName, LOG_LABEL, REVIEW_LABEL } from '@/lib/assignText';
import { ago, shortDate } from '@/lib/format';
import type { PersonOption } from './AssignmentCard';

export type HeadFilter = { show: string; counselor: string; school: string };
const SHOWS: [string, string][] = [['all', 'Everything'], ['queue', 'Needs a counselor'], ['conflicts', 'Needs a decision'], ['review', 'Second look'], ['fresh', 'New this week'], ['quiet', 'Quiet'], ['docs', 'Documents outstanding']];

const qs = (f: HeadFilter, over: Partial<HeadFilter>) => {
  const m = { ...f, ...over }, p = new URLSearchParams();
  if (m.show && m.show !== 'all') p.set('show', m.show);
  if (m.counselor) p.set('counselor', m.counselor);
  if (m.school) p.set('school', m.school);
  const t = p.toString();
  return `/head${t ? `?${t}` : ''}`;
};

function pick(board: HeadBoard, f: HeadFilter): HeadApp[] {
  let l = board.apps.filter((a) => !a.final || f.show === 'all');
  if (f.show === 'queue') l = board.queue;
  else if (f.show === 'conflicts') l = board.conflicts;
  else if (f.show === 'review') l = board.review;
  else if (f.show === 'fresh') l = board.fresh;
  else if (f.show === 'quiet') l = board.stale;
  else if (f.show === 'docs') l = l.filter((a) => a.openDocs > 0);
  if (f.counselor) l = l.filter((a) => (f.counselor === '__none' ? !a.counselor : a.counselorKey === f.counselor));
  if (f.school) l = l.filter((a) => (a.school || '') === f.school);
  return l;
}

const where = (a: HeadApp) => [a.school, a.city].filter(Boolean).join(' · ');

function Tile({ n, label, tone, href }: { n: number; label: string; tone?: 'hot' | 'warm' | 'cool'; href?: string }) {
  const body = <><b>{n}</b><small>{label}</small></>;
  return href ? <Link href={href} className={`as-tile ${n && tone ? tone : ''}`}>{body}</Link> : <div className={`as-tile ${n && tone ? tone : ''}`}>{body}</div>;
}

/** The Team Head's view: what is waiting for a decision, how each counselor is doing, and every application inside what they oversee. */
export default function HeadDashboard({ board, counselors, scopeText, isAdmin, filter, schools }: { board: HeadBoard; counselors: PersonOption[]; scopeText: string; isAdmin: boolean; filter: HeadFilter; schools: string[] }) {
  const c = board.counts;
  const waiting = [...board.conflicts, ...board.queue];
  const list = pick(board, filter);
  const select = (name: string, label: string) => (
    <select name={name} aria-label={label} defaultValue="" required><option value="" disabled>{label}</option>{counselors.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
  );
  return (
    <>
      <div className="head" style={{ justifyContent: 'space-between' }}>
        <h1>Team Head</h1>
        {waiting.length > 0 && <form action={routeWaiting}><input type="hidden" name="returnTo" value="/head" /><Btn className="ghost sm" data-busy="Applying the rules…"><Icon n="bolt" size={14} /> Apply the rules to the {waiting.length} waiting</Btn></form>}
      </div>
      <p className="sub">{scopeText}</p>

      <div className="as-tiles">
        <Tile n={c.active} label="Active applications" href={qs(filter, { show: 'all' })} />
        <Tile n={c.fresh} label="New this week" tone="cool" href={qs(filter, { show: 'fresh' })} />
        <Tile n={c.queue} label="Need a counselor" tone="warm" href={qs(filter, { show: 'queue' })} />
        <Tile n={c.conflicts} label="Need a decision" tone="hot" href={qs(filter, { show: 'conflicts' })} />
        <Tile n={c.review} label="Second look" tone="warm" href={qs(filter, { show: 'review' })} />
        <Tile n={c.stale} label="Quiet 7+ days" tone="warm" href={qs(filter, { show: 'quiet' })} />
        <Tile n={c.openDocs} label="Documents outstanding" href={qs(filter, { show: 'docs' })} />
      </div>

      <section className="as-sec" aria-label="Waiting for a decision">
        <h2>Waiting for a decision</h2>
        <p className="sub">Nobody owns these yet. Either no rule covers them or more than one counselor qualifies, so a person has to choose.</p>
        <div className="card tablecard">
          {waiting.length ? (
            <>
            <form action={assignSelected}>
              <input type="hidden" name="returnTo" value="/head" />
              <div className="scroll">
                <table className="mcards">
                  <thead><tr><th style={{ width: 28 }} /><th>Student</th><th>School · Location</th><th>Why it is waiting</th><th>Could be</th></tr></thead>
                  <tbody>
                    {waiting.map((a) => (
                      <tr key={a.id} className="row">
                        <td className="mc-sel"><input type="checkbox" name="ids" value={a.id} aria-label={`Select ${a.name}`} /></td>
                        <td className="mc-name"><Link href={`/applications/${encodeURIComponent(a.id)}`}><b>{a.name}</b></Link><div className="muted">{a.submittedAt ? `Applied ${shortDate(a.submittedAt)}` : ''}</div></td>
                        <td data-l="School">{where(a) || <span className="muted">—</span>}</td>
                        <td data-l="Why"><span className={`badge plain tone-${a.state === 'conflict' ? 'red' : 'amber'}`}>{a.state === 'conflict' ? 'Needs a decision' : 'No counselor'}</span>{a.reason && <p className="as-note">{a.reason}</p>}</td>
                        <td data-l="Candidates">
                          {a.candidates.length ? (
                            <div className="as-cand">{a.candidates.map((k) => (
                              <button key={k.counselor_key} className="btn sm" type="submit" form={`pick-${a.id}-${k.counselor_key}`}>{`Give to ${k.name}${k.role === 'backup' ? ' (backup)' : ''}`}</button>
                            ))}</div>
                          ) : <span className="muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="as-bar">
                {select('counselor', 'Give the ticked ones to…')}
                <input name="reason" maxLength={300} placeholder="Why (optional, kept in the history)" aria-label="Reason" style={{ flex: '1 1 220px' }} />
                <Btn className="primary sm" data-busy="Assigning…"><Icon n="check" size={14} /> Assign ticked</Btn>
              </div>
            </form>
            {/* one small form per possible counselor, kept outside the big form (forms cannot be nested) and wired to the buttons by id */}
              {waiting.flatMap((a) => a.candidates.map((k) => (
                <form key={`${a.id}-${k.counselor_key}`} id={`pick-${a.id}-${k.counselor_key}`} action={assignApp} hidden>
                  <input type="hidden" name="id" value={a.id} /><input type="hidden" name="counselor" value={k.counselor_key} />
                  <input type="hidden" name="reason" value="Chosen between equal counselors" /><input type="hidden" name="returnTo" value="/head" />
                </form>
              )))}
            </>
          ) : <div className="as-empty"><Icon n="check-circle" size={22} /><p style={{ margin: '6px 0 0' }}>Nothing is waiting. Every active application has a counselor.</p></div>}
        </div>
      </section>

      {board.review.length > 0 && (
        <section className="as-sec" aria-label="Second look">
          <h2>Second look</h2>
          <p className="sub">These have a counselor, but the rules now point somewhere else or the counselor is no longer available. Nothing is changed until you decide.</p>
          <div className="card tablecard"><div className="scroll"><table className="mcards">
            <thead><tr><th>Student</th><th>School · Location</th><th>Counselor now</th><th>Why</th><th /></tr></thead>
            <tbody>
              {board.review.map((a) => (
                <tr key={a.id} className="row">
                  <td className="mc-name"><Link href={`/applications/${encodeURIComponent(a.id)}`}><b>{a.name}</b></Link></td>
                  <td data-l="School">{where(a) || '—'}</td>
                  <td data-l="Counselor">{a.counselor}</td>
                  <td data-l="Why"><span className="badge plain tone-amber">{REVIEW_LABEL[a.review || ''] || 'Check'}</span>{a.expected && <p className="as-note">Rules point to {a.expected}</p>}</td>
                  <td data-l="Action"><Link className="btn ghost sm" href={`/applications/${encodeURIComponent(a.id)}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table></div></div>
        </section>
      )}

      <section className="as-sec" aria-label="Counselor workload">
        <h2>Counselor workload</h2>
        <p className="sub">Active applications each counselor carries inside what you oversee, and what is waiting on them.</p>
        <div className="card tablecard"><div className="scroll"><table className="as-load">
          <thead><tr><th>Counselor</th><th>Applications</th><th>New</th><th>Quiet</th><th>Documents</th><th>Tasks</th><th>Receives docs</th></tr></thead>
          <tbody>
            {board.workload.map((w) => (
              <tr key={w.key}>
                <td><Link href={qs(filter, { counselor: w.key, show: 'all' })}><b>{w.name}</b></Link>{!w.active && <span className="badge plain tone-gray" style={{ marginLeft: 8 }}>off</span>}</td>
                <td>{w.apps}</td><td>{w.fresh}</td><td className={w.stale ? 'warn' : ''}>{w.stale}</td><td className={w.openDocs ? 'warn' : ''}>{w.openDocs}</td><td>{w.tasks}</td><td>{w.docsFor}</td>
              </tr>
            ))}
            {!board.workload.length && <tr><td colSpan={7} className="as-empty">No counselors have applications here yet.</td></tr>}
          </tbody>
        </table></div></div>
      </section>

      <section className="as-sec" aria-label="Applications">
        <h2>Applications</h2>
        <nav className="as-tabs" aria-label="Show">
          {SHOWS.map(([k, label]) => <Link key={k} href={qs(filter, { show: k })} className={filter.show === k ? 'on' : ''}>{label}</Link>)}
        </nav>
        <form method="get" action="/head" className="filters" style={{ marginBottom: 12 }}>
          {filter.show !== 'all' && <input type="hidden" name="show" value={filter.show} />}
          <select name="counselor" defaultValue={filter.counselor} aria-label="Counselor"><option value="">Every counselor</option><option value="__none">No counselor</option>{counselors.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
          <select name="school" defaultValue={filter.school} aria-label="School"><option value="">Every school</option>{schools.map((s) => <option key={s}>{s}</option>)}</select>
          <Btn className="ghost sm">Filter</Btn>
          {(filter.counselor || filter.school) && <Link href={qs(filter, { counselor: '', school: '' })} className="muted">Clear</Link>}
          <span className="muted" style={{ marginLeft: 'auto' }}>{list.length} shown</span>
        </form>
        <div className="card tablecard"><div className="scroll"><table className="mcards">
          <thead><tr><th>Student</th><th>School · Stage</th><th>Counselor</th><th>Status</th><th>Documents</th><th>Last activity</th></tr></thead>
          <tbody>
            {list.slice(0, 200).map((a, i) => (
              <tr key={a.id} className="row" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
                <td className="mc-name"><Link href={`/applications/${encodeURIComponent(a.id)}`}><b>{a.name}</b></Link><div className="muted">{a.city || ''}</div></td>
                <td data-l="School">{a.school || '—'}<div className="muted">{a.stageName ? `${a.stageName}${a.stageDelayed > 0 ? ` · ${a.stageDelayed}d late` : ''}` : a.programme || ''}</div></td>
                <td data-l="Counselor">{a.counselor || <span className="badge plain tone-amber">None</span>}{a.docHandler && a.docHandler !== a.counselorKey && <div className="muted">Docs: {board.workload.find((w) => w.key === a.docHandler)?.name || a.docHandler}</div>}</td>
                <td data-l="Status">{a.status ? <span className="badge plain">{a.status}</span> : '—'}{a.awaiting && <div className="muted">New, not started</div>}</td>
                <td data-l="Documents">{a.openDocs ? <span className="badge plain tone-amber">{a.openDocs} outstanding</span> : <span className="muted">—</span>}</td>
                <td data-l="Last activity">{a.lastActivity ? ago(a.lastActivity) : '—'}{a.stale && <div className="muted">Quiet {a.daysQuiet} days</div>}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="as-empty">Nothing matches.</td></tr>}
          </tbody>
        </table></div></div>
        {list.length > 200 && <p className="as-note">Showing the first 200. Narrow it with the filters.</p>}
      </section>

      <section className="as-sec" aria-label="Recent assignment activity">
        <h2>Recent assignment activity</h2>
        <div className="card">
          {board.recent.length ? (
            <ul className="as-hist">
              {board.recent.map((l) => (
                <li key={l.id}>
                  <time dateTime={l.at}>{ago(l.at)}</time>
                  <div>
                    <b><Link href={`/applications/${encodeURIComponent(l.applicationId)}`}>{l.student}</Link>: {LOG_LABEL[l.kind] || l.kind}{l.to ? ` · ${l.from ? `${l.from} to ${l.to}` : l.to}` : ''}</b>
                    <span>{l.reason || ''}{l.reason ? ' · ' : ''}by {actorName(l.actor)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="as-note" style={{ margin: 0 }}>No assignments recorded yet. They appear here as applications arrive and are reassigned.</p>}
        </div>
      </section>
      {isAdmin && <p className="as-note">Admins see everything. <Link href="/assignments">Change who is responsible for what</Link>.</p>}
    </>
  );
}
