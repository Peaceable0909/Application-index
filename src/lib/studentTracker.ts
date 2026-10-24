// The pure part of the student's stage tracker: given a school's workflow and one application's state, what the student sees.
// No database and no framework, so it can be tested on its own and previewed in the browser.
import { schoolShort } from './docs';
import { applicableStages, findStage, nextStage, stageReqs, type AppState, type Stage, type Workflow } from './stageEngine';

export type TrackStage = { key: string; name: string; state: 'done' | 'current' | 'next' | 'later' };
export type TrackAsk = { label: string; state: 'needed' | 'checking' | 'done' | 'again'; optional: boolean };
export type Tracker = {
  appId: string; school: string; programme: string | null;
  started: boolean; stages: TrackStage[]; index: number; total: number; percent: number;
  current: string | null; note: string | null; since: string | null; next: string | null; asks: TrackAsk[];
};

const askState = (status: string, satisfied: boolean): TrackAsk['state'] => (satisfied ? 'done' : status === 'rejected' ? 'again' : ['uploaded', 'received', 'reviewed'].includes(status) ? 'checking' : 'needed');

/** The tracker for one application: pure, so the same rules can be tested and previewed without a database. */
export function buildTracker(a: { application_id: string; school: string | null; programme: string | null }, wf: Workflow, st: AppState): Tracker {
  const cur = findStage(wf, st.stage_key);
  const route: Stage[] = applicableStages(wf, st.flags);
  if (cur && !route.some((s) => s.id === cur.id)) route.push(cur), route.sort((x, y) => x.position - y.position);
  const nxt = cur ? nextStage(wf, cur.key, st.flags) : route[0] ?? null;
  const stages: TrackStage[] = route.map((s) => ({
    key: s.key, name: s.name,
    state: !cur ? (nxt && s.id === nxt.id ? 'next' : 'later') : s.id === cur.id ? 'current' : s.position < cur.position ? 'done' : nxt && s.id === nxt.id ? 'next' : 'later',
  }));
  const idx = cur ? stages.findIndex((s) => s.state === 'current') + 1 : 0;
  const asks: TrackAsk[] = cur
    ? stageReqs(wf, cur, st).filter((r) => r.kind === 'document' && r.studentVisible && r.upload).map((r) => ({ label: r.label, state: askState(r.status, r.satisfied), optional: r.need === 'optional' }))
    : [];
  return {
    appId: a.application_id, school: schoolShort(a.school) || wf.school_name, programme: a.programme && a.programme.toUpperCase() !== 'N/A' ? a.programme : null,
    started: !!cur, stages, index: idx, total: stages.length, percent: stages.length && cur ? Math.round((idx / stages.length) * 100) : 0,
    current: cur?.name ?? null, note: cur?.student_note ?? null, since: cur ? st.stage_at : null, next: nxt?.name ?? null, asks,
  };
}

