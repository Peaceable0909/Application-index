import { requireStaff, canAccessApp } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { inboxList } from '@/lib/inbox';
import { studentPhoto } from '@/lib/studentPhotos';
import StaffMessenger from '@/components/StaffMessenger';

export const metadata = { title: 'Student chats' };

export default async function Inbox({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const list = await inboxList(staff);
  let open: { appId: string; name: string; photo: string | null } | null = null;
  if (sp.app && (await canAccessApp(staff, sp.app))) {
    const hit = list.find((c) => c.appId === sp.app);
    if (hit) open = { appId: hit.appId, name: hit.name, photo: hit.photo };
    else { const { data: a } = await admin().from('portal_applications').select('name, email').eq('application_id', sp.app).maybeSingle(); if (a) open = { appId: sp.app, name: a.name, photo: await studentPhoto(a.email) }; }
  }
  return <StaffMessenger initial={list} openApp={open} />;
}
