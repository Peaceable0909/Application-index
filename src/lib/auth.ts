import { redirect } from 'next/navigation';
import { admin, sessionClient } from './supabase';

export type Staff = { email: string; role: 'admin' | 'staff' };

export async function currentStaff(): Promise<Staff | null> {
  const sb = await sessionClient();
  const { data } = await sb.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: row } = await admin().from('portal_staff').select('email, role').eq('email', email).maybeSingle();
  return row ? { email: row.email, role: row.role } : null;
}

export async function requireStaff(): Promise<Staff> {
  const s = await currentStaff();
  if (!s) redirect('/login');
  return s;
}
