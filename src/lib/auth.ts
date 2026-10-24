import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { MAX_MS } from './session';
import { admin, sessionClient } from './supabase';
import { counselorKey } from './docs';
import { currentStudent } from './student';
import { mayOpen } from './workspaceCore';
import { inScope, type Scope } from './assignEngine';

export type Staff = {
  email: string; role: 'admin' | 'staff' | 'counselor'; last_seen_at: string | null; counselor_key: string | null;
  workspaces: string[] | null; display_name: string | null; avatar_url: string | null; title: string | null; phone: string | null; bio: string | null; color: string | null; notify_email: boolean | null;
  /** Oversees the schools / destinations / locations listed in portal_head_scopes (on top of their normal role). */
  team_head: boolean | null;
};

export type TwoStepWho = 'off' | 'admins' | 'everyone';
let policyMemo: { at: number; who: TwoStepWho } | null = null;

/** Who must use the authenticator-app code (an admin setting; "off" until an admin turns it on). Remembered for 30 seconds. */
export async function twoStepPolicy(fresh = false): Promise<TwoStepWho> {
  if (!fresh && policyMemo && Date.now() - policyMemo.at < 30_000) return policyMemo.who;
  const { data } = await admin().from('portal_settings').select('value').eq('key', 'two_step').maybeSingle();
  const w = (data?.value as { who?: string } | null)?.who;
  const who: TwoStepWho = w === 'admins' || w === 'everyone' ? w : 'off';
  policyMemo = { at: Date.now(), who };
  return who;
}
export const twoStepRequired = (who: TwoStepWho, role: Staff['role']) => who === 'everyone' || (who === 'admins' && role === 'admin');

/** Where a visitor stands: fully in, not on the team, timed out, or still owing the second step. */
export type Gate = { state: 'ok'; staff: Staff } | { state: 'enroll'; staff: Staff } | { state: 'needs2fa' } | { state: 'expired' } | { state: 'none' };

/** Cached per request: the layout and the page both ask, but the lookup only runs once. */
export const staffGate = cache(async (): Promise<Gate> => {
  const sb = await sessionClient();
  const { data } = await sb.auth.getUser();
  const user = data.user, email = user?.email?.toLowerCase();
  if (!user || !email) return { state: 'none' };
  const { data: row } = await admin().from('portal_staff').select('email, role, workspaces, last_seen_at, counselor_key, display_name, avatar_url, title, phone, bio, color, notify_email, team_head').eq('email', email).maybeSingle();
  if (!row) return { state: 'none' };
  const staff = row as Staff;
  // Time limits: silent for too long (the browser stopped saying "still here"), or signed in for longer than a working day.
  const signedIn = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
  if ((await headers()).get('x-wr-idle') === '1' || (signedIn && Date.now() - signedIn > MAX_MS)) return { state: 'expired' };
  // Emergency switch: TWO_STEP_DISABLED=1 in Vercel skips the second step for everyone (use only if an authenticator problem locks the team out).
  if (process.env.TWO_STEP_DISABLED === '1') return { state: 'ok', staff };
  // Second step: anyone with an authenticator app set up must have typed the code in this session.
  if (user.factors?.some((f) => f.factor_type === 'totp' && f.status === 'verified')) {
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    return error || aal?.currentLevel !== 'aal2' ? { state: 'needs2fa' } : { state: 'ok', staff };
  }
  if (twoStepRequired(await twoStepPolicy(), staff.role)) return { state: 'enroll', staff };
  return { state: 'ok', staff };
});

/** The fully signed-in team member, or null (also null while the second step, the setup or a re-sign-in is still owed). */
export const currentStaff = cache(async (): Promise<Staff | null> => {
  const g = await staffGate();
  return g.state === 'ok' ? g.staff : null;
});

/** For the two-step setup screens only: a signed-in team member who may not have finished setting up the second step yet. */
export async function staffForSetup(): Promise<Staff> {
  const g = await staffGate();
  if (g.state === 'ok' || g.state === 'enroll') return g.staff;
  if (g.state === 'expired') redirect('/auth/expired');
  redirect(g.state === 'needs2fa' ? '/login/verify' : '/login');
}

/** Any signed-in person on the allowlist (team member or counselor). */
export async function requireStaff(): Promise<Staff> {
  const g = await staffGate();
  if (g.state === 'ok') return g.staff;
  if (g.state === 'expired') redirect('/auth/expired');
  if (g.state === 'needs2fa') redirect('/login/verify');
  if (g.state === 'enroll') redirect('/login/setup');
  if (await currentStudent()) redirect('/student');
  redirect('/login');
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

/** One lookup per request per application: who it is assigned to, which workspace (country) it is in, and what a Team Head's scope is matched on. */
const appInfo = cache(async (applicationId: string) => (await admin().from('portal_applications').select('counselor, workspace, school, city').eq('application_id', applicationId).maybeSingle()).data);

/** What a Team Head oversees (schools, destinations, locations). One lookup per request. */
export const headScopes = cache(async (email: string): Promise<Scope[]> => {
  const { data } = await admin().from('portal_head_scopes').select('workspace, scope, school_key, location_key').eq('email', email.toLowerCase());
  return (data || []) as Scope[];
});

export async function canAccessApp(s: Staff, applicationId: string): Promise<boolean> {
  const data = await appInfo(applicationId);
  if (!data) return s.role !== 'counselor';
  if (!mayOpen(s, data.workspace)) return false;                       // another country's student
  if (s.role !== 'counselor' || canSee(s, data.counselor)) return true;
  // a counselor who is also a Team Head may open the students inside what they oversee, and only those
  return !!s.team_head && inScope(await headScopes(s.email), data);
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
