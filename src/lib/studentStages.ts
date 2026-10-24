// The student's own view of their application stages: the route for their school, where they are, and what is asked of them now.
// Only what a student should see: no staff notes, no review comments, no override details, no confirmations that are staff business.
// It only ever reads the applications of the signed-in student (`me.apps`, found from their sign-in email), never an id from the request.
import { admin } from './supabase';
import { schoolKey } from './docs';
import { loadContext } from './stageCore';
import { buildTracker, type Tracker } from './studentTracker';
import type { StudentView } from './student';

export type { Tracker, TrackStage, TrackAsk } from './studentTracker';

/** One tracker per school the student has applied to (the newest application for each), for schools that have a stage workflow. */
export async function studentTrackers(me: StudentView): Promise<Tracker[]> {
  const db = admin(), seen = new Set<string>(), out: Tracker[] = [];
  for (const a of me.apps) {
    const k = schoolKey(a.school);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const c = await loadContext(db, a.application_id);
    if ('error' in c) continue;
    out.push(buildTracker(a, c.wf, c.st));
  }
  return out;
}
