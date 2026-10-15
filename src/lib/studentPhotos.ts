import { admin } from './supabase';

/** Profile pictures students chose for themselves, by email. People without one are simply missing from the result. */
export async function studentPhotos(emails: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = [...new Set(emails.filter((e): e is string => !!e).map((e) => e.trim().toLowerCase()))];
  if (!list.length) return {};
  try {
    const { data } = await admin().from('portal_student_profiles').select('email, avatar_url').in('email', list).not('avatar_url', 'is', null);
    return Object.fromEntries((data || []).map((r) => [r.email as string, r.avatar_url as string]));
  } catch { return {}; }
}
export async function studentPhoto(email: string | null | undefined): Promise<string | null> { return (await studentPhotos([email]))[(email || '').trim().toLowerCase()] || null; }
