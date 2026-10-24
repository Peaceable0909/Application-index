// The rules of the stage workflows, with no database and no framework, so every rule can be tested on its own.
//
// A school has a workflow: an ordered list of stages. A stage has requirements, and the requirements of a stage are what must be
// true before an application may LEAVE that stage (moving forward). Requirements are documents, confirmations a person gives, or
// recorded outcomes (like an interview result). Some stages and some requirements apply only to certain applicants.
//
// Uploading a file never satisfies a requirement by itself: by default a document has to be approved after review, and a school
// can ask for the stronger "accepted by the school".

export type Role = 'admin' | 'staff' | 'counselor';
export type ReqKind = 'document' | 'confirmation' | 'outcome';
export type Need = 'mandatory' | 'optional' | 'conditional';
export type SatisfiedAt = 'uploaded' | 'approved' | 'accepted';
export type CheckState = 'requested' | 'received' | 'reviewed' | 'approved' | 'rejected' | 'accepted';
export type Notify = 'none' | 'counselor' | 'admins' | 'both';

export type Req = {
  id: string; key: string; label: string; kind: ReqKind; doc_type: string | null; need: Need;
  /** For a conditional requirement: "cond:tb_required" (an applicant circumstance) or "stage:cas_requested" (applies when that stage applies). */
  condition_key: string | null;
  upload: boolean; satisfied_at: SatisfiedAt; student_visible: boolean; position: number; active: boolean;
  options: string[] | null; pass_options: string[] | null; hint: string | null;
};
export type Stage = {
  id: string; key: string; name: string; position: number; active: boolean; conditional: boolean; maps_status: string | null;
  move_roles: Role[]; complete_when: 'manual' | 'requirements'; notify: Notify; delay_days: number | null;
  offer_sync: { offer_type?: string; cas_status?: string; visa_status?: string } | null; hint: string | null;
  /** What the stage means, in words for the student (their dashboard and the "Inform student" email). */
  student_note: string | null; reqs: Req[];
};
export type Workflow = {
  id: string; workspace: string; school_key: string; school_name: string; active: boolean;
  override_roles: Role[]; conditions: { key: string; label: string }[]; stages: Stage[];
};
/** An extra requirement for one applicant (a school added something, or this student needs an extra document). */
export type ExtraReq = { id: string; stage_key: string; label: string; kind: ReqKind; doc_type: string | null; need: 'mandatory' | 'optional'; satisfied_at: SatisfiedAt; options: string[] | null; pass_options: string[] | null };
export type Check = { ref: string; state: CheckState; doc_id: string | null; value: string | null; note: string | null; by: string | null; at: string };
export type Doc = { id: string; type: string; name: string; created_at: string };
export type AppState = {
  stage_key: string | null; stage_at: string | null;
  flags: Record<string, boolean>;          // "stage:<key>" / "cond:<key>" -> on or off, set for this applicant
  extras: ExtraReq[]; checks: Check[]; docs: Doc[];
};

// ---- small helpers ----
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
export const sameType = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && norm(a) === norm(b);
export const refOf = (r: { id: string }, extra: boolean) => `${extra ? 'app' : 'std'}:${r.id}`;
const LEVEL: Record<CheckState, number> = { requested: 0, received: 2, reviewed: 3, approved: 4, accepted: 5, rejected: -1 };
const NEEDS: Record<SatisfiedAt, number> = { uploaded: 1, approved: 4, accepted: 5 };
export const STATE_WORD: Record<string, string> = { missing: 'Not received', uploaded: 'Uploaded, not reviewed', received: 'Received', reviewed: 'Reviewed', approved: 'Approved', accepted: 'Accepted by the school', rejected: 'Rejected', done: 'Done', failed: 'Not passed' };

// ---- stages ----
const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position;

/** A stage applies to an applicant when it is active and, if it is a conditional one, was switched on for them. */
export const stageApplies = (s: Stage, flags: Record<string, boolean>) => s.active && (!s.conditional || flags[`stage:${s.key}`] === true);

export const applicableStages = (wf: Workflow, flags: Record<string, boolean>) => wf.stages.filter((s) => stageApplies(s, flags)).sort(byPos);

export const findStage = (wf: Workflow, key: string | null | undefined) => (key ? wf.stages.find((s) => s.key === key) ?? null : null);

/** The stage after `current` on this applicant's route. With no current stage this is the first stage. */
export function nextStage(wf: Workflow, current: string | null, flags: Record<string, boolean>): Stage | null {
  const route = applicableStages(wf, flags);
  if (!current) return route[0] ?? null;
  const cur = findStage(wf, current);
  if (!cur) return route[0] ?? null;
  return route.find((s) => s.position > cur.position) ?? null;
}

export function progress(wf: Workflow, current: string | null, flags: Record<string, boolean>) {
  const route = applicableStages(wf, flags), cur = findStage(wf, current);
  if (!cur) return { index: 0, total: route.length, percent: 0 };
  const index = route.filter((s) => s.position <= cur.position).length;
  return { index, total: route.length, percent: route.length ? Math.round((index / route.length) * 100) : 0 };
}

/** Days in the current stage beyond what the stage allows, or 0. */
export function delayedDays(stage: Stage | null, stageAt: string | null, now = Date.now()) {
  if (!stage?.delay_days || !stageAt) return 0;
  const days = Math.floor((now - new Date(stageAt).getTime()) / 864e5);
  return Math.max(0, days - stage.delay_days);
}

// ---- requirements ----
export type ReqEval = {
  ref: string; reqId: string; extra: boolean; stageKey: string; stageName: string;
  label: string; kind: ReqKind; docType: string | null; need: Need | 'mandatory'; applies: boolean; upload: boolean; studentVisible: boolean;
  satisfiedAt: SatisfiedAt; options: string[] | null; passOptions: string[] | null; hint: string | null;
  /** missing | uploaded | received | reviewed | approved | accepted | rejected | done | failed */
  status: string; level: number; satisfied: boolean; blocking: boolean;
  doc: Doc | null; check: Check | null; value: string | null; note: string | null;
  /** Why it is not satisfied, in words for a person. */
  why: string | null;
  /** Set when an earlier check of the same kind of document already covers this one. */
  carriedFrom: string | null;
};

/** Whether a conditional requirement applies to this applicant. */
function conditionHolds(key: string | null, wf: Workflow, flags: Record<string, boolean>): boolean {
  if (!key) return false;
  if (key.startsWith('cond:')) return flags[key] === true;
  if (key.startsWith('stage:')) { const s = findStage(wf, key.slice(6)); return !!s && stageApplies(s, flags); }
  return false;
}

const latestOfType = (docs: Doc[], type: string | null) => (type ? [...docs].filter((d) => sameType(d.type, type)).sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null : null);

type Raw = { id: string; label: string; kind: ReqKind; doc_type: string | null; satisfied_at: SatisfiedAt; options: string[] | null; pass_options: string[] | null; need: Need; upload: boolean; student_visible: boolean; hint: string | null; condition_key: string | null; active: boolean };

function evalOne(raw: Raw, extra: boolean, stage: Stage, wf: Workflow, st: AppState, carry: Map<string, { level: number; docId: string | null; from: string }>): ReqEval {
  const ref = refOf(raw, extra);
  const check = st.checks.find((c) => c.ref === ref) ?? null;
  const applies = raw.active && (raw.need !== 'conditional' || conditionHolds(raw.condition_key, wf, st.flags));
  let status = 'missing', level = 0, doc: Doc | null = null, value: string | null = null, why: string | null = null, carriedFrom: string | null = null;

  if (raw.kind === 'outcome') {
    value = check?.value ?? null;
    if (value) {
      const pass = (raw.pass_options || []).some((p) => p.toLowerCase() === value!.toLowerCase());
      status = pass ? 'done' : 'failed'; level = pass ? 4 : -1;
      if (!pass) why = `Outcome recorded: ${value}`;
    } else why = 'No outcome recorded yet';
  } else if (raw.kind === 'confirmation') {
    if (check) { level = LEVEL[check.state]; status = check.state === 'requested' ? 'missing' : check.state; }
    if (level < NEEDS[raw.satisfied_at]) why = status === 'rejected' ? `Rejected${check?.note ? `: ${check.note}` : ''}` : raw.satisfied_at === 'accepted' ? 'Not confirmed as accepted by the school' : 'Not confirmed yet';
  } else {
    // document
    const matching = latestOfType(st.docs, raw.doc_type);
    doc = (check?.doc_id ? st.docs.find((d) => d.id === check.doc_id) : null) ?? matching;
    // a file uploaded after the last review replaces what was reviewed
    const superseded = !!check && !!doc && !!matching && check.doc_id !== matching.id && +new Date(matching.created_at) > +new Date(check.at);
    if (superseded) doc = matching;
    if (check && !superseded) level = LEVEL[check.state];
    if (check?.state === 'rejected' && doc && +new Date(doc.created_at) > +new Date(check.at)) level = 1;   // a new file arrived after the rejection
    if (doc && level >= 0 && level < 1) level = 1;
    if (!doc && level === 1) level = 0;
    // an earlier check of the same kind of document already covers this one
    if (level < NEEDS[raw.satisfied_at] && raw.doc_type) {
      const c = carry.get(norm(raw.doc_type));
      if (c && c.level >= NEEDS[raw.satisfied_at] && (!doc || !c.docId || c.docId === doc.id)) { level = c.level; carriedFrom = c.from; }
    }
    status = level === -1 ? 'rejected' : level >= 5 ? 'accepted' : level >= 4 ? 'approved' : level >= 3 ? 'reviewed' : level >= 2 ? 'received' : level >= 1 ? 'uploaded' : 'missing';
    if (level < NEEDS[raw.satisfied_at]) {
      why = status === 'rejected' ? `Rejected${check?.note ? `: ${check.note}` : ''}. A new file is needed`
        : status === 'missing' ? 'Not received'
        : raw.satisfied_at === 'accepted' ? (status === 'approved' ? 'Approved by us; still to be accepted by the school' : 'Still to be reviewed, approved and accepted by the school')
        : raw.satisfied_at === 'approved' ? (status === 'uploaded' ? 'Still to be reviewed and approved' : 'Still to be approved') : null;
    }
  }
  const satisfied = level >= (raw.kind === 'outcome' ? 4 : NEEDS[raw.satisfied_at]);
  return {
    ref, reqId: raw.id, extra, stageKey: stage.key, stageName: stage.name, label: raw.label, kind: raw.kind, docType: raw.doc_type, need: raw.need, applies,
    upload: raw.upload, studentVisible: raw.student_visible, satisfiedAt: raw.satisfied_at, options: raw.options, passOptions: raw.pass_options, hint: raw.hint,
    status, level, satisfied, blocking: applies && raw.need !== 'optional' && !satisfied, doc, check, value, note: check?.note ?? null, why: satisfied ? null : why, carriedFrom,
  };
}

/** Best verified level per kind of document across the whole application, so a passport approved once is not asked for again at the next stage. */
function carryMap(wf: Workflow, st: AppState): Map<string, { level: number; docId: string | null; from: string }> {
  const m = new Map<string, { level: number; docId: string | null; from: string }>();
  const consider = (raw: { doc_type: string | null; kind: ReqKind }, ref: string, stageName: string) => {
    if (raw.kind !== 'document' || !raw.doc_type) return;
    const c = st.checks.find((x) => x.ref === ref);
    if (!c || LEVEL[c.state] < 4) return;
    const k = norm(raw.doc_type), cur = m.get(k);
    if (!cur || LEVEL[c.state] > cur.level) m.set(k, { level: LEVEL[c.state], docId: c.doc_id, from: stageName });
  };
  wf.stages.forEach((s) => s.reqs.forEach((r) => consider(r, refOf(r, false), s.name)));
  st.extras.forEach((e) => consider(e, refOf(e, true), wf.stages.find((s) => s.key === e.stage_key)?.name || e.stage_key));
  return m;
}

/** Every requirement of one stage for this applicant: the school's own, then the ones added for this applicant. */
export function stageReqs(wf: Workflow, stage: Stage, st: AppState): ReqEval[] {
  const carry = carryMap(wf, st);
  const std = [...stage.reqs].sort(byPos).map((r) => evalOne(r, false, stage, wf, st, carry));
  const ext = st.extras.filter((e) => e.stage_key === stage.key).map((e) => evalOne({ ...e, need: e.need, upload: true, student_visible: true, hint: null, condition_key: null, active: true }, true, stage, wf, st, carry));
  return [...std, ...ext].filter((r) => r.applies);
}

export const stageBlockers = (reqs: ReqEval[]) => reqs.filter((r) => r.blocking);
export const stageComplete = (reqs: ReqEval[]) => stageBlockers(reqs).length === 0;

// ---- moving ----
export type Actor = { role: Role };
export type MoveCheck = {
  ok: boolean;
  /** forward | backward | same */
  direction: 'forward' | 'backward' | 'same';
  /** The person may not enter this stage at all (not even with an override). */
  roleBlocked: boolean;
  /** Mandatory requirements still open on the route from here to the target. */
  blockers: ReqEval[];
  /** Applicable stages that would be jumped over. */
  skipped: Stage[];
  /** The target is a conditional stage that is not switched on yet: moving there switches it on. */
  enablesTarget: boolean;
  /** This person may override the blockers (with a written reason). */
  canOverride: boolean;
  /** Plain words for the person, empty when nothing is wrong. */
  messages: string[];
};

export function checkMove(wf: Workflow, st: AppState, toKey: string, actor: Actor): MoveCheck {
  const target = findStage(wf, toKey), cur = findStage(wf, st.stage_key);
  const empty: MoveCheck = { ok: false, direction: 'forward', roleBlocked: false, blockers: [], skipped: [], enablesTarget: false, canOverride: false, messages: [] };
  if (!target || !target.active) return { ...empty, messages: ['That stage does not exist in this school’s workflow.'] };
  if (cur && cur.id === target.id) return { ...empty, direction: 'same', messages: ['The application is already in that stage.'] };
  const roleBlocked = !target.move_roles.includes(actor.role);
  const canOverride = wf.override_roles.includes(actor.role) && !roleBlocked;
  const enablesTarget = target.conditional && st.flags[`stage:${target.key}`] !== true;
  const backward = !!cur && target.position < cur.position;
  const messages: string[] = [];
  if (roleBlocked) messages.push(`Your role is not allowed to move an application into “${target.name}”.`);
  if (backward) {
    return { ok: !roleBlocked, direction: 'backward', roleBlocked, blockers: [], skipped: [], enablesTarget, canOverride, messages };
  }
  // forward: everything on the way (the current stage and any applicable stage that would be jumped over) has to be in order
  const flagsWithTarget = enablesTarget ? { ...st.flags, [`stage:${target.key}`]: true } : st.flags;
  const route = applicableStages(wf, flagsWithTarget);
  const from = cur ? cur.position : -Infinity;
  const leaving = route.filter((s) => (cur ? s.position >= from : true) && s.position < target.position);
  const skipped = leaving.filter((s) => !cur || s.id !== cur.id);
  const blockers = leaving.flatMap((s) => stageBlockers(stageReqs(wf, s, { ...st, flags: flagsWithTarget })));
  if (blockers.length) messages.push(`${blockers.length} requirement${blockers.length === 1 ? ' is' : 's are'} not complete yet.`);
  return { ok: !roleBlocked && blockers.length === 0, direction: 'forward', roleBlocked, blockers, skipped, enablesTarget, canOverride, messages };
}

// ---- suggestions ----
export type Readiness = {
  current: Stage | null; next: Stage | null;
  reqs: ReqEval[]; blockers: ReqEval[]; complete: boolean;
  /** "Ready" when the stage's own work is done and the next stage can be entered. */
  ready: boolean;
  /** Upcoming conditional stages (before the next normal one) the person may switch on. */
  maybeStages: Stage[];
  delayed: number;
  progress: ReturnType<typeof progress>;
};

export function readiness(wf: Workflow, st: AppState, now = Date.now()): Readiness {
  const current = findStage(wf, st.stage_key), next = nextStage(wf, st.stage_key, st.flags);
  // a stage that was switched off (or is conditional and not used for this student) asks for nothing: the application just needs moving on
  const reqs = current && stageApplies(current, st.flags) ? stageReqs(wf, current, st) : [];
  const blockers = stageBlockers(reqs);
  const after = current ? current.position : -Infinity;
  // conditional stages that sit between here and the next stage on the route, plus the first one after it if nothing follows
  const maybeStages = wf.stages.filter((s) => s.active && s.conditional && st.flags[`stage:${s.key}`] !== true && s.position > after).sort(byPos).slice(0, 4);
  return { current, next, reqs, blockers, complete: blockers.length === 0, ready: !!next && blockers.length === 0, maybeStages, delayed: delayedDays(current, st.stage_at, now), progress: progress(wf, st.stage_key, st.flags) };
}

/** Where an application that has no stage yet probably belongs, from the status it already has. Null when the status is from before the workflow starts. */
export function suggestPlacement(wf: Workflow, status: string | null): Stage | null {
  if (!status) return null;
  const hit = wf.stages.filter((s) => s.active && !s.conditional && s.maps_status && s.maps_status.toLowerCase() === status.toLowerCase()).sort(byPos);
  return hit[0] ?? null;
}

/** What the student is asked for right now: the documents of their current stage that are not yet in. */
export function studentAsks(wf: Workflow, st: AppState): ReqEval[] {
  const cur = findStage(wf, st.stage_key);
  if (!cur || !stageApplies(cur, st.flags)) return [];
  return stageReqs(wf, cur, st).filter((r) => r.kind === 'document' && r.studentVisible && r.upload && r.need !== 'optional' && (r.status === 'missing' || r.status === 'rejected'));
}

/** A short slug for a stage or requirement key. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'item';
