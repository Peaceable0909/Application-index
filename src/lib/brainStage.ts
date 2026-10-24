// What the AI Brain is told about a student's place in their school's stage workflow.
// Built from the same student-safe tracker the student's own dashboard shows (studentTracker.ts), so the assistant knows exactly what the
// student can see and never anything staff-only: no staff hints, review comments, override reasons or confirmations.
// Pure (types only), so it can be tested on its own.
import type { Tracker } from './studentTracker';

export type StageFacts = {
  /** The school's workflow this application follows. */
  school: string;
  started: boolean;
  currentStage: string | null;
  /** The stage in plain words, as the student reads it on their dashboard. */
  whatThisStageMeans: string | null;
  stageNumber: number | null;
  ofStages: number;
  nextStage: string | null;
  daysAtThisStage: number | null;
  allStagesInOrder: string[];
  /** The documents this stage asks the student for, and where each one stands. */
  documentsAskedAtThisStage: { document: string; optional: boolean; state: string }[];
  /** Whether a team member has emailed the student about this stage (the dashboard shows it either way). */
  studentEmailedAboutThisStage: boolean;
};

const STATE_WORDS: Record<string, string> = { needed: 'still needed', checking: 'received, being checked', done: 'done', again: 'a new copy is needed' };

export function stageFacts(t: Tracker, o: { emailed: boolean; schoolName?: string; now?: number }): StageFacts {
  const now = o.now ?? Date.now();
  const days = t.since ? Math.max(0, Math.floor((now - new Date(t.since).getTime()) / 864e5)) : null;
  return {
    school: o.schoolName || t.school,
    started: t.started,
    currentStage: t.current,
    whatThisStageMeans: t.note,
    stageNumber: t.started ? t.index : null,
    ofStages: t.total,
    nextStage: t.next,
    daysAtThisStage: t.started ? days : null,
    allStagesInOrder: t.stages.map((s) => s.name),
    documentsAskedAtThisStage: t.asks.map((a) => ({ document: a.label, optional: a.optional, state: STATE_WORDS[a.state] || a.state })),
    studentEmailedAboutThisStage: o.emailed,
  };
}
