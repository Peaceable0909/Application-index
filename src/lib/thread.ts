import { plainBody } from './stickers';
import { admin } from './supabase';
import { currentStaff, canAccessApp, type Staff } from './auth';
import { currentStudent } from './student';
import { addNotice } from './notices';
import { sendMail } from './mail';
import { studentSite } from './emailTemplate';
import { shownName } from './profile';
import { sendPush } from './push';
import { counselorKey } from './docs';
import { callScript, type DriveFile } from './appsScript';
import { ALL_DOC_TYPES } from './constants';
import { cleanLabel, resolveLabel } from './docLabel';

export type Role = 'student' | 'staff';
export type Actor = { role: Role; email: string; appId: string; studentEmail: string; staff?: Staff };
export type ThreadMsg = {
  id: string; mine: boolean; body: string; at: string; deleted: boolean; kind: 'text' | 'image' | 'voice' | 'file';
  att: { name: string; mime: string; size: number; url: string; ms: number | null } | null;
  reply: { id: string; who: 'me' | 'them'; preview: string } | null;
  reactions: Record<string, { n: number; me: boolean }>;
  read: boolean;
};

export const ATT_MAX = 4 * 1024 * 1024;
const OK_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/plain|audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)|video\/mp4)/i;
export const REACTIONS = ['👍', '❤️', '😂', '🙏', '✅', '😮'];
const COLS = 'id, student_email, application_id, from_student, sender_email, body, created_at, student_read_at, staff_read_at, att_path, att_name, att_mime, att_size, duration_ms, reply_to, reactions, deleted_at';
type Row = { id: string; student_email: string; application_id: string | null; from_student: boolean; sender_email: string; body: string; created_at: string; student_read_at: string | null; staff_read_at: string | null; att_path: string | null; att_name: string | null; att_mime: string | null; att_size: number | null; duration_ms: number | null; reply_to: string | null; reactions: Record<string, string[]> | null; deleted_at: string | null };

/** Works out who is calling and which student's thread they mean. Staff pass appId; students always get their own thread. */
export async function actor(appIdParam?: string | null): Promise<Actor | null> {
  const staff = await currentStaff();
  if (staff) {
    if (!appIdParam || !(await canAccessApp(staff, appIdParam))) return null;
    const { data } = await admin().from('portal_applications').select('email').eq('application_id', appIdParam).maybeSingle();
    if (!data?.email) return null;
    return { role: 'staff', email: staff.email, appId: appIdParam, studentEmail: data.email.toLowerCase(), staff };
  }
  const me = await currentStudent();
  if (!me) return null;
  const appId = appIdParam && me.ids.includes(appIdParam) ? appIdParam : me.ids[0];
  return { role: 'student', email: me.email, appId, studentEmail: me.email };
}

const preview = (r: Row) => (r.deleted_at ? 'Message deleted' : plainBody(r.body.trim()).slice(0, 80) || (r.att_mime?.startsWith('image/') ? (r.att_name?.startsWith('sticker_') ? '🙂 Sticker' : '📷 Photo') : r.att_mime?.startsWith('audio/') ? '🎤 Voice note' : `📎 ${r.att_name || 'File'}`));

export function shape(rows: Row[], a: Actor): ThreadMsg[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const meKey = a.role === 'student' ? 'student' : 'staff';
  return rows.map((r) => {
    const mine = a.role === 'student' ? r.from_student : !r.from_student;
    const del = !!r.deleted_at;
    const mime = r.att_mime || '';
    const q = r.reply_to ? byId.get(r.reply_to) : null;
    const rx: ThreadMsg['reactions'] = {};
    if (!del) for (const [e, who] of Object.entries(r.reactions || {})) if (who?.length) rx[e] = { n: who.length, me: who.includes(meKey) };
    return {
      id: r.id, mine, body: del ? '' : r.body, at: r.created_at, deleted: del,
      kind: del || !r.att_path ? 'text' : mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'voice' : 'file',
      att: !del && r.att_path ? { name: r.att_name || 'file', mime, size: r.att_size || 0, url: `/api/thread/file/${r.id}${a.role === 'staff' ? `?app=${encodeURIComponent(a.appId)}` : ''}`, ms: r.duration_ms } : null,
      reply: q ? { id: q.id, who: (a.role === 'student' ? q.from_student : !q.from_student) ? 'me' : 'them', preview: preview(q) } : null,
      reactions: rx,
      read: mine ? !!(a.role === 'student' ? r.staff_read_at : r.student_read_at) : true,
    };
  });
}

export async function loadThread(a: Actor, markRead: boolean): Promise<{ msgs: ThreadMsg[]; typing: boolean; other: { name: string; online: boolean; lastSeen: string | null } }> {
  const db = admin();
  if (markRead) {
    const col = a.role === 'student' ? 'student_read_at' : 'staff_read_at';
    await db.from('portal_student_msgs').update({ [col]: new Date().toISOString() }).eq('student_email', a.studentEmail).eq('from_student', a.role === 'staff').is(col, null);
  }
  const { data } = await db.from('portal_student_msgs').select(COLS).eq('student_email', a.studentEmail).order('created_at').limit(400);
  const msgs = shape((data || []) as Row[], a);
  let name = 'Your counselor', lastSeen: string | null = null;
  if (a.role === 'student') {
    const { data: app } = await db.from('portal_applications').select('counselor').eq('application_id', a.appId).maybeSingle();
    const last = [...((data || []) as Row[])].reverse().find((r) => !r.from_student);
    const email = last?.sender_email;
    const { data: st } = email ? await db.from('portal_staff').select('display_name, last_seen_at').eq('email', email).maybeSingle() : { data: null };
    name = st?.display_name || app?.counselor || name; lastSeen = st?.last_seen_at || null;
  } else {
    const { data: s } = await db.from('portal_student_seen').select('last_active_at').eq('email', a.studentEmail).maybeSingle();
    name = 'Student'; lastSeen = s?.last_active_at || null;
  }
  const { data: ty } = await db.from('portal_thread_typing').select('student_typing_at, staff_typing_at').eq('student_email', a.studentEmail).maybeSingle();
  const theirs = a.role === 'student' ? ty?.staff_typing_at : ty?.student_typing_at;
  const typing = !!theirs && Date.now() - new Date(theirs).getTime() < 6000;
  return { msgs, typing, other: { name, lastSeen, online: !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 90_000 } };
}

export async function postMessage(a: Actor, o: { body: string; replyTo?: string | null; file?: File | null; durationMs?: number | null }): Promise<{ ok: boolean; error?: string; id?: string }> {
  const db = admin();
  const body = o.body.trim().slice(0, 2000), file = o.file && o.file.size > 0 ? o.file : null;
  if (!body && !file) return { ok: false, error: 'Write a message or attach something.' };
  if (file) {
    if (file.size > ATT_MAX) return { ok: false, error: 'That file is over 4 MB. Send a smaller one.' };
    if (!OK_MIME.test(file.type || '')) return { ok: false, error: 'That file type can’t be sent here. Use a photo, PDF, Word or voice note.' };
  }
  if (a.role === 'student') {
    const { count } = await db.from('portal_student_msgs').select('id', { count: 'exact', head: true }).eq('student_email', a.studentEmail).eq('from_student', true).gte('created_at', new Date(Date.now() - 864e5).toISOString());
    if ((count || 0) >= 80) return { ok: false, error: 'That’s a lot of messages for one day. Your counselor will reply soon.' };
  }
  let att: Record<string, unknown> = {};
  if (file) {
    const safe = (file.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(-80);
    const path = `thread/${a.studentEmail.replace(/[^a-z0-9]+/g, '_')}/${crypto.randomUUID()}-${safe}`;
    const up = await db.storage.from('chat-files').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
    if (up.error) return { ok: false, error: 'Upload failed. Please try again.' };
    att = { att_path: path, att_name: (file.name || 'file').slice(0, 120), att_mime: file.type, att_size: file.size, duration_ms: o.durationMs && file.type.startsWith('audio/') ? Math.min(o.durationMs, 600_000) : null };
  }
  let reply_to: string | null = null;
  if (o.replyTo) { const { data: r } = await db.from('portal_student_msgs').select('id').eq('id', o.replyTo).eq('student_email', a.studentEmail).maybeSingle(); reply_to = r?.id || null; }
  const now = new Date().toISOString();
  const { data: prev } = await db.from('portal_student_msgs').select('created_at').eq('student_email', a.studentEmail).eq('from_student', a.role === 'student').order('created_at', { ascending: false }).limit(1);
  const { data, error } = await db.from('portal_student_msgs').insert({ student_email: a.studentEmail, application_id: a.appId, from_student: a.role === 'student', sender_email: a.email, body, reply_to, ...att, ...(a.role === 'student' ? { student_read_at: now } : { staff_read_at: now }) }).select('id').single();
  if (error || !data) return { ok: false, error: 'Could not send. Please try again.' };
  const quiet = !prev?.[0] || Date.now() - new Date(prev[0].created_at).getTime() > 3 * 3600_000;
  const text = plainBody(body) || (file?.type.startsWith('image/') ? (file.name.startsWith('sticker_') ? '🙂 Sticker' : '📷 Photo') : file?.type.startsWith('audio/') ? '🎤 Voice note' : `📎 ${file?.name || 'File'}`);
  if (a.role === 'student') {
    // phone alert for the counselor (or the admins when nobody is assigned)
    try {
      const { data: ap } = await db.from('portal_applications').select('name, counselor').eq('application_id', a.appId).maybeSingle();
      const { data: c } = ap?.counselor ? await db.from('portal_counselors').select('email').eq('name_key', counselorKey(ap.counselor)).maybeSingle() : { data: null };
      let to = c?.email ? [c.email] : [];
      if (!to.length) { const { data: ad } = await db.from('portal_staff').select('email').eq('role', 'admin'); to = (ad || []).map((x) => x.email); }
      await sendPush({ emails: to, title: `${(ap?.name || 'A student').split(/[\s,]+/).filter(Boolean)[0]} sent a message`, body: text, url: `/applications/${encodeURIComponent(a.appId)}?tab=messages`, tag: `chat-${a.studentEmail}`, skipIfActiveMs: 30_000, calmMs: 6 * 3600_000 });
    } catch { /* alerts are best effort */ }
    if (quiet) { try { const { studentMessage } = await import('@/app/actions'); const fd = new FormData(); fd.set('appId', a.appId); fd.set('body', text); await studentMessage(fd); } catch { /* saved either way */ } }
  } else {
    const st = a.staff!;
    try { await addNotice({ email: a.studentEmail, applicationId: a.appId, kind: 'message', title: 'New message from your counselor', body: text.slice(0, 140), href: '/student/messages', by: a.email }); } catch { /* optional */ }
    const { data: seen } = await db.from('portal_student_seen').select('last_active_at').eq('email', a.studentEmail).maybeSingle();
    const away = !seen || Date.now() - new Date(seen.last_active_at).getTime() > 5 * 60_000;
    if (away && quiet) {
      const { data: app } = await db.from('portal_applications').select('name').eq('application_id', a.appId).maybeSingle();
      const first = (app?.name || '').split(/[\s,]+/).filter(Boolean)[0] || 'there', who = shownName(st) || 'Your counselor';
      try { await sendMail({ to: a.studentEmail, subject: 'New message from your counselor', body: `${who} wrote:\n\n${text}`, eyebrow: 'Message', title: 'You have a new message', greeting: `Hi ${first},`, preheader: text.slice(0, 100), sign: { name: who, title: 'Admissions Counselor', email: st.email }, blocks: [{ type: 'quote', from: who, text: text.slice(0, 600) }], cta: { label: 'Open your messages', href: `${studentSite()}/student/messages` } }); } catch { /* chat still has it */ }
    }
  }
  return { ok: true, id: data.id };
}

export async function react(a: Actor, id: string, emoji: string): Promise<boolean> {
  if (!REACTIONS.includes(emoji)) return false;
  const db = admin();
  const { data: r } = await db.from('portal_student_msgs').select('reactions, deleted_at').eq('id', id).eq('student_email', a.studentEmail).maybeSingle();
  if (!r || r.deleted_at) return false;
  const key = a.role, cur = (r.reactions || {}) as Record<string, string[]>, next: Record<string, string[]> = {};
  for (const [e, who] of Object.entries(cur)) { const w = who.filter((x) => x !== key); if (w.length) next[e] = w; }
  if (!(cur[emoji] || []).includes(key)) next[emoji] = [...(next[emoji] || []), key];
  await db.from('portal_student_msgs').update({ reactions: next }).eq('id', id);
  return true;
}

export async function unsend(a: Actor, id: string): Promise<boolean> {
  const db = admin();
  const { data: r } = await db.from('portal_student_msgs').select('att_path, from_student').eq('id', id).eq('student_email', a.studentEmail).maybeSingle();
  if (!r || r.from_student !== (a.role === 'student')) return false;
  if (r.att_path) await db.storage.from('chat-files').remove([r.att_path]);
  await db.from('portal_student_msgs').update({ deleted_at: new Date().toISOString(), body: '', att_path: null }).eq('id', id);
  return true;
}

/** Called while someone is typing; the other side sees "typing…" for the next few seconds. */
export async function setTyping(a: Actor): Promise<void> {
  const col = a.role === 'student' ? 'student_typing_at' : 'staff_typing_at';
  await admin().from('portal_thread_typing').upsert({ student_email: a.studentEmail, [col]: new Date().toISOString() });
}

/** Staff: file a chat attachment straight into the student's Drive folder and documents list. */
export async function saveToDocuments(a: Actor, id: string, docType: string, docLabel: string): Promise<{ ok: boolean; error?: string }> {
  if (a.role !== 'staff') return { ok: false, error: 'Only staff can file documents.' };
  if (!(ALL_DOC_TYPES as readonly string[]).includes(docType)) return { ok: false, error: 'Choose what kind of document this is.' };
  const db = admin();
  const { data: m } = await db.from('portal_student_msgs').select('att_path, att_name, att_mime, deleted_at').eq('id', id).eq('student_email', a.studentEmail).maybeSingle();
  if (!m?.att_path || m.deleted_at) return { ok: false, error: 'That attachment is no longer available.' };
  if (!/\.(pdf|jpe?g|png|webp|docx?)$/i.test(m.att_name || '')) return { ok: false, error: 'Only PDFs, photos and Word files can be filed as documents.' };
  let label: ReturnType<typeof resolveLabel> | null = null;
  if (docType === 'Other') { const l = cleanLabel(docLabel); if (!l) return { ok: false, error: 'Name the kind of document, for example “Bank statement”.' }; label = resolveLabel(l); }
  const { data: app } = await db.from('portal_applications').select('name, drive_folder_id, student_key').eq('application_id', a.appId).single();
  let folder = app?.drive_folder_id || null;
  if (!folder && app) { const { data: sib } = await db.from('portal_applications').select('drive_folder_id').eq('student_key', app.student_key).not('drive_folder_id', 'is', null).limit(1); folder = sib?.[0]?.drive_folder_id || null; }
  if (!folder || !app) return { ok: false, error: 'This student has no Drive folder linked yet. Link one on the Documents tab first.' };
  const file = await db.storage.from('chat-files').download(m.att_path);
  if (file.error || !file.data) return { ok: false, error: 'Could not read the attachment.' };
  const buf = Buffer.from(await file.data.arrayBuffer());
  const ext = ((m.att_name || '').match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase();
  const name = `${app.name} - ${label ? label.override || label.docType : docType}${ext}`;
  try {
    const up = await callScript<DriveFile>('uploadFile', { applicationId: a.appId, folderId: folder, name, mimeType: m.att_mime || 'application/octet-stream', base64: buf.toString('base64') });
    await db.from('portal_documents').upsert({ drive_file_id: up.id, application_id: a.appId, name: up.name, doc_type: label ? label.docType : docType, type_override: label?.override ?? null, mime_type: up.mimeType, size_bytes: up.size, drive_url: up.url, source: 'portal', uploaded_by: a.email });
    await db.from('portal_activity').insert({ application_id: a.appId, actor: a.email, kind: 'doc_uploaded', detail: { name: up.name, by: 'chat' } });
  } catch (e) { return { ok: false, error: `Could not save it. (${(e as Error).message.slice(0, 100)})` }; }
  return { ok: true };
}
