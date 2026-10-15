import { admin } from './supabase';
import { counselorKey } from './docs';

/** The staff who should hear about a student's message or call: the assigned counselor and, when there isn't one (or `withAdmins`), the admins. */
export async function staffFor(appId: string, withAdmins = false): Promise<string[]> {
  const db = admin();
  const { data: ap } = await db.from('portal_applications').select('counselor').eq('application_id', appId).maybeSingle();
  const { data: c } = ap?.counselor ? await db.from('portal_counselors').select('email').eq('name_key', counselorKey(ap.counselor)).maybeSingle() : { data: null };
  const to = c?.email ? [c.email] : [];
  if (!to.length || withAdmins) { const { data: ad } = await db.from('portal_staff').select('email').eq('role', 'admin'); to.push(...(ad || []).map((x) => x.email)); }
  return [...new Set(to.map((e) => e.toLowerCase()))];
}
