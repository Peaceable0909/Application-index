'use server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { admin, sessionClient } from '@/lib/supabase';
import { requireTeam, staffForSetup, staffGate, twoStepPolicy, twoStepRequired, type TwoStepWho } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { ACT_COOKIE, actCookie } from '@/lib/session';
import { userIdForEmail } from '@/lib/twoStep';

const digits = (v: unknown) => String(v ?? '').replace(/\s+/g, '');
const CODE = /^\d{6}$/;
const EASY = 'Type the 6 numbers shown in your authenticator app.';
const badCode = (m: string) => (/invalid|expired|incorrect/i.test(m) ? 'That code did not work. Wait for a fresh one in your app and try again.' : m);

type Started = { ok: true; factorId: string; qr: string; secret: string } | { ok: false; error: string };

/** Step 1 of turning on the second step: makes a new authenticator secret and returns the QR code to scan. Nothing is switched on until the code is checked. */
export async function startTwoStep(): Promise<Started> {
  await staffForSetup();
  const sb = await sessionClient();
  const { data: list } = await sb.auth.mfa.listFactors();
  if (list?.totp?.length) return { ok: false, error: 'Two-step sign-in is already on for your account.' };
  // a half-finished earlier attempt would make the app refuse to start a new one
  for (const f of list?.all || []) if (f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `WhiteRock ${new Date().toISOString().slice(0, 16)}`, issuer: 'WhiteRock' });
  if (error || !data) return { ok: false, error: /disabled|not enabled|not allowed/i.test(error?.message || '') ? 'Two-step sign-in is not switched on in Supabase yet. An admin needs to turn on TOTP under Authentication → Multi-Factor in Supabase.' : error?.message || 'Could not start. Try again.' };
  return { ok: true, factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Step 2: the person types the code from their app; if it is right, the second step is on and this session counts as checked. */
export async function finishTwoStep(factorId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await staffForSetup();
  const c = digits(code);
  if (!CODE.test(c)) return { ok: false, error: EASY };
  const { error } = await (await sessionClient()).auth.mfa.challengeAndVerify({ factorId, code: c });
  if (error) return { ok: false, error: badCode(error.message) };
  (await cookies()).set(ACT_COOKIE, String(Date.now()), actCookie());
  await audit(staff.email, 'two_step_on', staff.email);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** The sign-in screen that appears after the password or Google step when the account has an authenticator app. */
export async function verifyTwoStep(f: FormData) {
  const back = (m: string): never => redirect(`/login/verify?error=${encodeURIComponent(m)}`);
  const g = await staffGate();
  if (g.state !== 'needs2fa') redirect('/');
  const sb = await sessionClient();
  const email = (await sb.auth.getUser()).data.user?.email?.toLowerCase() || '';
  const code = digits(f.get('code'));
  if (!CODE.test(code)) return back(EASY);
  const { data: fl } = await sb.auth.mfa.listFactors();
  const factor = fl?.totp?.[0];
  if (!factor) return back('No authenticator app is set up on this account. Sign out and ask an admin to reset it.');
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) { await audit(email, 'two_step_failed', email); return back(badCode(error.message)); }
  (await cookies()).set(ACT_COOKIE, String(Date.now()), actCookie());
  redirect('/');
}

/** Turns the second step off for yourself (not allowed while an admin requires it for your role). */
export async function stopTwoStep() {
  const staff = await staffForSetup();
  const back = (m: string, err = false): never => redirect(`/profile?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}#two-step`);
  if (twoStepRequired(await twoStepPolicy(true), staff.role)) return back('Two-step sign-in is required for your role, so it cannot be turned off.', true);
  const sb = await sessionClient();
  const { data: fl } = await sb.auth.mfa.listFactors();
  for (const fa of fl?.all || []) {
    const { error } = await sb.auth.mfa.unenroll({ factorId: fa.id });
    if (error) return back(/aal2/i.test(error.message) ? 'For safety, sign out and sign in again (with your code) before turning it off.' : error.message, true);
  }
  await audit(staff.email, 'two_step_off', staff.email);
  back('Two-step sign-in is off.');
}

/** Admins: choose who must use the second step. Only allowed once the admin has switched it on for themself, so nobody locks themself out. */
export async function setTwoStepPolicy(f: FormData) {
  const me = await requireTeam();
  const back = (m: string, err = false): never => redirect(`/settings?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}#security`);
  if (me.role !== 'admin') return back('Only admins can change this.', true);
  const raw = String(f.get('who') || '');
  const who: TwoStepWho = raw === 'admins' || raw === 'everyone' ? raw : 'off';
  if (who !== 'off') {
    const { data: fl } = await (await sessionClient()).auth.mfa.listFactors();
    if (!fl?.totp?.length) return back('Turn on two-step for your own account first (My profile), so you cannot lock yourself out. Then come back here.', true);
  }
  await admin().from('portal_settings').upsert({ key: 'two_step', value: { who }, updated_by: me.email, updated_at: new Date().toISOString() });
  await twoStepPolicy(true);
  await audit(me.email, 'two_step_policy', who);
  back(who === 'off' ? 'Two-step sign-in is optional again.' : who === 'admins' ? 'Admins now need the authenticator code. Anyone who has not set it up is asked to at their next page.' : 'Everyone on the team and all counselors now need the authenticator code. Anyone who has not set it up is asked to at their next page.');
}

/** Admins: someone lost their phone. Removes their authenticator so they can sign in and set up a new one. */
export async function resetTwoStep(f: FormData) {
  const me = await requireTeam();
  const back = (m: string, err = false): never => redirect(`/settings?${err ? 'err' : 'msg'}=${encodeURIComponent(m)}#security`);
  if (me.role !== 'admin') return back('Only admins can reset someone’s two-step.', true);
  const email = String(f.get('email') || '').trim().toLowerCase();
  const userId = await userIdForEmail(email);
  if (!userId) return back('That person has not signed in yet, so there is nothing to reset.', true);
  const db = admin();
  const { data } = await db.auth.admin.mfa.listFactors({ userId });
  for (const fa of data?.factors || []) await db.auth.admin.mfa.deleteFactor({ id: fa.id, userId });
  await audit(me.email, 'two_step_reset', email);
  back(`Reset done. ${email} can sign in with just their usual sign-in and set up a new authenticator app.`);
}
