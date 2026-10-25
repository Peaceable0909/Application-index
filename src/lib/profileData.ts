// What the profile pages read besides the person's own row: what each person handles.
// "Handles" is never stored on the profile. It is read from the assignment records (rules and Team Head scopes), so a profile cannot
// claim a country or a school the assignment system does not give that person.
import { cache } from 'react';
import { admin } from './supabase';
import { listWorkspaces } from './workspace';
import { buildHandles, type Handles } from './profileHandles';
import { loadCounselors, loadRules } from './assignCore';

/** Everyone's responsibilities in one pass (three small reads), keyed by lowercase email. */
export const loadHandlesMap = cache(async (): Promise<Map<string, Handles>> => {
  const db = admin();
  const [rules, counselors, workspaces, { data: scopes }, { data: staff }] = await Promise.all([
    loadRules(db), loadCounselors(db), listWorkspaces(),
    db.from('portal_head_scopes').select('email, workspace, scope, school_key, school_name, location_key, location_name'),
    db.from('portal_staff').select('email, counselor_key'),
  ]);
  const names = new Map(workspaces.map((w) => [w.key, w.name]));
  const today = new Date().toISOString().slice(0, 10);
  const byEmail = new Map<string, string>();
  for (const [key, c] of counselors) if (c.email) byEmail.set(c.email.toLowerCase(), key);
  const out = new Map<string, Handles>();
  for (const p of staff || []) {
    const email = String(p.email).toLowerCase();
    const mine = ((scopes || []) as { email: string }[]).filter((s) => s.email.toLowerCase() === email) as never[];
    out.set(email, buildHandles({ counselorKey: (p.counselor_key as string | null) || byEmail.get(email) || null, rules, scopes: mine, workspaces: names, today }));
  }
  return out;
});

export const loadHandles = async (email: string): Promise<Handles> => (await loadHandlesMap()).get(email.toLowerCase()) || buildHandles({ counselorKey: null, rules: [], scopes: [], workspaces: new Map(), today: '' });
