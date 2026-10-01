import { redirect } from 'next/navigation';
import { admin, sessionClient } from './supabase';

export type Staff = { email: string; role: 'admin' | 'staff'; last_seen_at: string | null };

export async function currentStaff(): Promise<Staff | null> {
  const sb = await sessionClient();
  const { data } = await sb.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: row } = await admin().from('portal_staff').select('email, role, last_seen_at').eq('email', email).maybeSingle();
  return row ? { email: row.email, role: row.role, last_seen_at: row.last_seen_at } : null;
}

export async function requireStaff(): Promise<Staff> {
  const s = await currentStaff();
  if (!s) redirect('/login');
  return s;
}
