import { admin } from './supabase';
import { counselorKey } from './docs';
import { DEFAULT_WS, mayOpen } from './workspaceCore';

/** The staff who should hear about a student's message or call: the assigned counselor and, when there isn't one (or `withAdmins`), the admins. */
export async function staffFor(appId: string, withAdmins = false): Promise<string[]> {
  const db = admin();
  const { data: ap } = await db.from('portal_applications').select('counselor, workspace').eq('application_id', appId).maybeSingle();
  const { data: c } = ap?.counselor ? await db.from('portal_counselors').select('email').eq('name_key', counselorKey(ap.counselor)).maybeSingle() : { data: null };
  const to = c?.email ? [c.email] : [];
  if (!to.length || withAdmins) { const { data: ad } = await db.from('portal_staff').select('email').eq('role', 'admin'); to.push(...(ad || []).map((x) => x.email)); }
  // Only people who may open this student's workspace (country) hear about them.
  const emails = [...new Set(to.map((e) => e.toLowerCase()))], ws = ap?.workspace || DEFAULT_WS;
  const { data: rows } = emails.length ? await db.from('portal_staff').select('email, role, workspaces').in('email', emails) : { data: [] };
  const known = new Map((rows || []).map((r) => [r.email.toLowerCase(), r as { role: 'admin' | 'staff' | 'counselor'; workspaces: string[] | null }]));
  return emails.filter((e) => { const r = known.get(e); return r ? mayOpen(r, ws) : ws === DEFAULT_WS; });
}
