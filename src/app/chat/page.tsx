import { requireStaff } from '@/lib/auth';
import { loadPeople } from '@/lib/people';
import { dmRoom, loadRooms } from '@/lib/chat';
import { redirect } from 'next/navigation';
import ChatApp from '@/components/ChatApp';

export const dynamic = 'force-dynamic';

export default async function Chat({ searchParams }: { searchParams: Promise<{ room?: string; with?: string }> }) {
  const me = await requireStaff();
  const sp = await searchParams;
  // /chat?with=email (old links) → the 1:1 room
  if (sp.with && sp.with.toLowerCase() !== me.email) {
    const people = await loadPeople();
    if (people.has(sp.with.toLowerCase())) redirect(`/chat?room=${await dmRoom(me.email, sp.with)}`);
  }
  const [rooms, peopleMap] = await Promise.all([loadRooms(me.email), loadPeople()]);
  const people = Object.fromEntries([...peopleMap].map(([k, p]) => [k, { email: p.email, name: p.name, avatar_url: p.avatar_url, color: p.color, title: p.title }]));
  const active = sp.room && rooms.some((r) => r.id === sp.room) ? sp.room : null;
  return (
    <>
      <div className="head"><h1>Chat</h1></div>
      <p className="sub">Messages between teammates and counselors: one-to-one or in groups.</p>
      <ChatApp me={me.email} people={people} initialRooms={rooms} initialActive={active} />
    </>
  );
}
