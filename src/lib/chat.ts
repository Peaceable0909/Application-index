import { plainBody } from './stickers';
import { admin } from './supabase';
import { canAccessApp, canSee, Staff } from './auth';
import { REQUIRED_DOCS } from './constants';
import { effType } from './docs';

export const ATT_MAX = 4 * 1024 * 1024;
export const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
export const COLORS_OK = ['navy', 'ocean', 'forest', 'violet', 'rose', 'amber', 'slate'];

export type RoomRow = { id: string; kind: 'dm' | 'group'; name: string | null; color: string | null; members: string[]; role: string; muted: boolean; last_preview: string | null; last_sender: string | null; last_message_at: string; unread: number };
export type Ref = { t: 'student'; id: string } | { t: 'doc'; id: string; f: string };
export type Card =
  | { t: 'student'; id: string; name: string; school: string | null; programme: string | null; status: string | null; counselor: string | null; docs: { have: number; total: number; missing: string[] } | null; open: boolean }
  | { t: 'doc'; id: string; f: string; name: string; type: string; student: string; open: boolean };
export type ChatMsg = {
  id: string; room_id: string; sender: string; body: string; reply: { id: string; sender: string; text: string } | null; cards: Card[];
  att: { name: string; size: number; mime: string; url: string } | null; reactions: Record<string, string[]>; edited_at: string | null; deleted_at: string | null; created_at: string; updated_at: string;
};

export const dmKey = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');

export async function membership(roomId: string, email: string) {
  const { data } = await admin().from('portal_room_members').select('*').eq('room_id', roomId).eq('email', email).maybeSingle();
  return data;
}

/** The 1:1 room between two people (created on first use). */
export async function dmRoom(a: string, b: string): Promise<string> {
  const db = admin(), key = dmKey(a, b);
  const find = async () => (await db.from('portal_rooms').select('id').eq('dm_key', key).maybeSingle()).data?.id as string | undefined;
  let id = await find();
  if (!id) {
    const ins = await db.from('portal_rooms').insert({ kind: 'dm', dm_key: key, created_by: a.toLowerCase() }).select('id').single();
    id = ins.data?.id ?? (await find());
    if (id) await db.from('portal_room_members').upsert([{ room_id: id, email: a.toLowerCase() }, { room_id: id, email: b.toLowerCase() }], { onConflict: 'room_id,email', ignoreDuplicates: true });
  }
  return id!;
}

/** All my rooms with unread counts, newest activity first. */
export async function loadRooms(email: string): Promise<RoomRow[]> {
  const db = admin();
  const { data: mine } = await db.from('portal_room_members').select('room_id, role, last_read_at, muted').eq('email', email);
  if (!mine?.length) return [];
  const ids = mine.map((m) => m.room_id);
  const [{ data: rooms }, { data: members }, { data: recent }] = await Promise.all([
    db.from('portal_rooms').select('*').in('id', ids),
    db.from('portal_room_members').select('room_id, email').in('room_id', ids),
    db.from('portal_chat_msgs').select('room_id, created_at').in('room_id', ids).neq('sender', email).is('deleted_at', null).gt('created_at', mine.map((m) => m.last_read_at).sort()[0]).limit(2000),
  ]);
  const unread = new Map<string, number>();
  for (const m of recent || []) { const lr = mine.find((x) => x.room_id === m.room_id)?.last_read_at; if (lr && m.created_at > lr) unread.set(m.room_id, (unread.get(m.room_id) || 0) + 1); }
  return (rooms || []).map((r) => {
    const me = mine.find((m) => m.room_id === r.id)!;
    return { id: r.id, kind: r.kind, name: r.name, color: r.color, members: (members || []).filter((m) => m.room_id === r.id).map((m) => m.email), role: me.role, muted: me.muted, last_preview: r.last_preview, last_sender: r.last_sender, last_message_at: r.last_message_at, unread: unread.get(r.id) || 0 };
  }).sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}

export async function unreadTotal(email: string): Promise<number> {
  return (await loadRooms(email)).filter((r) => !r.muted).reduce((n, r) => n + r.unread, 0);
}

type Raw = { id: string; room_id: string; sender: string; body: string; reply_to: string | null; refs: Ref[] | null; att_path: string | null; att_name: string | null; att_size: number | null; att_mime: string | null; reactions: Record<string, string[]>; edited_at: string | null; deleted_at: string | null; created_at: string; updated_at: string; portal_applications?: { name: string } | null };
export const MSG_COLS = 'id, room_id, sender, body, reply_to, refs, att_path, att_name, att_size, att_mime, reactions, edited_at, deleted_at, created_at, updated_at';

/** Shapes rows for the browser: hides deleted content, resolves reply previews and shared student/document cards, points attachments at the gated file route. */
export async function shapeMessages(rows: Raw[], viewer: Staff): Promise<ChatMsg[]> {
  const db = admin();
  const rids = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))] as string[];
  const refs = rows.filter((r) => !r.deleted_at).flatMap((r) => r.refs || []);
  const appIds = [...new Set(refs.map((r) => r.id))];
  const [{ data: rep }, { data: apps }, { data: docs }] = await Promise.all([
    rids.length ? db.from('portal_chat_msgs').select('id, sender, body, deleted_at, att_name, refs').in('id', rids) : Promise.resolve({ data: [] as never[] }),
    appIds.length ? db.from('portal_applications').select('application_id, name, school, programme, status, counselor, has_raw, submitted_at, drive_folder_id').in('application_id', appIds) : Promise.resolve({ data: [] as never[] }),
    appIds.length ? db.from('portal_documents').select('drive_file_id, application_id, name, doc_type, type_override').in('application_id', appIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  const cardsFor = (rs: Ref[] | null): Card[] => (rs || []).flatMap((r): Card[] => {
    const a = (apps || []).find((x) => x.application_id === r.id); if (!a) return [];
    const open = canSee(viewer, a.counselor);
    if (r.t === 'doc') { const d = (docs || []).find((x) => x.drive_file_id === r.f && x.application_id === r.id); return d ? [{ t: 'doc', id: r.id, f: r.f, name: d.name, type: effType(d), student: a.name, open }] : []; }
    const mine = (docs || []).filter((x) => x.application_id === r.id).map(effType);
    const judged = (a.has_raw && a.submitted_at) || a.drive_folder_id;
    const missing = judged ? REQUIRED_DOCS.filter((t) => !mine.includes(t)) : [];
    return [{ t: 'student', id: r.id, name: a.name, school: a.school, programme: a.programme, status: a.status, counselor: a.counselor, docs: open && judged ? { have: REQUIRED_DOCS.length - missing.length, total: REQUIRED_DOCS.length, missing } : null, open }];
  });
  return rows.map((r) => {
    const gone = !!r.deleted_at, p = (rep || []).find((x) => x.id === r.reply_to);
    const pText = p ? (p.deleted_at ? 'Message deleted' : (p.body || (p.att_name ? `📎 ${p.att_name}` : (p.refs || []).length ? '👤 Shared student' : '')).slice(0, 120)) : '';
    return {
      id: r.id, room_id: r.room_id, sender: r.sender, body: gone ? '' : r.body,
      reply: p ? { id: p.id, sender: p.sender, text: pText } : null,
      cards: gone ? [] : cardsFor(r.refs),
      att: !gone && r.att_path ? { name: r.att_name || 'file', size: r.att_size || 0, mime: r.att_mime || '', url: `/api/chat/file/${r.id}` } : null,
      reactions: gone ? {} : r.reactions || {}, edited_at: r.edited_at, deleted_at: r.deleted_at, created_at: r.created_at, updated_at: r.updated_at,
    };
  });
}

/** Validates what the sender is sharing: only students they can open, only documents that belong to them. Also turns pasted portal student links into cards. */
export async function cleanRefs(me: Staff, raw: unknown, body: string, hosts: string[]): Promise<Ref[]> {
  const list: Ref[] = [];
  if (Array.isArray(raw)) for (const r of raw.slice(0, 8)) {
    if (r && typeof r === 'object' && typeof (r as Ref).id === 'string') {
      const x = r as Ref; list.push(x.t === 'doc' && typeof (x as { f?: unknown }).f === 'string' ? { t: 'doc', id: x.id, f: (x as { f: string }).f } : { t: 'student', id: x.id });
    }
  }
  for (const m of body.matchAll(/https?:\/\/([^\s/]+)\/applications\/([^\s/?#]+)/g)) if (hosts.includes(m[1])) { try { list.push({ t: 'student', id: decodeURIComponent(m[2]) }); } catch { /* ignore */ } }
  const out: Ref[] = [], seen = new Set<string>();
  for (const r of list) {
    const key = r.t === 'doc' ? `d:${r.f}` : `s:${r.id}`; if (seen.has(key)) continue; seen.add(key);
    if (!(await canAccessApp(me, r.id))) continue;
    if (r.t === 'doc') { const { data } = await admin().from('portal_documents').select('drive_file_id').eq('drive_file_id', r.f).eq('application_id', r.id).maybeSingle(); if (!data) continue; }
    out.push(r); if (out.length >= 5) break;
  }
  return out;
}

export async function canTag(me: Staff, applicationId: string | null | undefined) {
  return applicationId && (await canAccessApp(me, applicationId)) ? applicationId : null;
}

export const previewOf = (body: string, att?: string | null) => (body.trim() ? plainBody(body.trim()).replace(/\s+/g, ' ').slice(0, 80) : att ? `📎 ${att}` : '');
