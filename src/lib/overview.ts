import { admin } from './supabase';
import { AppRow, attentionReasons } from './attention';
import { effType, missingDocs } from './docs';
import { FINAL_STATUSES, REQUIRED_DOCS, STALE_DAYS } from './constants';
import { askAi, hashOf, numbersWithin } from './ai';

export type AppFull = AppRow & { created_at: string; dob: string | null; age: string | null };
export type SRow = { a: AppFull; have: Set<string>; docCount: number; judged: boolean; missing: string[]; reasons: string[] };

const COLS = 'application_id,name,email,phone,school,programme,country,counselor,status,submitted_at,created_at,last_activity_at,student_key,in_master,has_raw,progress,in_regent,payment,interview,opp_id,drive_folder_id,dob,age';
const DAY = 864e5;

/** One row per student (newest submission), with documents pooled across their submissions. */
export async function loadStudents(): Promise<{ rows: SRow[]; all: AppFull[] }> {
  const db = admin();
  const [{ data: apps }, { data: docs }] = await Promise.all([
    db.from('portal_applications').select(COLS).order('submitted_at', { ascending: false, nullsFirst: false }).limit(5000),
    db.from('portal_documents').select('application_id,doc_type,type_override').limit(50000),
  ]);
  const all = (apps || []) as AppFull[];
  const keyOf = new Map(all.map((a) => [a.application_id, a.student_key]));
  const types = new Map<string, Set<string>>(), counts = new Map<string, number>();
  (docs || []).forEach((d) => {
    const k = keyOf.get(d.application_id); if (!k) return;
    (types.get(k) || types.set(k, new Set()).get(k)!).add(effType(d));
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const seen = new Set<string>();
  const rows = all.filter((a) => (seen.has(a.student_key) ? false : (seen.add(a.student_key), true))).map((a) => {
    const have = types.get(a.student_key) || new Set<string>();
    const judged = a.has_raw || !!a.drive_folder_id;
    const missing = judged ? missingDocs(have) : [];
    const docCount = counts.get(a.student_key) || 0;
    return { a, have, docCount, judged, missing, reasons: attentionReasons(a, missing, docCount) };
  });
  return { rows, all };
}

// ---------- To-do list ----------
export type TaskDraft = { key: string; kind: string; application_id: string; title: string; detail: string; priority: number };
const isFinal = (s: string | null) => !!s && FINAL_STATUSES.includes(s);

export function desiredTasks(rows: SRow[], now = Date.now()): TaskDraft[] {
  const out: TaskDraft[] = [];
  for (const { a, docCount, judged, missing } of rows) {
    if (isFinal(a.status)) continue;
    const id = a.application_id, who = a.name;
    const sub = [a.school, a.programme].filter(Boolean).join(' · ');
    const add = (kind: string, title: string, detail: string, priority: number) => out.push({ key: `${kind}:${id}`, kind, application_id: id, title, detail, priority });
    const ageDays = (t: string | null) => (t ? Math.floor((now - new Date(t).getTime()) / DAY) : 0);

    if (a.has_raw && !a.status && now - new Date(a.created_at).getTime() < 7 * DAY) add('review_new', `Review new application: ${who}`, sub, 2);
    if (a.has_raw && docCount === 0 && a.submitted_at && now - new Date(a.submitted_at).getTime() > 30 * 60_000) add('no_documents', `No documents received: ${who}`, 'Possible upload problem — check the Drive folder.', 1);
    else if (judged && docCount > 0 && missing.length) add('missing_docs', `Request ${missing.join(', ')} from ${who}`, sub, 2);
    if (judged && docCount > 0 && !missing.length && (!a.status || ['New Lead', 'Submitted', 'Documents Requested'].includes(a.status))) add('ready_next', `Ready for next stage: ${who}`, 'All required documents are present.', 2);
    if (a.has_raw && !a.in_master) add('add_to_sheet1', `Add ${who} to Sheet1`, sub, 3);
    if (!a.counselor) add('no_counselor', `Assign a counselor to ${who}`, sub, 2);
    if (a.interview && /to be booked/i.test(a.interview)) add('interview_book', `Book interview for ${who}`, sub, 2);
    if (a.in_master && now - new Date(a.last_activity_at).getTime() > STALE_DAYS * DAY) add('stale', `Follow up with ${who}`, `No update for ${ageDays(a.last_activity_at)} days · ${a.status || 'no status'}`, 3);
    const gaps = [!a.programme || a.programme.toUpperCase() === 'N/A' ? 'programme' : '', !a.phone ? 'phone' : '', !a.email ? 'email' : ''].filter(Boolean);
    if (a.has_raw && gaps.length) add('incomplete_info', `Complete details for ${who}: ${gaps.join(', ')}`, sub, 3);
  }
  return out;
}

/** Makes the stored list match reality without re-creating or duplicating anything. */
export async function refreshTasks(rows?: SRow[]) {
  const db = admin();
  const list = rows || (await loadStudents()).rows;
  const drafts = desiredTasks(list);
  const { data: ex } = await db.from('portal_tasks').select('id,task_key,status,suppress_until,title,detail,priority');
  const have = new Map((ex || []).map((t) => [t.task_key, t]));
  const want = new Set(drafts.map((d) => d.key));
  const now = new Date(), iso = now.toISOString();
  const inserts: object[] = [];

  for (const d of drafts) {
    const t = have.get(d.key);
    if (!t) { inserts.push({ task_key: d.key, kind: d.kind, application_id: d.application_id, title: d.title, detail: d.detail, priority: d.priority }); continue; }
    const hidden = t.status === 'done' || t.status === 'dismissed' || t.status === 'snoozed';
    if (hidden && t.suppress_until && new Date(t.suppress_until) <= now) {
      await db.from('portal_tasks').update({ status: 'open', suppress_until: null, resolved_at: null, resolved_by: null, title: d.title, detail: d.detail, priority: d.priority, updated_at: iso }).eq('id', t.id);
    } else if (t.status === 'resolved') {
      await db.from('portal_tasks').update({ status: 'open', resolved_at: null, resolved_by: null, title: d.title, detail: d.detail, priority: d.priority, updated_at: iso }).eq('id', t.id);
    } else if (t.status === 'open' && (t.title !== d.title || t.detail !== d.detail || t.priority !== d.priority)) {
      await db.from('portal_tasks').update({ title: d.title, detail: d.detail, priority: d.priority, updated_at: iso }).eq('id', t.id);
    }
  }
  for (let i = 0; i < inserts.length; i += 100) await db.from('portal_tasks').insert(inserts.slice(i, i + 100));
  // Situation cleared on its own (document arrived, counselor assigned…): close the task as resolved by the system.
  const cleared = (ex || []).filter((t) => (t.status === 'open' || t.status === 'snoozed') && !want.has(t.task_key)).map((t) => t.id);
  if (cleared.length) await db.from('portal_tasks').update({ status: 'resolved', resolved_by: 'system', resolved_at: iso, updated_at: iso }).in('id', cleared);
}

// ---------- Facts (confirmed numbers) + AI overview ----------
export type Facts = Record<string, number>;

export async function computeFacts(rows: SRow[], all: AppFull[], lastSeen: string | null): Promise<Facts> {
  const db = admin();
  const now = Date.now();
  const since = lastSeen ? new Date(lastSeen).getTime() : now;
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  const [{ data: open }, { count: doneToday }] = await Promise.all([
    db.from('portal_tasks').select('priority').eq('status', 'open'),
    db.from('portal_tasks').select('id', { count: 'exact', head: true }).eq('status', 'done').gte('resolved_at', startOfDay.toISOString()),
  ]);
  const active = rows.filter((r) => !isFinal(r.a.status));
  return {
    students: rows.length,
    newApplicationsSinceLastVisit: all.filter((a) => a.has_raw && new Date(a.created_at).getTime() > since).length,
    submittedLast24Hours: all.filter((a) => a.has_raw && a.submitted_at && now - new Date(a.submitted_at).getTime() < DAY).length,
    needAttention: active.filter((r) => r.reasons.length).length,
    missingDocuments: active.filter((r) => r.judged && r.docCount > 0 && r.missing.length).length,
    noDocumentsReceived: active.filter((r) => r.a.has_raw && r.docCount === 0).length,
    notInSheet1: active.filter((r) => !r.a.in_master).length,
    noCounselor: active.filter((r) => !r.a.counselor).length,
    interviewsToBook: active.filter((r) => /to be booked/i.test(r.a.interview || '')).length,
    readyForNextStage: active.filter((r) => r.judged && r.docCount > 0 && !r.missing.length && (!r.a.status || ['New Lead', 'Submitted', 'Documents Requested'].includes(r.a.status))).length,
    openTasks: (open || []).length,
    highPriorityTasks: (open || []).filter((t) => t.priority === 1).length,
    tasksCompletedToday: doneToday || 0,
  };
}

export const FACT_LABELS: Record<string, string> = {
  students: 'Students in the portal', newApplicationsSinceLastVisit: 'New applications since your last visit', submittedLast24Hours: 'Applications submitted in the last 24 hours',
  needAttention: 'Students needing attention', missingDocuments: 'Students missing required documents', noDocumentsReceived: 'Applications with no documents received',
  notInSheet1: 'Students not yet in Sheet1', noCounselor: 'Students with no counselor', interviewsToBook: 'Interviews waiting to be booked',
  readyForNextStage: 'Applications with all documents, ready for next stage', openTasks: 'Open tasks', highPriorityTasks: 'High-priority tasks', tasksCompletedToday: 'Tasks completed today',
};

export async function aiOverview(facts: Facts, force = false) {
  const hash = hashOf(facts);
  return askAi<{ overview: string }>({
    kind: 'overview', cacheKey: 'overview', inputHash: hash, auto: true, force, maxTokens: 350,
    system:
      'You write a short status overview for an admissions admin. Use ONLY the numbers in the JSON the user sends. ' +
      'Never write a number that is not in the JSON. Do not name any person. Do not make or suggest admissions decisions. ' +
      'Write 2-4 plain sentences, most important first, skip zero values. Reply as JSON: {"overview": "<text>"}.',
    user: JSON.stringify(facts),
    validate: (raw) => {
      const t = (raw as { overview?: unknown })?.overview;
      if (typeof t !== 'string' || t.length < 10 || t.length > 700) return null;
      return numbersWithin(t, [...Object.values(facts), 24, 7]) ? { overview: t.trim() } : null;
    },
  });
}

// ---------- AI summary for one student ----------
export type StudentSummary = { observations: string[]; recommendedActions: string[]; uncertainty: string };

export function studentFacts(a: AppFull, p: { have: Set<string>; docCount: number; missing: string[]; judged: boolean; submissions: number }) {
  const gaps = [!a.programme || a.programme.toUpperCase() === 'N/A' ? 'programme' : '', !a.phone ? 'phone' : '', !a.email ? 'email' : '', !a.dob ? 'date of birth' : '', !a.counselor ? 'counselor' : ''].filter(Boolean);
  return {
    programme: a.programme || null, university: a.school || null, status: a.status || null, country: a.country || null,
    counselorAssigned: !!a.counselor, inSheet1: a.in_master, hasFormSubmission: a.has_raw, submissionsFromThisStudent: p.submissions,
    documentsChecked: p.judged, requiredDocuments: [...REQUIRED_DOCS], documentsPresent: [...p.have], documentsMissing: p.missing, filesInDrive: p.docCount,
    daysSinceSubmitted: a.submitted_at ? Math.floor((Date.now() - new Date(a.submitted_at).getTime()) / DAY) : null,
    paymentRecorded: !!a.payment, interviewStatus: a.interview || null, missingInformation: gaps, flags: attentionReasons(a, p.missing, p.docCount),
  };
}

export async function aiStudentSummary(applicationId: string, facts: ReturnType<typeof studentFacts>, force = false) {
  return askAi<StudentSummary>({
    kind: 'student', cacheKey: `student:${applicationId}`, inputHash: hashOf(facts), auto: false, force, maxTokens: 600,
    system:
      'You help an admissions admin review one application. You only see the JSON facts below (no name, no documents). ' +
      'Base every point strictly on those facts; if something is not in the facts, say it is unknown. Use cautious wording ("appears", "may"). ' +
      'NEVER recommend admitting, rejecting or scoring the student. Recommended actions are small admin steps (e.g. request a missing document). ' +
      'Reply as JSON: {"observations": [max 5 short strings], "recommendedActions": [max 4 short strings], "uncertainty": "what you cannot tell from these facts"}.',
    user: JSON.stringify(facts),
    validate: (raw) => {
      const r = raw as Partial<StudentSummary>;
      const clean = (x: unknown, n: number) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.length > 3 && s.length < 280).slice(0, n) : []);
      const obs = clean(r?.observations, 5), act = clean(r?.recommendedActions, 4);
      if (!obs.length) return null;
      if ([...obs, ...act].some((t) => /\b(admit|reject|decline|approve|deny)\b/i.test(t))) return null; // keep decisions with the admin
      return { observations: obs, recommendedActions: act, uncertainty: typeof r?.uncertainty === 'string' ? r.uncertainty.slice(0, 300) : '' };
    },
  });
}
