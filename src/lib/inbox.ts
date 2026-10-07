import { admin } from './supabase';
import { appIdsFor } from './auth';
import type { Staff } from './auth';

/** Application ids this staff member may see student chats for; null means all of them. */
export async function inboxScope(staff: Pick<Staff, 'role' | 'counselor_key'>): Promise<string[] | null> {
  return staff.role === 'counselor' ? await appIdsFor(staff.counselor_key) : null;
}

export async function inboxUnread(staff: Pick<Staff, 'role' | 'counselor_key'>): Promise<number> {
  const scope = await inboxScope(staff);
  if (scope && !scope.length) return 0;
  let q = admin().from('portal_student_msgs').select('id', { count: 'exact', head: true }).eq('from_student', true).is('staff_read_at', null);
  if (scope) q = q.in('application_id', scope);
  return (await q).count || 0;
}
