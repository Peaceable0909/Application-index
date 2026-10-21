import { admin } from './supabase';

type U = { id: string; email?: string; factors?: { factor_type: string; status: string }[] | null };

/** Everyone who has a sign-in account, a page at a time (the team is small, so this is a couple of requests at most). */
async function allUsers(): Promise<U[]> {
  const out: U[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    out.push(...(data.users as unknown as U[]));
    if (data.users.length < 1000) break;
  }
  return out;
}

/** email -> true when that person has an authenticator app set up. People who never signed in are missing from the map. */
export async function twoStepStatus(): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>();
  for (const u of await allUsers()) if (u.email) m.set(u.email.toLowerCase(), !!u.factors?.some((f) => f.factor_type === 'totp' && f.status === 'verified'));
  return m;
}

export async function userIdForEmail(email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  return (await allUsers()).find((u) => u.email?.toLowerCase() === e)?.id || null;
}
