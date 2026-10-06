import { admin, sessionClient } from './supabase';
import { counselorKey, effType } from './docs';

export type StudentApp = {
  application_id: string; name: string; email: string | null; school: string | null; programme: string | null; status: string | null; progress: number | null;
  counselor: string | null; intake: string | null; deadline: string | null; drive_folder_id: string | null; student_key: string; in_regent: boolean; payment: string | null;
  submitted_at: string | null; last_activity_at: string;
};
export type StudentDoc = { id: string; application_id: string; name: string; type: string; added: string; size: number; mime: string };
export type StudentView = { email: string; name: string; apps: StudentApp[]; docs: StudentDoc[]; ids: string[] };

const COLS = 'application_id, name, email, school, programme, status, progress, counselor, intake, deadline, drive_folder_id, student_key, in_regent, payment, submitted_at, last_activity_at';
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Applications that belong to this email address (a student can have one per university). Test rows never count. */
export async function appsForEmail(email: string) {
  const e = email.trim().toLowerCase();
  if (!e || e === 'test@example.com') return [];
  const { data } = await admin().from('portal_applications').select(COLS).ilike('email', likeEscape(e)).order('submitted_at', { ascending: false, nullsFirst: false });
  return (data || []) as StudentApp[];
}

export async function isStudentEmail(email: string) { return (await appsForEmail(email)).length > 0; }

/** The signed-in student, or null. Staff are never students (staff access always wins). */
export async function currentStudent(): Promise<StudentView | null> {
  const { data } = await (await sessionClient()).auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const db = admin();
  const { data: st } = await db.from('portal_staff').select('email').eq('email', email).maybeSingle();
  if (st) return null;
  const apps = await appsForEmail(email);
  if (!apps.length) return null;
  const keys = [...new Set(apps.map((a) => a.student_key))];
  const { data: sibs } = await db.from('portal_applications').select('application_id, student_key').in('student_key', keys);
  const ids = (sibs || []).map((s) => s.application_id);
  const { data: rows } = ids.length ? await db.from('portal_documents').select('drive_file_id, application_id, name, doc_type, type_override, created_at, size_bytes, mime_type').in('application_id', ids).order('created_at', { ascending: false }) : { data: [] };
  const docs: StudentDoc[] = (rows || []).map((d) => ({ id: d.drive_file_id, application_id: d.application_id, name: d.name, type: effType(d), added: d.created_at, size: Number(d.size_bytes || 0), mime: d.mime_type || '' }));
  return { email, name: apps[0].name, apps, docs, ids };
}

/** Can this signed-in student open this application / file? */
export async function studentOwnsApp(s: StudentView, applicationId: string) { return s.ids.includes(applicationId); }

export const counselorKeyOf = counselorKey;
