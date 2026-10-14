'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Icon from './Icon';
import { applyMove, previewMove, undoMoves } from '@/app/moveActions';
import { progKey, RESET_STATUS, statusDefault, suggest, type Applied, type Catalog, type MoveReason, type PlanRow, type Preview } from '@/lib/moves';
import { schoolKey } from '@/lib/docs';
import { STATUSES } from '@/lib/constants';

type Cur = { name: string; school: string | null; programme: string | null; status: string | null };
type Props = { mode: 'one' | 'bulk'; id?: string; current?: Cur; catalog: Catalog; variant?: 'menu' | 'ghost' | 'icon'; label?: string };

/** The button, and (once pressed) the sheet. Works for one student (from their page) or for the ticked students in a list. */
export default function MoveButton({ mode, id, current, catalog, variant = 'ghost', label }: Props) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const btn = useRef<HTMLButtonElement>(null);
  const start = () => {
    const list = mode === 'one' ? [id!] : Array.from(btn.current?.closest('form')?.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked') || [], (c) => c.value);
    btn.current?.closest('details')?.removeAttribute('open');
    setIds(list); setOpen(true);
  };
  const text = label || (mode === 'bulk' ? 'Change school / programme' : 'Change school or programme');
  return (
    <>
      {variant === 'menu' ? <button ref={btn} type="button" className="item" onClick={start}><Icon n="swap" /> {text}</button>
        : variant === 'icon' ? <button ref={btn} type="button" className="iconbtn mv-edit" onClick={start} aria-label={text} title={text}><Icon n="swap" size={15} /></button>
        : <button ref={btn} type="button" className="btn ghost sm" onClick={start}><Icon n="swap" size={14} /> {text}</button>}
      {open && typeof document !== 'undefined' && createPortal(<Sheet mode={mode} ids={ids} current={current} catalog={catalog} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const statusWord = (s: string | null) => s || 'no status';

function Sheet({ mode, ids, current, catalog, onClose }: { mode: 'one' | 'bulk'; ids: string[]; current?: Cur; catalog: Catalog; onClose: () => void }) {
  const router = useRouter();
  const defaultReason: MoveReason = mode === 'one' && statusDefault(current?.status ?? null, 'switch') ? 'switch' : 'fix';
  const [reason, setReason] = useState<MoveReason>(defaultReason);
  const [school, setSchool] = useState(''), [programme, setProgramme] = useState('');
  const [status, setStatus] = useState<string | null>(null), [clear, setClear] = useState<boolean | null>(null);
  const [notify, setNotify] = useState(true), [email, setEmail] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const [done, setDone] = useState<Applied | null>(null), [undoState, setUndoState] = useState<'' | 'busy' | 'done' | string>('');
  const seq = useRef(0), first = useRef<HTMLInputElement>(null), changed = useRef(false);

  const statusValue = status ?? (reason === 'switch' ? RESET_STATUS : '');
  const clearOffer = clear ?? reason === 'switch';

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  });
  useEffect(() => {
    if (!ids.length) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try { const r = await previewMove({ ids, school, programme, reason, status: statusValue }); if (n === seq.current) setPv(r); }
      catch { if (n === seq.current) setPv({ ok: false, error: 'Could not check that. Please try again.' }); }
    }, pv ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, school, programme, reason, statusValue]);

  function close() { if (changed.current) router.refresh(); onClose(); }

  const rows = pv?.ok ? pv.rows : [];
  const ok = rows.filter((r) => r.state === 'ok');
  const schoolMoves = ok.some((r) => r.toSchool && r.fromSchool && schoolKey(r.toSchool) !== schoolKey(r.fromSchool));
  const single = mode === 'one' || rows.length === 1;
  const effSchoolKey = school ? schoolKey(pv?.ok && pv.toSchool ? pv.toSchool : school) : mode === 'one' ? schoolKey(current?.school ?? null) : '';
  const allProgrammes = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    catalog.schools.forEach((s) => s.programmes.forEach((p) => { const k = progKey(p.name), e = m.get(k); m.set(k, { name: e?.name || p.name, n: (e?.n || 0) + p.n }); }));
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [catalog]);
  const progPool = effSchoolKey ? catalog.schools.find((s) => s.key === effSchoolKey)?.programmes || [] : allProgrammes;
  const schoolChips = suggest(catalog.schools.map((s) => ({ name: s.name, n: s.n })), school, 6);
  const progChips = suggest(progPool, programme, 6);
  // a programme that is kept (nothing typed) but not used at the new school before
  const keptProgNew = mode === 'one' && school && !programme && current?.programme && pv?.ok && !pv.schoolIsNew && !(catalog.schools.find((s) => s.key === effSchoolKey)?.programmes || []).some((p) => progKey(p.name) === progKey(current.programme));

  async function go() {
    setBusy(true); setErr('');
    try {
      const r = await applyMove({ ids, school, programme, reason, status: statusValue, clearOffer: schoolMoves && pv?.ok && pv.anyOffer ? clearOffer : false, notify: notify && !!(pv?.ok && pv.anyNotify), email: email && notify });
      if (!r.ok) setErr(r.error); else { changed.current = r.moved > 0; setDone(r); }
    } catch { setErr('Something went wrong. Nothing was lost; please try again.'); }
    setBusy(false);
  }
  async function undo() {
    if (!done?.ok) return;
    setUndoState('busy');
    try { const r = await undoMoves(done.undo); setUndoState(r.undone ? (r.problems.length ? r.problems.join(' ') : 'done') : r.problems.join(' ') || 'Nothing was undone.'); changed.current = true; }
    catch { setUndoState('Could not undo. Please try again.'); }
  }

  const title = mode === 'bulk' ? 'Change school or programme' : `Change school or programme`;
  const nOk = ok.length;
  const cta = busy ? 'Saving…' : !nOk ? 'Nothing to change yet' : schoolMoves ? (nOk === 1 ? 'Move student' : `Move ${nOk} students`) : (nOk === 1 ? 'Update programme' : `Update ${nOk} students`);

  return (
    <div className="modal-bg mv-bg" onClick={() => !busy && close()}>
      <div className="modal mvs" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="mv-h"><b>{done ? (done.ok && done.moved ? 'Done' : 'Nothing was changed') : title}</b><button type="button" className="iconbtn" onClick={() => !busy && close()} aria-label="Close"><Icon n="x" size={16} /></button></div>

        {!ids.length ? (
          <div className="mv-body"><p className="muted" style={{ margin: 0 }}>Tick at least one student in the list first, then press this again.</p></div>
        ) : done?.ok ? (
          <Done done={done} undoState={undoState} undo={undo} onClose={close} />
        ) : (
          <>
            <div className="mv-body">
              {single && rows[0] ? (
                <div className="mv-who"><b>{rows[0].name}</b><span>{[rows[0].fromSchool, rows[0].fromProgramme].filter(Boolean).join(' · ') || 'No school or programme yet'} · {statusWord(rows[0].status)}</span></div>
              ) : (
                <div className="mv-who"><b>{ids.length} student{ids.length === 1 ? '' : 's'} selected</b><span>{fromSummary(rows)}</span></div>
              )}

              <div className="mv-fld">
                <span className="mv-lbl">Why</span>
                <div className="mv-seg" role="radiogroup" aria-label="Why">
                  <button type="button" role="radio" aria-checked={reason === 'fix'} onClick={() => setReason('fix')}>Correcting a mistake</button>
                  <button type="button" role="radio" aria-checked={reason === 'switch'} onClick={() => setReason('switch')}>Student is switching</button>
                </div>
                <small className="mv-hint">{reason === 'fix' ? 'Keeps the status, offer and CAS exactly as they are.' : 'Restarts the application where the old status or offer belonged to the old school.'}</small>
              </div>

              <div className="mv-fld">
                <label className="mv-lbl" htmlFor="mv-school">New school</label>
                <input id="mv-school" ref={first} value={school} onChange={(e) => setSchool(e.target.value)} placeholder={mode === 'one' && current?.school ? `Keep ${current.school}` : 'Keep each student’s school'} autoComplete="off" />
                {schoolChips.length > 0 && <div className="mv-chips">{schoolChips.map((c) => <button key={c.name} type="button" className={`mv-chip ${schoolKey(c.name) === schoolKey(school) ? 'is-on' : ''}`} onClick={() => setSchool(c.name)}>{c.name}<i>{c.n}</i></button>)}</div>}
                {pv?.ok && school && (pv.schoolIsNew
                  ? <small className="mv-hint t-warn">New school: nobody has used it in the portal yet. {pv.similarSchools.length > 0 && <>Did you mean {pv.similarSchools.map((n, i) => <button key={n} type="button" className="linkish" onClick={() => setSchool(n)}>{i ? ', ' : ''}{n}</button>)}?</>}</small>
                  : pv.toSchool && progKey(pv.toSchool) !== progKey(school) ? <small className="mv-hint">Using “{pv.toSchool}”.</small> : null)}
              </div>

              <div className="mv-fld">
                <label className="mv-lbl" htmlFor="mv-prog">New programme</label>
                <input id="mv-prog" value={programme} onChange={(e) => setProgramme(e.target.value)} placeholder={mode === 'one' && current?.programme ? `Keep ${current.programme}` : 'Keep each student’s programme'} autoComplete="off" />
                {progChips.length > 0 && <div className="mv-chips">{progChips.map((c) => <button key={c.name} type="button" className={`mv-chip ${progKey(c.name) === progKey(programme) ? 'is-on' : ''}`} onClick={() => setProgramme(c.name)}>{c.name}<i>{c.n}</i></button>)}</div>}
                {pv?.ok && programme && (pv.programmeIsNew && !pv.schoolIsNew
                  ? <small className="mv-hint t-warn">Not used at {pv.toSchool || 'this school'} before. Check the spelling. {pv.similarProgrammes.length > 0 && <>Did you mean {pv.similarProgrammes.map((n, i) => <button key={n} type="button" className="linkish" onClick={() => setProgramme(n)}>{i ? ', ' : ''}{n}</button>)}?</>}</small>
                  : pv.toProgramme && progKey(pv.toProgramme) !== progKey(programme) ? <small className="mv-hint">Using “{pv.toProgramme}”.</small> : null)}
                {keptProgNew && <small className="mv-hint t-warn">{current?.programme} has not been used at {pv && pv.ok ? pv.toSchool : 'that school'} before. Set a programme if it is different there.</small>}
              </div>

              {!pv && <p className="muted" style={{ margin: 0 }}>Checking…</p>}
              {pv && !pv.ok && <div className="mv-note t-stop">{pv.error}</div>}
              {pv?.ok && (school || programme) && (
                <div className="mv-list" aria-live="polite">
                  {rows.map((r) => <Line key={r.key} r={r} compact={!single} />)}
                  {pv.skipped > 0 && <div className="mv-note t-info">{pv.skipped} more students are not shown. Run it again for the rest.</div>}
                </div>
              )}

              {pv?.ok && ok.length > 0 && (school || programme) && (
                <div className="mv-opts">
                  {schoolMoves && (
                    <label className="mv-opt"><span>Status afterwards</span>
                      <select value={statusValue} onChange={(e) => setStatus(e.target.value)}>
                        <option value="">Keep each student’s status</option>
                        <option value={RESET_STATUS}>Restart where it belonged to the old school</option>
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select></label>
                  )}
                  {schoolMoves && pv.anyOffer && <label className="mv-chk"><input type="checkbox" checked={clearOffer} onChange={(e) => setClear(e.target.checked)} /><span>Clear the old offer, CAS and visa details<small>They are kept in the history, so Undo brings them back.</small></span></label>}
                  {pv.anyNotify && <label className="mv-chk"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /><span>Let the student know<small>A note in their portal and a phone alert if they turned those on.</small></span></label>}
                  {pv.anyNotify && notify && ok.length <= 15 && <label className="mv-chk mv-sub"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /><span>Also send them an email</span></label>}
                </div>
              )}
              {err && <div className="mv-note t-stop">{err}</div>}
            </div>
            <div className="mv-foot">
              <button type="button" className="btn ghost" onClick={() => !busy && close()}>Cancel</button>
              <button type="button" className="btn primary" disabled={busy || !nOk} onClick={go}>{cta}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "RCL (5), BPP University (4)" for the students that were ticked. */
function fromSummary(rows: PlanRow[]): string {
  const m = new Map<string, number>();
  rows.forEach((r) => { const k = r.fromSchool || 'No school'; m.set(k, (m.get(k) || 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} (${n})`).join(' · ') + (m.size > 4 ? ' …' : '');
}

function Line({ r, compact }: { r: PlanRow; compact: boolean }) {
  const schoolChanged = r.toSchool && r.fromSchool ? schoolKey(r.toSchool) !== schoolKey(r.fromSchool) : r.toSchool !== r.fromSchool;
  const progChanged = progKey(r.toProgramme) !== progKey(r.fromProgramme);
  const after = [r.toSchool, r.toProgramme].filter(Boolean).join(' · ') || '—';
  const before = [r.fromSchool, r.fromProgramme].filter(Boolean).join(' · ') || '—';
  return (
    <div className="mv-line" data-state={r.state}>
      {compact && <b className="mv-name">{r.name}</b>}
      {r.state !== 'nochange' && (
        <div className="mv-diff">
          <span className="old">{before}</span>
          <Icon n="arrow" size={14} />
          <span className="new"><span className={schoolChanged ? 'chg' : ''}>{r.toSchool || '—'}</span>{r.toProgramme ? <> · <span className={progChanged ? 'chg' : ''}>{r.toProgramme}</span></> : null}</span>
        </div>
      )}
      {r.toStatus && r.state === 'ok' && <div className="mv-note t-info">Status: {statusWord(r.status)} → {r.toStatus}</div>}
      {r.notes.map((n, i) => <div key={i} className={`mv-note t-${n.tone}`}>{n.href ? <a href={n.href}>{n.text}</a> : n.text}</div>)}
      {r.state === 'nochange' && !r.notes.length && <div className="mv-note t-info">{after}</div>}
    </div>
  );
}

function Done({ done, undoState, undo, onClose }: { done: Extract<Applied, { ok: true }>; undoState: string; undo: () => void; onClose: () => void }) {
  const moved = done.outcomes.filter((o) => o.result === 'moved'), other = done.outcomes.filter((o) => o.result !== 'moved');
  const upd = moved.filter((o) => o.sheet === 'updated').length, pend = moved.filter((o) => o.sheet === 'pending');
  const why = [...new Set(pend.map((o) => o.note).filter(Boolean))][0];
  const undone = undoState === 'done';
  return (
    <>
      <div className="mv-body">
        <div className={`mv-result ${moved.length ? 'is-good' : ''}`}>
          <span className="ic"><Icon n={undone ? 'left' : moved.length ? 'check-circle' : 'alert'} size={22} /></span>
          <div><b>{undone ? 'Put back' : moved.length ? `${moved.length} student${moved.length === 1 ? '' : 's'} updated` : 'Nothing was changed'}</b>
            {!undone && moved.length > 0 && <small>{upd ? `Sheet1 updated for ${upd}. ` : ''}{pend.length ? `Sheet1 not updated for ${pend.length}: the portal shows the change, and Sheet1 keeps the old value until it is updated. ` : ''}{!upd && !pend.length ? 'Saved in the portal.' : ''}</small>}
          </div>
        </div>
        {!undone && pend.length > 0 && why && <div className="mv-note t-warn">{why} {pend.length > 1 ? 'Press “Sync now” on the Applications page to finish writing them to Sheet1.' : 'Open the student later and press “Update Sheet1”.'}</div>}
        {undoState && undoState !== 'busy' && undoState !== 'done' && <div className="mv-note t-stop">{undoState}</div>}
        {!undone && other.length > 0 && <div className="mv-list">{other.map((o) => <div key={o.key} className="mv-line" data-state={o.result}><b className="mv-name">{o.name}</b><div className={`mv-note ${o.result === 'failed' ? 't-stop' : 't-info'}`}>{o.note || (o.result === 'nochange' ? 'Nothing to change.' : 'Skipped.')}</div></div>)}</div>}
        {!undone && moved.length > 1 && <div className="mv-list">{moved.map((o) => <a key={o.key} className="mv-line" data-state="moved" href={`/applications/${encodeURIComponent(o.primary)}`}><b className="mv-name">{o.name}</b><span className="mv-note t-info">{o.sheet === 'pending' ? 'Sheet1 not updated' : 'Updated'}</span></a>)}</div>}
      </div>
      <div className="mv-foot">
        {!undone && done.undo.length > 0 && <button type="button" className="btn ghost" disabled={undoState === 'busy'} onClick={undo}><Icon n="left" size={14} /> {undoState === 'busy' ? 'Undoing…' : 'Undo'}</button>}
        <button type="button" className="btn primary" onClick={onClose}>Done</button>
      </div>
    </>
  );
}
