// What a student is asked for by the stage their application is in. Only documents marked visible to students, only the ones still missing or sent back.
import { admin } from './supabase';
import { loadContext } from './stageCore';
import { findStage, studentAsks } from './stageEngine';

export type StudentAsk = { docType: string; label: string; hint: string | null; again: boolean };
export type StudentStageAsks = { appId: string; stage: string; asks: StudentAsk[] };

/** Tries the given applications in order (the one with the Drive folder first) and answers for the first that has a stage workflow and a stage. */
export async function studentStageAsks(appIds: string[]): Promise<StudentStageAsks | null> {
  const db = admin();
  for (const appId of [...new Set(appIds)]) {
    const c = await loadContext(db, appId);
    if ('error' in c) continue;
    const cur = findStage(c.wf, c.st.stage_key);
    if (!cur) continue;
    const asks = studentAsks(c.wf, c.st).filter((r) => r.docType);
    return { appId, stage: cur.name, asks: asks.map((r) => ({ docType: r.docType!, label: r.label, hint: r.hint, again: r.status === 'rejected' })) };
  }
  return null;
}
