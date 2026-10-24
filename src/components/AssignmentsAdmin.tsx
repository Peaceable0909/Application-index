import Link from 'next/link';
import Btn from './Btn';
import Icon from './Icon';
import TargetFields from './TargetFields';
import { addDestination, addHeadScope, addRule, bulkReassign, refreshDocHandlers, removeHeadScope, removeRule, saveRule, setAutoRoute, toggleRule } from '@/app/assignActions';
import type { AdminData } from '@/lib/assignAdmin';
import type { BulkApp } from '@/lib/assignCore';
import { ruleIsLive, type Rule } from '@/lib/assignEngine';

export type BulkPreview = { workspace: string; from: string; school: string; location: string; apps: BulkApp[] } | null;

const LEVEL_ORDER = { school: 0, country: 1, location: 2 } as const;
const targetOf = (r: Rule) => r.scope === 'school' ? { icon: 'graduation', word: 'School', name: r.school_name || r.school_key || '' } : r.scope === 'location' ? { icon: 'pin', word: 'Location', name: r.location_name || r.location_key || '' } : { icon: 'globe', word: 'Whole destination', name: '' };

function RuleRow({ r, counselors }: { r: Rule; counselors: AdminData['counselors'] }) {
  const t = targetOf(r), who = counselors.find((c) => c.key === r.counselor_key);
  const paused = r.active && !!r.paused_until && !ruleIsLive(r);
  const state = !r.active ? { text: 'Switched off', tone: 'gray' } : paused ? { text: `Paused until ${r.paused_until}`, tone: 'amber' } : who && !who.active ? { text: 'Counselor is off', tone: 'amber' } : !who ? { text: 'Unknown counselor', tone: 'red' } : { text: 'Active', tone: 'green' };
  return (
    <div className="as-rulebox">
      <div className={`as-rule${!r.active ? ' off' : ''}`}>
        <div className="what"><b><Icon n={t.icon} size={14} /> {t.word}{t.name ? `: ${t.name}` : ''}</b>{r.note && <small>{r.note}</small>}</div>
        <div className="who"><b>{who?.name || r.counselor_key}</b><span className={`badge plain tone-${r.role === 'primary' ? 'blue' : 'gray'}`}>{r.role === 'primary' ? 'Primary' : 'Backup'}</span><span className={`badge plain tone-${state.tone}`}>{state.text}</span></div>
        <div className="acts">
          <form action={toggleRule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="to" value={r.active ? 'off' : 'on'} /><Btn className="ghost sm">{r.active ? 'Switch off' : 'Switch on'}</Btn></form>
        </div>
      </div>
      <details className="as-more as-rule-edit">
        <summary>Edit or remove</summary>
        <div className="as-edit">
          <form action={saveRule} className="as-grid">
            <input type="hidden" name="id" value={r.id} />
            <label>Role<select name="role" defaultValue={r.role}><option value="primary">Primary</option><option value="backup">Backup</option></select></label>
            <label>Away until (optional)<input type="date" name="paused_until" defaultValue={r.paused_until || ''} /></label>
            <label>Note (admins only)<input name="note" defaultValue={r.note || ''} maxLength={300} /></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" name="active" defaultChecked={r.active} style={{ width: 'auto' }} /> In use</label>
            <Btn className="primary sm">Save</Btn>
          </form>
          <form action={removeRule}><input type="hidden" name="id" value={r.id} /><Btn className="ghost sm" data-busy="Removing…"><Icon n="trash" size={14} /> Remove this responsibility</Btn></form>
        </div>
      </details>
    </div>
  );
}

function RuleList({ rules, counselors, empty }: { rules: Rule[]; counselors: AdminData['counselors']; empty: string }) {
  const sorted = [...rules].sort((a, b) => LEVEL_ORDER[a.scope] - LEVEL_ORDER[b.scope] || targetOf(a).name.localeCompare(targetOf(b).name) || (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1));
  return sorted.length ? <div className="as-rules">{sorted.map((r) => <RuleRow key={r.id} r={r} counselors={counselors} />)}</div> : <p className="as-note" style={{ margin: 0 }}>{empty}</p>;
}

/** The admin's page: who is responsible for which school, destination or location, who oversees what, and the tools for when that changes. */
export default function AssignmentsAdmin({ data, bulk }: { data: AdminData; bulk: BulkPreview }) {
  const active = data.counselors.filter((c) => c.active);
  const label = (ws: string) => data.workspaces.find((w) => w.key === ws)?.name || ws;
  const ws = data.workspaces.filter((w) => w.active);
  const counselorSelect = (name: string, ph: string, opts = active) => <select name={name} required defaultValue=""><option value="" disabled>{ph}</option>{opts.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select>;
  return (
    <>
      <div className="head"><h1>Responsibilities</h1></div>
      <p className="sub">Decide who receives each new application and who handles its documents. Changes here apply to applications that arrive from now on. Nobody&apos;s current students are moved unless you do it below.</p>

      <ol className="as-prio" aria-label="Order the rules are applied in">
        <li><b>School</b>The counselor for that university</li>
        <li><b>Destination</b>The counselor for the whole country</li>
        <li><b>Location</b>The counselor for the student&apos;s city or office</li>
        <li><b>Team Head</b>Nobody matched: it waits for a person</li>
      </ol>

      {data.problems.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>Worth checking</h2>
          <ul className="as-problems">{data.problems.map((p, i) => <li key={i} className={`lv-${p.level}`}><Icon n={p.level === 'info' ? 'clock' : 'alert'} size={16} />{p.text}</li>)}</ul>
        </div>
      )}

      {ws.map((w) => {
        const mine = data.rules.filter((r) => r.workspace === w.key);
        return (
          <section key={w.key} className="card as-ws" aria-label={w.name}>
            <div className="as-ws-head">
              <h2>{w.name}</h2>
              <div className="filters">
                {data.waiting[w.key] ? <Link href="/head" className="badge plain tone-amber">{data.waiting[w.key]} waiting for a counselor</Link> : null}
                <form action={setAutoRoute} className="as-switch"><input type="hidden" name="workspace" value={w.key} /><input type="hidden" name="to" value={w.auto_route ? 'off' : 'on'} />
                  <span>{w.auto_route ? 'New applications are routed automatically' : 'Automatic routing is off'}</span><Btn className="ghost sm">{w.auto_route ? 'Switch off' : 'Switch on'}</Btn></form>
              </div>
            </div>
            <div><p className="as-sub" style={{ marginBottom: 6 }}>New applications go to</p><RuleList rules={mine.filter((r) => r.kind === 'application')} counselors={data.counselors} empty="Nothing set. New applications here wait for a Team Head or an admin." /></div>
            <div><p className="as-sub" style={{ marginBottom: 6 }}>Documents are received and processed by</p><RuleList rules={mine.filter((r) => r.kind === 'documents')} counselors={data.counselors} empty="No separate document responsibility. The counselor who owns the application handles its documents." /></div>
          </section>
        );
      })}

      <section className="card as-ws" aria-label="Add a responsibility">
        <h2 style={{ margin: 0 }}>Add a responsibility</h2>
        <p className="as-note" style={{ margin: 0 }}>A counselor can have several, and one school or destination can have several counselors (a primary and backups). Two primaries for the same thing are flagged instead of one being picked at random.</p>
        <form action={addRule} className="as-grid">
          <label>For<select name="kind" defaultValue="application"><option value="application">Receiving new applications</option><option value="documents">Receiving and processing documents</option></select></label>
          <TargetFields workspaces={ws} schools={data.schools} cities={data.cities} />
          <label>Counselor{counselorSelect('counselor', 'Choose…')}</label>
          <label>Role<select name="role" defaultValue="primary"><option value="primary">Primary</option><option value="backup">Backup (used when the primary is away)</option></select></label>
          <label>Away until (optional)<input type="date" name="paused_until" /></label>
          <label style={{ gridColumn: '1 / -1' }}>Note (admins only)<input name="note" maxLength={300} placeholder="For example: handles all CCCU documents" /></label>
          <Btn className="primary" data-busy="Saving…"><Icon n="user-plus" size={15} /> Add responsibility</Btn>
        </form>
      </section>

      <section className="card as-ws" aria-label="Add a destination">
        <h2 style={{ margin: 0 }}>Add a destination</h2>
        <p className="as-note" style={{ margin: 0 }}>For a new country such as Japan. It is created with its sheet tab and, if you choose a counselor, that counselor is made responsible for the whole destination with routing switched on.</p>
        <form action={addDestination} className="as-grid">
          <label>Name<input name="name" required maxLength={40} placeholder="Japan" /></label>
          <label>Sheet tab<input name="tab" required maxLength={80} placeholder="Japan" /></label>
          <label>Counselor responsible (optional)<select name="counselor" defaultValue=""><option value="">Decide later</option>{active.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
          <Btn className="ghost"><Icon n="globe" size={15} /> Add destination</Btn>
        </form>
      </section>

      <section className="card as-ws" aria-label="Team Heads">
        <h2 style={{ margin: 0 }}>Team Heads</h2>
        <p className="as-note" style={{ margin: 0 }}>A Team Head sees the Team Head page for the schools, destinations and locations listed here, can open those students and reassign them, and is told when one needs a decision. This is separate from their normal role. Admins always see everything.</p>
        {data.heads.length ? (
          <div className="as-heads">
            {data.heads.map((h) => (
              <div key={h.email} className="as-head-row">
                <div><b>{h.name}</b> <span className="muted">{h.email} · {h.role}</span>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {h.scopes.length ? h.scopes.map((s) => (
                      <form key={s.id} action={removeHeadScope} style={{ display: 'inline-flex' }}>
                        <input type="hidden" name="id" value={s.id} />
                        <span className="badge plain tone-blue">{s.scope === 'school' ? s.school_name : s.scope === 'location' ? s.location_name : 'Everything'} · {label(s.workspace)}
                          <button className="linkish" aria-label="Remove this scope" title="Remove" style={{ marginLeft: 6 }}><Icon n="x" size={12} /></button></span>
                      </form>
                    )) : <span className="muted">No scope yet</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="as-note" style={{ margin: 0 }}>Nobody is a Team Head yet.</p>}
        <form action={addHeadScope} className="as-grid">
          <label>Person<select name="email" required defaultValue=""><option value="" disabled>Choose a team member…</option>{data.team.map((p) => <option key={p.email} value={p.email}>{p.name}{p.name !== p.email ? ` (${p.email})` : ''}</option>)}</select></label>
          <TargetFields workspaces={ws} schools={data.schools} cities={data.cities} />
          <Btn className="primary"><Icon n="users" size={15} /> Make Team Head</Btn>
        </form>
      </section>

      <section className="card as-ws" aria-label="When responsibilities change">
        <h2 style={{ margin: 0 }}>When responsibilities change</h2>
        <p className="as-note" style={{ margin: 0 }}>Moves a counselor&apos;s current students to someone else, for example when a counselor leaves or a school changes hands. You see exactly who will move before anything happens, and each student gets its own history entry. Only the counselor changes.</p>
        <form method="get" action="/assignments" className="as-grid">
          <input type="hidden" name="bulk" value="1" />
          <label>Destination<select name="workspace" defaultValue={bulk?.workspace || ws[0]?.key}>{ws.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}</select></label>
          <label>Move the students of<select name="from" required defaultValue={bulk?.from || ''}><option value="" disabled>Choose…</option><option value="__none">Nobody (no counselor)</option>{data.counselors.map((c) => <option key={c.key} value={c.key}>{c.name}{c.active ? '' : ' (off)'}</option>)}</select></label>
          <label>Only this school (optional)<input name="school" defaultValue={bulk?.school || ''} placeholder="Any school" /></label>
          <label>Only this location (optional)<input name="location" defaultValue={bulk?.location || ''} placeholder="Any location" /></label>
          <Btn className="ghost"><Icon n="eye" size={15} /> Preview who would move</Btn>
        </form>
        {bulk && (
          <div style={{ display: 'grid', gap: 12 }}>
            {bulk.apps.length ? (
              <>
                <p style={{ margin: 0 }}><b>{bulk.apps.length}</b> application{bulk.apps.length === 1 ? '' : 's'} would move{bulk.apps.length > 300 ? ' (the first 300 now; run it again for the rest)' : ''}. Finished ones (enrolled, rejected, withdrawn) stay where they are.</p>
                <div className="as-preview"><table><tbody>{bulk.apps.slice(0, 80).map((a) => <tr key={a.id}><td><Link href={`/applications/${encodeURIComponent(a.id)}`}>{a.name}</Link></td><td>{a.school || '—'}</td><td>{a.city || '—'}</td><td>{a.status || '—'}</td></tr>)}</tbody></table></div>
                {bulk.apps.length > 80 && <p className="as-note" style={{ margin: 0 }}>…and {bulk.apps.length - 80} more.</p>}
                <form action={bulkReassign} className="as-grid">
                  <input type="hidden" name="workspace" value={bulk.workspace} /><input type="hidden" name="from" value={bulk.from} />
                  <input type="hidden" name="school" value={bulk.school} /><input type="hidden" name="location" value={bulk.location} />
                  <label>Give them to{counselorSelect('to', 'Choose…', active.filter((c) => c.key !== bulk.from))}</label>
                  <label>Why (kept in each history)<input name="reason" maxLength={300} defaultValue="Responsibilities changed" /></label>
                  <Btn className="primary" data-busy="Moving…"><Icon n="swap" size={15} /> Move {bulk.apps.length}</Btn>
                </form>
              </>
            ) : <p className="as-note" style={{ margin: 0 }}>Nobody matches that, so there is nothing to move.</p>}
          </div>
        )}
        <details className="as-more">
          <summary><Icon n="rotate" size={15} /> Update who receives documents on existing applications</summary>
          <p className="as-note">New applications pick up document responsibilities automatically. Run this once after changing them to bring the applications already in the portal up to date. Owners are not touched.</p>
          <form action={refreshDocHandlers} className="as-reassign">
            <label>Destination<select name="workspace" defaultValue={ws[0]?.key}>{ws.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}</select></label>
            <Btn className="ghost sm" data-busy="Updating…">Update</Btn>
          </form>
        </details>
      </section>
    </>
  );
}
