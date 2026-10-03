import { admin } from './supabase';
import { canAccessApp, Staff } from './auth';

export const ATT_MAX = 4 * 1024 * 1024;
export const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
export const COLORS_OK = ['navy', 'ocean', 'forest', 'violet', 'rose', 'amber', 'slate'];

export type RoomRow = { id: string; kind: 'dm' | 'group'; name: string | null; color: string | null; members: string[]; role: string; muted: boolean; last_preview: string | null; last_sender: string | null; last_message_at: string; unread: number };
export type ChatMsg = {
  id: string; room_id: string; sender: string; body: string; reply: { id: string; sender: string; text: string } | null; application_id: string | null; student: string | null;
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

type Raw = { id: string; room_id: string; sender: string; body: string; reply_to: string | null; application_id: string | null; att_path: string | null; att_name: string | null; att_size: number | null; att_mime: string | null; reactions: Record<string, string[]>; edited_at: string | null; deleted_at: string | null; created_at: string; updated_at: string; portal_applications?: { name: string } | null };
export const MSG_COLS = 'id, room_id, sender, body, reply_to, application_id, att_path, att_name, att_size, att_mime, reactions, edited_at, deleted_at, created_at, updated_at, portal_applications(name)';

/** Shapes rows for the browser: hides deleted content, resolves reply previews, points attachments at the gated file route. */
export async function shapeMessages(rows: Raw[]): Promise<ChatMsg[]> {
  const rids = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))] as string[];
  const { data: rep } = rids.length ? await admin().from('portal_chat_msgs').select('id, sender, body, deleted_at, att_name').in('id', rids) : { data: [] };
  return rows.map((r) => {
    const gone = !!r.deleted_at, p = (rep || []).find((x) => x.id === r.reply_to);
    return {
      id: r.id, room_id: r.room_id, sender: r.sender, body: gone ? '' : r.body,
      reply: p ? { id: p.id, sender: p.sender, text: p.deleted_at ? 'Message deleted' : (p.body || (p.att_name ? `📎 ${p.att_name}` : '')).slice(0, 120) } : null,
      application_id: gone ? null : r.application_id, student: gone ? null : r.portal_applications?.name ?? null,
      att: !gone && r.att_path ? { name: r.att_name || 'file', size: r.att_size || 0, mime: r.att_mime || '', url: `/api/chat/file/${r.id}` } : null,
      reactions: gone ? {} : r.reactions || {}, edited_at: r.edited_at, deleted_at: r.deleted_at, created_at: r.created_at, updated_at: r.updated_at,
    };
  });
}

export async function canTag(me: Staff, applicationId: string | null | undefined) {
  return applicationId && (await canAccessApp(me, applicationId)) ? applicationId : null;
}

export const previewOf = (body: string, att?: string | null) => (body.trim() ? body.trim().replace(/\s+/g, ' ').slice(0, 80) : att ? `📎 ${att}` : '');
