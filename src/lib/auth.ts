import { cache } from 'react';
import { redirect } from 'next/navigation';
import { admin, sessionClient } from './supabase';
import { counselorKey } from './docs';
import { currentStudent } from './student';
import { mayOpen } from './workspaceCore';

export type Staff = {
  email: string; role: 'admin' | 'staff' | 'counselor'; last_seen_at: string | null; counselor_key: string | null;
  workspaces: string[] | null; display_name: string | null; avatar_url: string | null; title: string | null; phone: string | null; bio: string | null; color: string | null; notify_email: boolean | null;
};

/** Cached per request: the layout and the page both ask, but the lookup only runs once. */
export const currentStaff = cache(async (): Promise<Staff | null> => {
  const sb = await sessionClient();
  const { data } = await sb.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: row } = await admin().from('portal_staff').select('email, role, workspaces, last_seen_at, counselor_key, display_name, avatar_url, title, phone, bio, color, notify_email').eq('email', email).maybeSingle();
  return row ? (row as Staff) : null;
});

/** Any signed-in person on the allowlist (team member or counselor). */
export async function requireStaff(): Promise<Staff> {
  const s = await currentStaff();
  if (!s) { if (await currentStudent()) redirect('/student'); redirect('/login'); }
  return s;
}

/** Team-only (admin / staff). Counselors are sent to their own page. Use on every page and action that touches all students. */
export async function requireTeam(): Promise<Staff> {
  const s = await requireStaff();
  if (s.role === 'counselor') redirect('/my');
  return s;
}

export const isCounselor = (s: Staff) => s.role === 'counselor';

/** Can this person see this application? Team: all. Counselor: only students assigned to them. */
export const canSee = (s: Staff, appCounselor: string | null) => s.role !== 'counselor' || (!!s.counselor_key && counselorKey(appCounselor) === s.counselor_key);

/** One lookup per request per application: who it is assigned to and which workspace (country) it is in. */
const appInfo = cache(async (applicationId: string) => (await admin().from('portal_applications').select('counselor, workspace').eq('application_id', applicationId).maybeSingle()).data);

export async function canAccessApp(s: Staff, applicationId: string): Promise<boolean> {
  const data = await appInfo(applicationId);
  if (!data) return s.role !== 'counselor';
  if (!mayOpen(s, data.workspace)) return false;                       // another country's student
  return s.role !== 'counselor' || canSee(s, data.counselor);
}

/** For server actions: stop (and send the person home) if the student isn't theirs. */
export async function guardApp(s: Staff, applicationId: string) {
  if (!(await canAccessApp(s, applicationId))) redirect(s.role === 'counselor' ? '/my?err=' + encodeURIComponent('You can only work on students assigned to you.') : '/?err=' + encodeURIComponent('You don’t have access to that student’s workspace.'));
}

/** Application ids belonging to a counselor (matched by normalised name, so "MR Abraham" = "Mr Abraham"). */
export async function appIdsFor(key: string | null): Promise<string[]> {
  if (!key) return [];
  const { currentWorkspace } = await import('./workspace');
  const { data } = await admin().from('portal_applications').select('application_id, counselor').eq('workspace', await currentWorkspace());
  return (data || []).filter((r) => counselorKey(r.counselor) === key).map((r) => r.application_id);
}
