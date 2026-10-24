'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import ReqRow, { type FileLite } from './ReqRow';
import { moveStage, type MoveResult } from '@/app/stageActions';
import { applicableStages, checkMove, findStage, nextStage, stageReqs, type AppState, type Role, type Workflow } from '@/lib/stageEngine';

/** The panel behind "Move to next stage": where it goes, what must be done first (with the controls to do it right here), and what the next stage will ask for. */
export default function StageSheet({ wf, st, appId, appName, role, files, initialTarget, onClose }: { wf: Workflow; st: AppState; appId: string; appName: string; role: Role; files: FileLite[]; initialTarget?: string; onClose: () => void }) {
  const router = useRouter();
  const recommended = nextStage(wf, st.stage_key, st.flags);
  const [target, setTarget] = useState(initialTarget || recommended?.key || '');
  const [enable, setEnable] = useState<string[]>([]);
  const [note, setNote] = useState(''), [reason, setReason] = useState(''), [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [done, setDone] = useState<Extract<MoveResult, { ok: true }> | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  });

  const flags = useMemo(() => ({ ...st.flags, ...Object.fromEntries(enable.map((k) => [`stage:${k}`, true])) }), [st.flags, enable]);
  const state = useMemo<AppState>(() => ({ ...st, flags }), [st, flags]);
  const cur = findStage(wf, st.stage_key), tgt = findStage(wf, target);
  const check = useMemo(() => (tgt ? checkMove(wf, state, tgt.key, { role }) : null), [wf, state, tgt, role]);
  const all = wf.stages.filter((s) => s.active);
  const route = applicableStages(wf, flags);

  // requirements on the way (current stage and any applicable stage jumped over), shown grouped by stage so each can be finished right here
  const way = useMemo(() => {
    if (!check || check.direction !== 'forward') return [];
    const stages = [...(cur && route.some((s) => s.id === cur.id) ? [cur] : []), ...check.skipped];
    return stages.map((s) => ({ stage: s, reqs: stageReqs(wf, s, state) })).filter((g) => g.reqs.length);
  }, [check, cur, route, wf, state]);
  // conditional stages between here and the target that the person may switch on
  const maybe = wf.stages.filter((s) => s.active && s.conditional && st.flags[`stage:${s.key}`] !== true && tgt && s.position < tgt.position && (!cur || s.position > cur.position));
  const preview = tgt ? stageReqs(wf, tgt, state).filter((r) => r.kind === 'document' && r.upload && r.need !== 'optional') : [];
  const back = check?.direction === 'backward';
  const blocked = !!check && !check.ok;
  const needsReason = blocked && !back && !check!.roleBlocked;
  const canGo = !!tgt && !!check && !busy && !check.roleBlocked && check.direction !== 'same' && (check.ok || (needsReason && check.canOverride && over && reason.trim().length >= 5)) && (!back || note.trim().length >= 3);

  function close() { if (done || enable.length) router.refresh(); onClose(); }
  async function go() {
    if (!tgt) return;
    setBusy(true); setErr('');
    const r = await moveStage(appId, tgt.key, { note, override: over ? reason : undefined, enable });
    setBusy(false);
    if (!r.ok) { setErr(r.error); router.refresh(); return; }
    setDone(r); router.refresh();
  }
  const toggle = (k: string) => setEnable((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  const body = (
    <div className="modal-bg mv-bg" onClick={() => !busy && close()}>
      <div className="modal mvs sg-sheet" role="dialog" aria-modal="true" aria-label="Move to another stage" onClick={(e) => e.stopPropagation()}>
        <div className="mv-h"><b>{done ? 'Stage updated' : back ? 'Move back' : 'Move to next stage'}</b><button type="button" className="iconbtn" onClick={() => !busy && close()} aria-label="Close"><Icon n="x" size={16} /></button></div>

        {done ? (
          <>
            <div className="mv-body">
              <div className="mv-result is-good"><span className="ic"><Icon n="check-circle" size={22} /></span>
                <div><b>{appName} is now in “{done.to}”</b>
                  <small>{done.from ? `From “${done.from}”. ` : ''}{done.override ? 'Moved with an override; the open items are kept in the history. ' : ''}{done.status ? `Pipeline status is now “${done.status}”. ` : ''}{done.sheet === 'updated' ? 'The master sheet was updated.' : ''}</small></div></div>
              {done.sheet === 'failed' && <div className="mv-note t-warn">Saved in the portal, but the master sheet could not be updated ({done.sheetError || 'try again later'}). The next sync will show the portal’s status until the sheet is fixed.</div>}
              <div className="mv-note t-info">The people who should know have been notified. Open the checklist to see what this stage asks for.</div>
            </div>
            <div className="mv-foot"><button type="button" className="btn primary" onClick={close}>Done</button></div>
          </>
        ) : (
          <>
            <div className="mv-body">
              <div className="mv-who"><b>{appName}</b><span>{cur ? <>In <b>{cur.name}</b></> : 'Not in a stage yet'}{tgt ? <> → <b>{tgt.name}</b></> : ''}</span></div>

              <div className="mv-fld">
                <label className="mv-lbl" htmlFor="sg-target">Move to</label>
                <select id="sg-target" value={target} onChange={(e) => { setTarget(e.target.value); setOver(false); setErr(''); }}>
                  {recommended && <option value={recommended.key}>{recommended.name} (recommended)</option>}
                  {all.filter((s) => s.key !== recommended?.key && s.key !== st.stage_key).map((s) => <option key={s.key} value={s.key}>{s.name}{s.conditional ? ' (conditional)' : ''}{cur && s.position < cur.position ? ' · earlier stage' : ''}</option>)}
                </select>
                {tgt?.hint && <small className="mv-hint">{tgt.hint}</small>}
                {!recommended && <small className="mv-hint">This is the last stage of the workflow. Choose another stage to move back or sideways.</small>}
              </div>

              {check && !check.roleBlocked && check.direction === 'forward' && (
                blocked
                  ? <div className="sg-banner is-warn"><Icon n="alert" size={18} /><div><b>Not ready yet</b><span>{check.blockers.length} requirement{check.blockers.length === 1 ? ' is' : 's are'} still open. Finish {check.blockers.length === 1 ? 'it' : 'them'} below, then move on.</span></div></div>
                  : <div className="sg-banner is-good"><Icon n="check-circle" size={18} /><div><b>Ready to move</b><span>Everything this stage needs is in order.</span></div></div>
              )}
              {check?.roleBlocked && <div className="sg-banner is-stop"><Icon n="lock" size={18} /><div><b>Not allowed</b><span>Your role cannot move an application into “{tgt?.name}”. Ask an admin.</span></div></div>}
              {back && <div className="sg-banner is-info"><Icon n="left" size={18} /><div><b>Going back</b><span>No requirements are checked when moving back, but say why below.</span></div></div>}
              {check?.enablesTarget && <div className="mv-note t-info">“{tgt?.name}” only applies to some students. Moving there switches it on for {appName}.</div>}

              {way.map((g) => (
                <section key={g.stage.id} className="sg-group">
                  <h4>{g.stage.name === cur?.name ? `Before leaving “${g.stage.name}”` : `Also needed at “${g.stage.name}” (skipped)`}</h4>
                  {g.reqs.map((r) => <ReqRow key={r.ref} r={r} appId={appId} files={files} compact />)}
                </section>
              ))}

              {maybe.length > 0 && (
                <section className="sg-group">
                  <h4>Does this student need any of these stages?</h4>
                  {maybe.map((s) => (
                    <label key={s.key} className="mv-chk"><input type="checkbox" checked={enable.includes(s.key)} onChange={() => toggle(s.key)} /><span>Include “{s.name}” for this student{s.hint && <small>{s.hint}</small>}</span></label>
                  ))}
                </section>
              )}

              {preview.length > 0 && !back && (
                <section className="sg-group">
                  <h4>What “{tgt?.name}” will need from the student</h4>
                  <p className="mv-hint" style={{ margin: '0 0 8px' }}>You can upload these now, or later from the stage checklist. The student is also asked for them in their portal.</p>
                  {preview.map((r) => <ReqRow key={r.ref} r={r} appId={appId} files={files} compact />)}
                </section>
              )}

              <div className="mv-fld">
                <label className="mv-lbl" htmlFor="sg-note">{back ? 'Why is it going back? (required)' : 'Note (optional)'}</label>
                <input id="sg-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={back ? 'For example: school asked for a new bank statement' : 'Kept in the stage history'} />
              </div>

              {needsReason && (
                check!.canOverride ? (
                  <div className="mv-opts">
                    <label className="mv-chk"><input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /><span>Move anyway (override)<small>For when the school has agreed to skip a step. What is open stays in the history.</small></span></label>
                    {over && <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Why is it being moved without these? (required)" aria-label="Override reason" />}
                  </div>
                ) : <div className="mv-note t-info">Only an admin can override open requirements.</div>
              )}
              {err && <div className="mv-note t-stop" role="alert">{err}</div>}
            </div>
            <div className="mv-foot">
              <button type="button" className="btn ghost" onClick={() => !busy && close()}>Cancel</button>
              <button type="button" className="btn primary" disabled={!canGo} onClick={go}>{busy ? 'Moving…' : tgt ? `${over && blocked ? 'Override and move' : 'Move'} to ${tgt.name}` : 'Choose a stage'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(body, document.body);
}
