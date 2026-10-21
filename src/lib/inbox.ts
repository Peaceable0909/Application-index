import { admin } from './supabase';
import { currentWorkspace } from './workspace';
import { appIdsFor } from './auth';
import type { Staff } from './auth';
import { isStickerFile, plainBody } from './stickers';
import { plainPreview } from './sysText';
import { studentPhotos } from './studentPhotos';

/** Application ids this staff member may see student chats for; null means all of them. */
export async function inboxScope(staff: Pick<Staff, 'role' | 'counselor_key'>): Promise<string[] | null> {
  return staff.role === 'counselor' ? await appIdsFor(staff.counselor_key) : null;
}

export async function inboxUnread(staff: Pick<Staff, 'role' | 'counselor_key'>): Promise<number> {
  const scope = await inboxScope(staff);
  if (scope && !scope.length) return 0;
  let q = admin().from('portal_student_msgs').select('id, portal_applications!inner(workspace)', { count: 'exact', head: true }).eq('portal_applications.workspace', await currentWorkspace()).eq('from_student', true).is('staff_read_at', null);
  if (scope) q = q.in('application_id', scope);
  return (await q).count || 0;
}

export type Convo = { appId: string; email: string; name: string; school: string | null; photo: string | null; at: string; preview: string; mine: boolean; read: boolean; unread: number };

type MsgRow = { student_email: string; application_id: string; from_student: boolean; body: string | null; created_at: string; staff_read_at: string | null; student_read_at: string | null; att_mime: string | null; att_name: string | null; deleted_at: string | null };
const previewOf = (m: MsgRow) => (m.deleted_at ? 'Message deleted' : plainPreview(plainBody((m.body || '').trim())).slice(0, 90) || (m.att_mime?.startsWith('image/') ? (isStickerFile(m.att_name, m.att_mime) ? 'Sticker' : 'Photo') : m.att_mime?.startsWith('audio/') ? 'Voice note' : (m.att_name || 'File')));

/** The student conversations this staff member may see, newest first. `q` matches a student's name or anything said in the chat. */
export async function inboxList(staff: Pick<Staff, 'role' | 'counselor_key'>, o: { q?: string; unread?: boolean } = {}): Promise<Convo[]> {
  const db = admin(), scope = await inboxScope(staff), ws = await currentWorkspace();
  if (scope && !scope.length) return [];
  let q = db.from('portal_student_msgs').select('student_email, application_id, from_student, body, created_at, staff_read_at, student_read_at, att_mime, att_name, deleted_at, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).order('created_at', { ascending: false }).limit(2500);
  if (scope) q = q.in('application_id', scope);
  const rows = ((await q).data || []) as MsgRow[];
  const threads = new Map<string, { last: MsgRow; unread: number }>();
  for (const m of rows) {
    const t = threads.get(m.student_email) || { last: m, unread: 0 };
    if (m.from_student && !m.staff_read_at && !m.deleted_at) t.unread++;
    threads.set(m.student_email, t);
  }
  const ids = [...new Set([...threads.values()].map((t) => t.last.application_id))];
  const { data: apps } = ids.length ? await db.from('portal_applications').select('application_id, name, school, email').in('application_id', ids) : { data: [] };
  const byApp = new Map((apps || []).map((a) => [a.application_id as string, a]));
  const term = (o.q || '').trim().replace(/[%_,()]/g, ' ').slice(0, 60).toLowerCase();
  const said = new Set<string>();
  if (term.length >= 2) {
    let sq = db.from('portal_student_msgs').select('student_email, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).or(`body.ilike.%${term}%,att_name.ilike.%${term}%,transcript.ilike.%${term}%`).is('deleted_at', null).limit(400);
    if (scope) sq = sq.in('application_id', scope);
    for (const m of (await sq).data || []) said.add(m.student_email as string);
  }
  const photos = await studentPhotos([...threads.keys()]);
  const out: Convo[] = [];
  for (const [email, t] of threads) {
    const a = byApp.get(t.last.application_id);
    if (!a) continue;
    if (o.unread && !t.unread) continue;
    if (term.length >= 2 && !said.has(email) && !(a.name as string).toLowerCase().includes(term)) continue;
    out.push({ appId: t.last.application_id, email, name: a.name as string, school: (a.school as string) || null, photo: photos[email] || null, at: t.last.created_at, preview: previewOf(t.last), mine: !t.last.from_student, read: !!t.last.student_read_at, unread: t.unread });
  }
  return out.sort((x, y) => y.at.localeCompare(x.at));
}
