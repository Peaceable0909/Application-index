'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import ReqRow, { type FileLite } from './ReqRow';
import StageSheet from './StageSheet';
import { addApplicantRequirement, removeApplicantRequirement, switchFlag } from '@/app/stageActions';
import { applicableStages, findStage, stageReqs, stageApplies, type AppState, type Role, type Workflow } from '@/lib/stageEngine';
import type { StageHistoryRow } from '@/lib/stages';

const when = (t: string) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const KIND: Record<string, string> = { move: 'Moved', override: 'Moved with an override', placed: 'Placed in the workflow', school_changed: 'Stage cleared because the school changed', reset: 'Stage restored' };

/** The "Stage" tab: the whole route with every checklist, the circumstances of this student, extra documents for this student, and the history. */
export default function StageDetails({ appId, appName, wf, st, role, files, history, people }: { appId: string; appName: string; wf: Workflow; st: AppState; role: Role; files: FileLite[]; history: StageHistoryRow[]; people: Record<string, string> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState<string | null>(null);
  const [form, setForm] = useState({ stageKey: st.stage_key || wf.stages[0]?.key || '', label: '', kind: 'document' as 'document' | 'confirmation' | 'outcome', docType: '', need: 'mandatory' as 'mandatory' | 'optional', satisfiedAt: 'approved' as 'uploaded' | 'approved' | 'accepted' });
  const cur = findStage(wf, st.stage_key);
  const route = applicableStages(wf, st.flags);
  const conditional = wf.stages.filter((s) => s.conditional);

  const flip = (flag: string, on: boolean) => { setErr(''); start(async () => { const r = await switchFlag(appId, flag, on); if (!r.ok) setErr(r.error); else router.refresh(); }); };
  const add = () => {
    setErr('');
    start(async () => {
      const r = await addApplicantRequirement(appId, { stageKey: form.stageKey, label: form.label, kind: form.kind, docType: form.kind === 'document' ? form.docType || form.label : undefined, need: form.need, satisfiedAt: form.satisfiedAt });
      if (!r.ok) setErr(r.error); else { setForm((f) => ({ ...f, label: '', docType: '' })); router.refresh(); }
    });
  };
  const drop = (id: string) => { setErr(''); start(async () => { const r = await removeApplicantRequirement(appId, id); if (!r.ok) setErr(r.error); else router.refresh(); }); };
  const who = (e: string) => people[e.toLowerCase()] || e.split('@')[0];

  return (
    <div className="sg-tab">
      {err && <div className="card err" role="alert">{err}</div>}

      <div className="card">
        <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{wf.school_name} route</h2>
          <button type="button" className="btn ghost sm" onClick={() => setSheet('')}>Move to another stage</button>
        </div>
        <ol className="sg-route">
          {wf.stages.map((s) => {
            const applies = stageApplies(s, st.flags), isCur = cur?.id === s.id;
            const done = !!cur && applies && s.position < cur.position;
            const reqs = applies ? stageReqs(wf, s, st) : [];
            const open = reqs.filter((r) => r.blocking).length;
            const idx = route.findIndex((x) => x.id === s.id) + 1;
            return (
              <li key={s.id} className={`${isCur ? 'cur' : done ? 'done' : ''}${applies ? '' : ' off'}`}>
                <details open={isCur}>
                  <summary>
                    <span className="n">{done ? <Icon n="check" size={13} /> : applies ? idx : <Icon n="circle" size={9} />}</span>
                    <span className="nm"><b>{s.name}</b>{!s.active ? <em>Switched off for this school</em> : s.conditional && <em>{applies ? 'Conditional · on for this student' : 'Conditional · not used for this student'}</em>}</span>
                    {isCur && <span className="badge plain blue">Current</span>}
                    {applies && reqs.length > 0 && <span className={`badge plain ${open ? 'amber' : 'green'}`}>{open ? `${open} open` : 'Complete'}</span>}
                    <Icon n="down" size={14} />
                  </summary>
                  <div className="sg-body">
                    {s.hint && <p className="sg-hint">{s.hint}</p>}
                    {!s.active && <p className="sg-hint">This stage has been switched off for the school. Nothing is asked of {appName} here; move the application on when ready.</p>}
                    {s.active && !applies && <p className="sg-hint">This stage only applies to some students. <button type="button" className="linkish" disabled={pending} onClick={() => flip(`stage:${s.key}`, true)}>Include it for {appName}</button></p>}
                    {applies && !reqs.length && <p className="sg-hint">Nothing is needed before leaving this stage.</p>}
                    {reqs.map((r) => <ReqRow key={r.ref} r={r} appId={appId} files={files} />)}
                    {st.extras.filter((e) => e.stage_key === s.key).length > 0 && applies && (
                      <p className="sg-hint">Items marked “just for {appName}” were added for this student only.</p>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2>About this student</h2>
          <p className="muted" style={{ marginTop: -6 }}>Some steps and documents only apply to some students. Switch on what applies and the checklist updates.</p>
          {wf.conditions.map((c) => (
            <label key={c.key} className="mv-chk sg-flag"><input type="checkbox" checked={st.flags[`cond:${c.key}`] === true} disabled={pending} onChange={(e) => flip(`cond:${c.key}`, e.target.checked)} /><span>{c.label}</span></label>
          ))}
          {conditional.map((s) => (
            <label key={s.key} className="mv-chk sg-flag"><input type="checkbox" checked={st.flags[`stage:${s.key}`] === true} disabled={pending || cur?.id === s.id} onChange={(e) => flip(`stage:${s.key}`, e.target.checked)} /><span>Needs the “{s.name}” stage{s.hint && <small>{s.hint}</small>}</span></label>
          ))}
          {!wf.conditions.length && !conditional.length && <p className="muted" style={{ margin: 0 }}>This school has no optional steps.</p>}
        </div>

        <div className="card">
          <h2>Extra requirement for {appName}</h2>
          <p className="muted" style={{ marginTop: -6 }}>For when the school asks this one student for something the others are not asked for.</p>
          {st.extras.map((e) => (
            <div key={e.id} className="sg-extra"><span><b>{e.label}</b><small>{wf.stages.find((s) => s.key === e.stage_key)?.name || e.stage_key} · {e.need === 'mandatory' ? 'Required' : 'Optional'}</small></span><button type="button" className="btn ghost sm" disabled={pending} onClick={() => drop(e.id)}>Remove</button></div>
          ))}
          <div className="sg-add">
            <label>Needed before leaving<select value={form.stageKey} onChange={(e) => setForm({ ...form, stageKey: e.target.value })}>{wf.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
            <label>What is needed<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="For example: Letter from sponsor" maxLength={80} /></label>
            <div className="sg-two">
              <label>Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}><option value="document">A document</option><option value="confirmation">A confirmation</option><option value="outcome">A recorded outcome</option></select></label>
              <label>Importance<select value={form.need} onChange={(e) => setForm({ ...form, need: e.target.value as typeof form.need })}><option value="mandatory">Required</option><option value="optional">Optional</option></select></label>
            </div>
            {form.kind !== 'outcome' && (
              <label>Counts as done when it is<select value={form.satisfiedAt} onChange={(e) => setForm({ ...form, satisfiedAt: e.target.value as typeof form.satisfiedAt })}><option value="uploaded">Uploaded</option><option value="approved">Approved by us</option><option value="accepted">Accepted by the school</option></select></label>
            )}
            <button type="button" className="btn" disabled={pending || form.label.trim().length < 2} onClick={add}>Add for this student</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Stage history</h2>
        {history.length ? (
          <ul className="feed sg-hist">
            {history.map((h) => (
              <li key={h.id}>
                <span className={`ico ${h.kind === 'override' ? 'amber' : h.kind === 'school_changed' ? 'purple' : ''}`}><Icon n={h.kind === 'override' ? 'alert' : h.kind === 'school_changed' ? 'swap' : h.kind === 'reset' ? 'rotate' : 'arrow'} size={16} /></span>
                <div>
                  <b>{h.from_name && h.to_name ? <>{h.from_name} → {h.to_name}</> : h.to_name ? <>{h.to_name}</> : <>Cleared from “{h.from_name}”</>}</b>
                  <small>{KIND[h.kind] || h.kind} · {who(h.actor)}</small>
                  {h.note && <small>Note: {h.note}</small>}
                  {h.missing && h.missing.length > 0 && <small className="sg-miss">Open when moved: {h.missing.join(', ')}</small>}
                </div>
                <time>{when(h.moved_at)}</time>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>No stage changes yet.</p>}
      </div>

      {sheet !== null && <StageSheet wf={wf} st={st} appId={appId} appName={appName} role={role} files={files} initialTarget={sheet || undefined} onClose={() => setSheet(null)} />}
    </div>
  );
}
