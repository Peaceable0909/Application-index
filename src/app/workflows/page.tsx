import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { currentWorkspace } from '@/lib/workspace';
import { loadWorkflows } from '@/lib/stages';
import { schoolKey } from '@/lib/docs';
import { ALL_DOC_TYPES, CAS_STATUSES, STATUSES, VISA_STATUSES } from '@/lib/constants';
import { WORKFLOW_TEMPLATES } from '@/lib/stageTemplates';
import type { Req, Stage, Workflow } from '@/lib/stageEngine';
import Btn from '@/components/Btn';
import Icon from '@/components/Icon';
import { addRequirement, addStage, createWorkflow, removeRequirement, saveConditions, saveRequirement, saveStage, saveWorkflow, shiftStage } from '../workflowActions';

export const maxDuration = 60;
type SP = { school?: string; msg?: string; err?: string; new?: string };
const ROLE_LABEL = { admin: 'Admins', staff: 'Team', counselor: 'Counselors' } as const;
const NOTIFY_LABEL = { none: 'Nobody', counselor: 'The counselor', admins: 'Admins', both: 'Counselor and admins' } as const;

function Roles({ name = 'roles', value, label }: { name?: string; value: string[]; label?: string }) {
  return (
    <div>
      {label && <small style={{ display: 'block', font: '600 12px var(--font-sf, inherit)', color: 'var(--muted)', marginBottom: 4 }}>{label}</small>}
      <div className="checks">
        {(['admin', 'staff', 'counselor'] as const).map((r) => (
          <label key={r}><input type="checkbox" name={name} value={r} defaultChecked={value.includes(r) || r === 'admin'} disabled={r === 'admin'} /> {ROLE_LABEL[r]}</label>
        ))}
      </div>
    </div>
  );
}

function ReqForm({ wf, stage, r, conds, conditionalStages }: { wf: Workflow; stage: Stage; r?: Req; conds: { key: string; label: string }[]; conditionalStages: Stage[] }) {
  const isNew = !r;
  return (
    <form action={isNew ? addRequirement : saveRequirement} className={`sg-reqform${r && !r.active ? ' off' : ''}`}>
      <input type="hidden" name="wf" value={wf.id} /><input type="hidden" name="stage" value={stage.id} />{r && <input type="hidden" name="req" value={r.id} />}
      <div className="row">
        <label>Name<input name="label" defaultValue={r?.label || ''} required maxLength={160} placeholder="For example: Bank statement" /></label>
        <label>Kind<select name="kind" defaultValue={r?.kind || 'document'}><option value="document">A document</option><option value="confirmation">A confirmation by staff</option><option value="outcome">A recorded outcome (like an interview result)</option></select></label>
        <label>Importance<select name="need" defaultValue={r?.need || 'mandatory'}><option value="mandatory">Required</option><option value="optional">Optional</option><option value="conditional">Only when…</option></select></label>
        <label>It applies when<select name="condition_key" defaultValue={r?.condition_key || ''}><option value="">(not conditional)</option>
          {conds.map((c) => <option key={c.key} value={`cond:${c.key}`}>Student: {c.label}</option>)}
          {conditionalStages.map((s) => <option key={s.key} value={`stage:${s.key}`}>Stage “{s.name}” applies</option>)}</select></label>
      </div>
      <div className="row">
        <label>Document type<input name="doc_type" list="sg-doctypes" defaultValue={r?.doc_type || ''} maxLength={60} placeholder="Same as the name if empty" /></label>
        <label>Counts as done when it is<select name="satisfied_at" defaultValue={r?.satisfied_at || 'approved'}><option value="uploaded">Uploaded</option><option value="approved">Approved by us</option><option value="accepted">Accepted by the school</option></select></label>
        <label>Outcome choices<input name="options" defaultValue={(r?.options || []).join(', ')} placeholder="Passed, Failed, Rescheduled" /></label>
        <label>Choices that count as passed<input name="pass_options" defaultValue={(r?.pass_options || []).join(', ')} placeholder="Passed" /></label>
      </div>
      <label>Note for staff<input name="hint" defaultValue={r?.hint || ''} maxLength={300} /></label>
      <div className="checks">
        <label><input type="checkbox" name="upload" defaultChecked={r ? r.upload : true} /> Staff and student can upload</label>
        <label><input type="checkbox" name="student_visible" defaultChecked={r ? r.student_visible : true} /> Ask the student for it</label>
        {!isNew && <label><input type="checkbox" name="active" defaultChecked={r!.active} /> In use</label>}
        {isNew && <input type="hidden" name="active" value="on" />}
      </div>
      <div className="filters">
        <Btn className={isNew ? 'primary sm' : 'sm'}>{isNew ? 'Add requirement' : 'Save'}</Btn>
        {!isNew && <Btn formAction={removeRequirement} className="btn ghost sm" formNoValidate>Remove</Btn>}
      </div>
    </form>
  );
}

export default async function Workflows({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireTeam();
  if (staff.role !== 'admin') redirect('/?err=' + encodeURIComponent('Only an admin can change workflows.'));
  const sp = await searchParams;
  const ws = await currentWorkspace(), db = admin();
  const [wfs, { data: placed }] = await Promise.all([
    loadWorkflows(db, ws),
    db.from('portal_applications').select('school, stage_key').eq('workspace', ws).not('stage_key', 'is', null).limit(10000),
  ]);
  const inStage = new Map<string, number>();
  (placed || []).forEach((a) => { const k = `${schoolKey(a.school)}|${a.stage_key}`; inStage.set(k, (inStage.get(k) || 0) + 1); });
  const wf = wfs.find((w) => w.school_key === sp.school) || (sp.new ? undefined : wfs[0]);
  const have = new Set(wfs.map((w) => w.school_key));
  const templates = WORKFLOW_TEMPLATES.filter((t) => !have.has(t.school_key));
  const conditionalStages = wf ? wf.stages.filter((s) => s.conditional) : [];

  return (
    <>
      <div className="head"><h1>Workflows</h1><span className="badge plain">{wfs.length} school{wfs.length === 1 ? '' : 's'}</span></div>
      <p className="sub">Each school has its own stages and its own checklist. Changing one school never changes another. Existing applications keep their stage and history.</p>
      {sp.msg && <div className="card ok">{sp.msg}</div>}
      {sp.err && <div className="card err">{sp.err}</div>}

      <nav className="sg-schools" aria-label="Schools">
        {wfs.map((w) => <Link key={w.id} href={`/workflows?school=${w.school_key}`} className={wf?.id === w.id ? 'on' : ''} scroll={false}>{w.school_name.match(/\(([^)]+)\)/)?.[1] || w.school_name}{!w.active && <span className="c">off</span>}</Link>)}
      </nav>

      <details className="card" open={!wfs.length || !!sp.new}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--ink)' }}><Icon n="user-plus" size={16} /> Add a school</summary>
        <form action={createWorkflow} className="sg-form" style={{ padding: '14px 0 0' }}>
          <div className="row">
            <label>School name<input name="school" required maxLength={120} defaultValue={sp.new || ''} placeholder="For example: University of Hull (UOH)" /></label>
            <label>Start from<select name="from" defaultValue={sp.new ? '' : templates[0] ? `tpl:${templates[0].school_key}` : ''}>
              <option value="">Two basic stages (I will add the rest)</option>
              {templates.map((t) => <option key={t.school_key} value={`tpl:${t.school_key}`}>The {t.school_name} workflow</option>)}
              {wfs.map((w) => <option key={w.id} value={`wf:${w.id}`}>A copy of {w.school_name}</option>)}
            </select></label>
          </div>
          <div><Btn className="primary">Create workflow</Btn></div>
          <small className="muted">The school name decides which applications use it: the short name in brackets is matched, so “Hull”, “UOH” and “University of Hull (UOH)” are the same school.</small>
        </form>
      </details>

      {wf && (
        <>
          <datalist id="sg-doctypes">{ALL_DOC_TYPES.map((t) => <option key={t} value={t} />)}<option value="TB Certificate" /><option value="Bank Statement" /><option value="Tuition Fee Receipt" /><option value="Signed Payment Plan" /></datalist>

          <form action={saveWorkflow} className="card sg-form">
            <h2 style={{ margin: 0 }}>{wf.school_name}</h2>
            <input type="hidden" name="wf" value={wf.id} />
            <div className="row"><label>School name<input name="school_name" defaultValue={wf.school_name} required maxLength={120} /></label></div>
            <Roles value={wf.override_roles} label="Who may move an application on with a written reason, even when something is still open" />
            <div className="checks"><label><input type="checkbox" name="active" defaultChecked={wf.active} /> This workflow is in use (switch off to go back to plain pipeline statuses for this school)</label></div>
            <div><Btn className="sm">Save</Btn></div>
          </form>

          <form action={saveConditions} className="card sg-form">
            <h2 style={{ margin: 0 }}>Things that differ between students</h2>
            <p className="muted" style={{ margin: '-6px 0 0' }}>Staff tick these on a student’s Stage tab (for example “needs a TB test certificate”). A requirement can then apply only to those students.</p>
            <input type="hidden" name="wf" value={wf.id} />
            {wf.conditions.map((c) => (
              <div key={c.key} className="filters" style={{ flexWrap: 'nowrap' }}>
                <input name={`label:${c.key}`} defaultValue={c.label} maxLength={80} aria-label="Wording" style={{ flex: 1 }} />
                <label className="checks" style={{ whiteSpace: 'nowrap' }}><span><input type="checkbox" name={`del:${c.key}`} /> Remove</span></label>
              </div>
            ))}
            <label>Add one<input name="new" maxLength={80} placeholder="For example: Student is under 18" /></label>
            <div><Btn className="sm">Save</Btn></div>
          </form>

          <h2 style={{ margin: '22px 0 10px' }}>Stages, in order</h2>
          {wf.stages.map((st, i) => {
            const n = inStage.get(`${wf.school_key}|${st.key}`) || 0;
            return (
              <details key={st.id} className={`sg-admin-stage${st.active ? '' : ' off'}`}>
                <summary>
                  <span className="badge plain">{i + 1}</span>
                  <span className="grow"><b>{st.name}</b></span>
                  {st.conditional && <span className="badge plain purple">Conditional</span>}
                  {!st.active && <span className="badge plain amber">Off</span>}
                  <span className="badge plain">{st.reqs.filter((r) => r.active).length} item{st.reqs.filter((r) => r.active).length === 1 ? '' : 's'}</span>
                  {n > 0 && <span className="badge plain blue">{n} here</span>}
                  <Icon n="down" size={14} />
                </summary>
                <div className="sg-form">
                  <div className="filters">
                    <form action={shiftStage}><input type="hidden" name="wf" value={wf.id} /><input type="hidden" name="stage" value={st.id} /><input type="hidden" name="dir" value="up" /><input type="hidden" name="pos" value={i} /><Btn className="btn ghost sm" disabled={i === 0} aria-label={`Move ${st.name} up`}><Icon n="up" size={13} /> Up</Btn></form>
                    <form action={shiftStage}><input type="hidden" name="wf" value={wf.id} /><input type="hidden" name="stage" value={st.id} /><input type="hidden" name="dir" value="down" /><input type="hidden" name="pos" value={i} /><Btn className="btn ghost sm" disabled={i === wf.stages.length - 1} aria-label={`Move ${st.name} down`}><Icon n="down" size={13} /> Down</Btn></form>
                  </div>
                  <form action={saveStage} className="sg-form" style={{ padding: 0 }}>
                    <input type="hidden" name="wf" value={wf.id} /><input type="hidden" name="stage" value={st.id} />
                    <div className="row">
                      <label>Stage name<input name="name" defaultValue={st.name} required maxLength={80} /></label>
                      <label>Pipeline status it stands for<select name="maps_status" defaultValue={st.maps_status || ''}><option value="">(leave the status as it is)</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
                      <label>Should take at most (days)<input name="delay_days" type="number" min={1} max={365} defaultValue={st.delay_days ?? ''} placeholder="No limit" /></label>
                      <label>Who is told when it is reached<select name="notify" defaultValue={st.notify}>{Object.entries(NOTIFY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    </div>
                    <div className="row">
                      <label>The stage is finished<select name="complete_when" defaultValue={st.complete_when}><option value="manual">When someone moves it on</option><option value="requirements">As soon as everything is in order (then suggested)</option></select></label>
                      <label>When reached, set the offer to<select name="offer_type" defaultValue={st.offer_sync?.offer_type || ''}><option value="">(no change)</option><option>Conditional</option><option>Unconditional</option></select></label>
                      <label>…the CAS to<select name="offer_cas" defaultValue={st.offer_sync?.cas_status || ''}><option value="">(no change)</option>{CAS_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
                      <label>…the visa to<select name="offer_visa" defaultValue={st.offer_sync?.visa_status || ''}><option value="">(no change)</option>{VISA_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
                    </div>
                    <Roles value={st.move_roles} label="Who may move an application into this stage" />
                    <label>Note for staff<input name="hint" defaultValue={st.hint || ''} maxLength={300} /></label>
                    <label>What the student sees about this stage<textarea name="student_note" defaultValue={st.student_note || ''} maxLength={400} placeholder="In plain words, for the student’s dashboard and the update email" /></label>
                    <div className="checks">
                      <label><input type="checkbox" name="conditional" defaultChecked={st.conditional} /> Only some students need this stage</label>
                      <label><input type="checkbox" name="active" defaultChecked={st.active} /> In use</label>
                    </div>
                    {n > 0 && <small className="sg-hint">{n} application{n === 1 ? ' is' : 's are'} in this stage now. Switching it off keeps them here; they just stop being asked for anything, and can be moved on.</small>}
                    <div><Btn className="sm">Save stage</Btn></div>
                  </form>

                  <h3 style={{ margin: '6px 0 0', fontSize: 14 }}>What this stage asks for before an application can leave it</h3>
                  <div className="sg-reqs">
                    {st.reqs.map((r) => <ReqForm key={r.id} wf={wf} stage={st} r={r} conds={wf.conditions} conditionalStages={conditionalStages.filter((c) => c.id !== st.id)} />)}
                    {!st.reqs.length && <small className="muted">Nothing yet: an application can leave this stage at any time.</small>}
                    <details><summary className="linkish" style={{ listStyle: 'none', cursor: 'pointer' }}><Icon n="user-plus" size={14} /> Add a requirement</summary>
                      <div style={{ marginTop: 10 }}><ReqForm wf={wf} stage={st} conds={wf.conditions} conditionalStages={conditionalStages.filter((c) => c.id !== st.id)} /></div></details>
                  </div>
                </div>
              </details>
            );
          })}

          <form action={addStage} className="card sg-form" style={{ marginTop: 14 }}>
            <h2 style={{ margin: 0 }}>Add a stage</h2>
            <input type="hidden" name="wf" value={wf.id} />
            <div className="row">
              <label>Name<input name="name" required maxLength={80} placeholder="For example: Medical check" /></label>
              <label>Place it after<select name="after" defaultValue={wf.stages[wf.stages.length - 1]?.id}>{wf.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            </div>
            <div className="checks"><label><input type="checkbox" name="conditional" /> Only some students need this stage</label></div>
            <div><Btn className="primary sm">Add stage</Btn></div>
          </form>
        </>
      )}
    </>
  );
}
