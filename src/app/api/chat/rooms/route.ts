import { NextResponse } from 'next/server';
import { admin } from '@/lib/supabase';
import { currentStaff } from '@/lib/auth';
import { COLORS_OK, dmRoom, loadRooms } from '@/lib/chat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rooms = await loadRooms(me.email);
  const { data: act } = await admin().from('portal_staff').select('email, last_active_at');
  const online = (act || []).filter((p) => p.last_active_at && Date.now() - new Date(p.last_active_at).getTime() < 90_000).map((p) => p.email);
  return NextResponse.json({ rooms, online, unread: rooms.filter((r) => !r.muted).reduce((n, r) => n + r.unread, 0) });
}

// Open a 1:1 chat ({ with }) or create a group ({ name, color, members }).
export async function POST(req: Request) {
  const me = await currentStaff();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { with?: string; name?: string; color?: string; members?: string[] };
  const db = admin();
  const { data: staff } = await db.from('portal_staff').select('email');
  const valid = new Set((staff || []).map((s) => s.email.toLowerCase()));
  if (b.with) {
    const other = b.with.toLowerCase();
    if (!valid.has(other) || other === me.email) return NextResponse.json({ error: 'That person isn’t on the portal.' }, { status: 400 });
    return NextResponse.json({ id: await dmRoom(me.email, other) });
  }
  const name = (b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: 'Give the group a name.' }, { status: 400 });
  const members = [...new Set((b.members || []).map((m) => m.toLowerCase()))].filter((m) => valid.has(m) && m !== me.email);
  if (!members.length) return NextResponse.json({ error: 'Pick at least one person to add.' }, { status: 400 });
  const { data: room, error } = await db.from('portal_rooms').insert({ kind: 'group', name, color: COLORS_OK.includes(b.color || '') ? b.color : 'navy', created_by: me.email, last_preview: 'Group created', last_sender: me.email }).select('id').single();
  if (error || !room) return NextResponse.json({ error: error?.message || 'Could not create the group' }, { status: 500 });
  await db.from('portal_room_members').insert([{ room_id: room.id, email: me.email, role: 'owner' }, ...members.map((email) => ({ room_id: room.id, email }))]);
  return NextResponse.json({ id: room.id });
}
