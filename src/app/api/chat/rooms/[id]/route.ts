import { NextResponse, after } from 'next/server';
import { notifyChat } from '@/lib/notify';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { ATT_MAX, cleanRefs, COLORS_OK, membership, MSG_COLS, previewOf, shapeMessages } from '@/lib/chat';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

// Messages (new/edited since `since`, or older than `before`), members, who's typing, who's online. Marks the room read.
export async function GET(req: Request, { params }: Ctx) {
  const me = await currentStaff(); if (!me) return bad('unauthorized', 401);
  const { id } = await params, mem = await membership(id, me.email);
  if (!mem) return bad('Not found', 404);
  const url = new URL(req.url), since = url.searchParams.get('since'), before = url.searchParams.get('before');
  const db = admin();
  let q = db.from('portal_chat_msgs').select(MSG_COLS).eq('room_id', id);
  if (since) q = q.gt('updated_at', since).order('updated_at', { ascending: true }).limit(200);
  else if (before) q = q.lt('created_at', before).order('created_at', { ascending: false }).limit(40);
  else q = q.order('created_at', { ascending: false }).limit(60);
  const { data } = await q;
  const rows = (data || []) as never[];
  const messages = (await shapeMessages(rows, me)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const now = new Date().toISOString();
  await Promise.all([
    db.from('portal_room_members').update({ last_read_at: now }).eq('room_id', id).eq('email', me.email),
    db.from('portal_staff').update({ last_active_at: now }).eq('email', me.email),
  ]);
  const [{ data: members }, { data: act }] = await Promise.all([
    db.from('portal_room_members').select('email, role, last_read_at, typing_at, muted').eq('room_id', id),
    db.from('portal_staff').select('email, last_active_at'),
  ]);
  const fresh = (t?: string | null, s = 90) => !!t && Date.now() - new Date(t).getTime() < s * 1000;
  return NextResponse.json({
    messages, more: !since && (data || []).length === (before ? 40 : 60),
    members: (members || []).map((m) => ({ email: m.email, role: m.role, last_read_at: m.last_read_at, typing: m.email !== me.email && fresh(m.typing_at, 5), muted: m.muted })),
    online: (act || []).filter((p) => fresh(p.last_active_at)).map((p) => p.email),
  });
}

// Send a message. JSON { body, replyTo, applicationId } or multipart with a `file` (max 4 MB).
export async function POST(req: Request, { params }: Ctx) {
  const me = await currentStaff(); if (!me) return bad('unauthorized', 401);
  const { id } = await params;
  if (!(await membership(id, me.email))) return bad('Not found', 404);
  let body = '', replyTo: string | null = null, rawRefs: unknown = [], file: File | null = null;
  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    const f = await req.formData();
    body = String(f.get('body') || ''); replyTo = String(f.get('replyTo') || '') || null; try { rawRefs = JSON.parse(String(f.get('refs') || '[]')); } catch { rawRefs = []; }
    const x = f.get('file'); if (x instanceof File && x.size) file = x;
  } else { const j = (await req.json().catch(() => ({}))) as { body?: string; replyTo?: string; refs?: unknown }; body = j.body || ''; replyTo = j.replyTo || null; rawRefs = j.refs || []; }
  body = body.trim().slice(0, 2000);
  const hosts = [req.headers.get('host') || '', process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL).host : ''].filter(Boolean);
  const refs = await cleanRefs(me, rawRefs, body, hosts);
  if (!body && !file && !refs.length) return bad('Write a message or attach something.');
  const db = admin();
  let att: Record<string, unknown> = {};
  if (file) {
    if (file.size > ATT_MAX) return bad('That file is over 4 MB. Send a smaller file or share a Drive link.');
    const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-80);
    const path = `${id}/${crypto.randomUUID()}-${safe}`;
    const up = await db.storage.from('chat-files').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream' });
    if (up.error) return bad(`Upload failed: ${up.error.message}`, 500);
    att = { att_path: path, att_name: file.name.slice(0, 120), att_size: file.size, att_mime: file.type || 'application/octet-stream' };
  }
  if (replyTo) { const { data: r } = await db.from('portal_chat_msgs').select('id').eq('id', replyTo).eq('room_id', id).maybeSingle(); if (!r) replyTo = null; }
  const { data, error } = await db.from('portal_chat_msgs').insert({ room_id: id, sender: me.email, body, reply_to: replyTo, refs, ...att }).select(MSG_COLS).single();
  if (error || !data) return bad(error?.message || 'Could not send', 500);
  await Promise.all([
    db.from('portal_rooms').update({ last_message_at: data.created_at, last_preview: previewOf(body, (att.att_name as string) || (refs.length ? '👤 Shared a student' : null)), last_sender: me.email }).eq('id', id),
    db.from('portal_room_members').update({ typing_at: null, last_read_at: data.created_at }).eq('room_id', id).eq('email', me.email),
  ]);
  after(() => notifyChat(id, me.email, body.slice(0, 200), !!file).catch(() => {}));
  return NextResponse.json({ message: (await shapeMessages([data as never], me))[0] });
}

// Room settings: typing ping, mute, rename/recolour (owner), add/remove people (owner), leave.
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await currentStaff(); if (!me) return bad('unauthorized', 401);
  const { id } = await params, mem = await membership(id, me.email);
  if (!mem) return bad('Not found', 404);
  const b = (await req.json().catch(() => ({}))) as { typing?: boolean; muted?: boolean; name?: string; color?: string; add?: string[]; remove?: string; leave?: boolean };
  const db = admin();
  const { data: room } = await db.from('portal_rooms').select('kind').eq('id', id).single();
  const group = room?.kind === 'group', owner = mem.role === 'owner';
  if (b.typing) await db.from('portal_room_members').update({ typing_at: new Date().toISOString() }).eq('room_id', id).eq('email', me.email);
  if (typeof b.muted === 'boolean') await db.from('portal_room_members').update({ muted: b.muted }).eq('room_id', id).eq('email', me.email);
  if (group) {
    if ((b.name !== undefined || b.color) && !owner) return bad('Only the group owner can change this.', 403);
    if (b.name !== undefined || b.color) {
      const patch: Record<string, string> = {};
      if (b.name !== undefined) { const n = b.name.replace(/\s+/g, ' ').trim().slice(0, 60); if (!n) return bad('The group needs a name.'); patch.name = n; }
      if (b.color && COLORS_OK.includes(b.color)) patch.color = b.color;
      await db.from('portal_rooms').update(patch).eq('id', id);
    }
    if (b.add?.length) {
      if (!owner) return bad('Only the group owner can add people.', 403);
      const { data: staff } = await db.from('portal_staff').select('email').in('email', b.add.map((e) => e.toLowerCase()));
      if (staff?.length) await db.from('portal_room_members').upsert(staff.map((s) => ({ room_id: id, email: s.email.toLowerCase() })), { onConflict: 'room_id,email', ignoreDuplicates: true });
    }
    if (b.remove) {
      if (!owner) return bad('Only the group owner can remove people.', 403);
      if (b.remove.toLowerCase() === me.email) return bad('Use “Leave group” to remove yourself.');
      await db.from('portal_room_members').delete().eq('room_id', id).eq('email', b.remove.toLowerCase());
    }
    if (b.leave) {
      await db.from('portal_room_members').delete().eq('room_id', id).eq('email', me.email);
      const { data: left } = await db.from('portal_room_members').select('email, role, joined_at').eq('room_id', id).order('joined_at');
      if (!left?.length) await db.from('portal_rooms').delete().eq('id', id);
      else if (!left.some((m) => m.role === 'owner')) await db.from('portal_room_members').update({ role: 'owner' }).eq('room_id', id).eq('email', left[0].email);
    }
  }
  return NextResponse.json({ ok: true });
}
