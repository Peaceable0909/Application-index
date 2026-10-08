import { canAccessApp, requireStaff } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { decodeId } from '@/lib/format';
import { loadPeople } from '@/lib/people';
import { dmRoom, loadRooms } from '@/lib/chat';
import { redirect } from 'next/navigation';
import ChatApp from '@/components/ChatApp';

export const dynamic = 'force-dynamic';

export default async function Chat({ searchParams }: { searchParams: Promise<{ room?: string; with?: string; about?: string }> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  // /chat?with=email (old links) → the 1:1 room
  if (sp.with && sp.with.toLowerCase() !== me.email) {
    const people = await loadPeople();
    if (people.has(sp.with.toLowerCase())) redirect(`/chat?room=${await dmRoom(me.email, sp.with)}`);
  }
  const [rooms, peopleMap] = await Promise.all([loadRooms(me.email), loadPeople()]);
  const people = Object.fromEntries([...peopleMap].map(([k, p]) => [k, { email: p.email, name: p.name, avatar_url: p.avatar_url, color: p.color, title: p.title }]));
  let about: { id: string; name: string } | null = null;
  if (sp.about) { const id = decodeId(sp.about); if (await canAccessApp(me, id)) { const { data } = await admin().from('portal_applications').select('application_id, name').eq('application_id', id).maybeSingle(); if (data) about = { id: data.application_id, name: data.name }; } }
  const active = sp.room && rooms.some((r) => r.id === sp.room) ? sp.room : null;
  return (
    <>
      <ChatApp me={me.email} people={people} initialRooms={rooms} initialActive={active} about={about} />
    </>
  );
}
