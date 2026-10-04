import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { EMOJI, membership, MSG_COLS, previewOf, shapeMessages } from '@/lib/chat';

type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
async function load(id: string) {
  const me = await currentStaff(); if (!me) return { err: bad('unauthorized', 401) } as const;
  const { data: m } = await admin().from('portal_chat_msgs').select('*').eq('id', id).maybeSingle();
  if (!m || !(await membership(m.room_id, me.email))) return { err: bad('Not found', 404) } as const;
  return { me, m } as const;
}
const out = async (id: string, me: Parameters<typeof shapeMessages>[1]) => { const { data } = await admin().from('portal_chat_msgs').select(MSG_COLS).eq('id', id).single(); return NextResponse.json({ message: (await shapeMessages([data as never], me))[0] }); };

// Edit your own message.
export async function PATCH(req: Request, { params }: Ctx) {
  const r = await load((await params).id); if ('err' in r) return r.err;
  if (r.m.sender !== r.me.email) return bad('You can only edit your own messages.', 403);
  if (r.m.deleted_at) return bad('That message was deleted.');
  const body = (((await req.json().catch(() => ({}))) as { body?: string }).body || '').trim().slice(0, 2000);
  if (!body && !r.m.att_path && !(r.m.refs || []).length) return bad('A message can’t be empty — delete it instead.');
  const now = new Date().toISOString();
  await admin().from('portal_chat_msgs').update({ body, edited_at: now, updated_at: now }).eq('id', r.m.id);
  const { data: room } = await admin().from('portal_rooms').select('last_sender, last_message_at').eq('id', r.m.room_id).single();
  if (room?.last_message_at === r.m.created_at) await admin().from('portal_rooms').update({ last_preview: previewOf(body, r.m.att_name) }).eq('id', r.m.room_id);
  return out(r.m.id, r.me);
}

// Delete your own message (it stays as "This message was deleted"; any attachment is removed).
export async function DELETE(_: Request, { params }: Ctx) {
  const r = await load((await params).id); if ('err' in r) return r.err;
  if (r.m.sender !== r.me.email) return bad('You can only delete your own messages.', 403);
  const db = admin(), now = new Date().toISOString();
  if (r.m.att_path) await db.storage.from('chat-files').remove([r.m.att_path]);
  await db.from('portal_chat_msgs').update({ deleted_at: now, updated_at: now, body: '', att_path: null, reactions: {} }).eq('id', r.m.id);
  const { data: room } = await db.from('portal_rooms').select('last_message_at').eq('id', r.m.room_id).single();
  if (room?.last_message_at === r.m.created_at) await db.from('portal_rooms').update({ last_preview: 'Message deleted' }).eq('id', r.m.room_id);
  return out(r.m.id, r.me);
}

// Toggle an emoji reaction.
export async function POST(req: Request, { params }: Ctx) {
  const r = await load((await params).id); if ('err' in r) return r.err;
  const emoji = ((await req.json().catch(() => ({}))) as { emoji?: string }).emoji || '';
  if (!EMOJI.includes(emoji)) return bad('Unknown reaction.');
  if (r.m.deleted_at) return bad('That message was deleted.');
  const rx: Record<string, string[]> = { ...(r.m.reactions || {}) };
  const has = (rx[emoji] || []).includes(r.me.email);
  rx[emoji] = has ? (rx[emoji] || []).filter((e) => e !== r.me.email) : [...(rx[emoji] || []), r.me.email];
  if (!rx[emoji].length) delete rx[emoji];
  await admin().from('portal_chat_msgs').update({ reactions: rx, updated_at: new Date().toISOString() }).eq('id', r.m.id);
  return out(r.m.id, r.me);
}
