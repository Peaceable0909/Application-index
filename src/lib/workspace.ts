import { cache } from 'react';
import { cookies } from 'next/headers';
import { admin } from './supabase';
import { currentStaff, type Staff } from './auth';
import { DEFAULT_WS, WS_COOKIE, keysFor } from './workspaceCore';
import { REQUIRED_DOCS } from './constants';

export { DEFAULT_WS, WS_COOKIE, mayOpen } from './workspaceCore';
export type Workspace = { key: string; name: string; master_tab: string; extra_tab: string | null; drive_folder_name: string | null; active: boolean; required_docs: string[] | null; brief: string | null };

/** Every workspace (country), oldest first. */
export const listWorkspaces = cache(async (): Promise<Workspace[]> => {
  const { data } = await admin().from('portal_workspaces').select('key, name, master_tab, extra_tab, drive_folder_name, active, required_docs, brief').order('created_at');
  return (data || []) as Workspace[];
});

/** The workspaces this person may open (admins: all of them). */
export async function workspacesFor(staff: Pick<Staff, 'role' | 'workspaces'>): Promise<Workspace[]> {
  const all = await listWorkspaces();
  const ok = new Set(keysFor(staff, all.map((w) => w.key)));
  return all.filter((w) => ok.has(w.key) && w.active);
}

/** The workspace this request works in: the one chosen in the switcher if it is allowed, otherwise the first allowed one. */
export const currentWorkspace = cache(async (): Promise<string> => {
  const staff = await currentStaff();
  if (!staff) return DEFAULT_WS;
  const mine = await workspacesFor(staff);
  const want = (await cookies()).get(WS_COOKIE)?.value;
  return mine.find((w) => w.key === want)?.key || mine[0]?.key || DEFAULT_WS;
});

/** The documents every student of a workspace must send: set from the AI Brain page, or the original list when nobody has changed it. */
export const requiredDocs = cache(async (ws: string): Promise<string[]> => {
  const w = (await listWorkspaces()).find((x) => x.key === ws);
  return w?.required_docs?.length ? w.required_docs : [...REQUIRED_DOCS];
});
