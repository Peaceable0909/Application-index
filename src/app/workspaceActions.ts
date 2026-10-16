'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireStaff, requireTeam } from '@/lib/auth';
import { admin } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { listWorkspaces, workspacesFor, WS_COOKIE } from '@/lib/workspace';

const txt = (f: FormData, k: string) => String(f.get(k) || '').trim();
const back = (msg: string, err = false) => { revalidatePath('/', 'layout'); redirect(`/settings?${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`); };

/** The switcher in the top bar: remembers which country this person is working in (only ones they may open). */
export async function switchWorkspace(key: string): Promise<{ ok: boolean }> {
  const staff = await requireStaff();
  if (!(await workspacesFor(staff)).some((w) => w.key === key)) return { ok: false };
  (await cookies()).set(WS_COOKIE, key, { path: '/', maxAge: 365 * 864e2, sameSite: 'lax', httpOnly: true, secure: true });
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function createWorkspace(f: FormData) {
  const me = await requireTeam();
  if (me.role !== 'admin') return back('Admins only.', true);
  const name = txt(f, 'name'), tab = txt(f, 'tab'), extra = txt(f, 'extraTab') || null;
  const key = (txt(f, 'key') || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  if (name.length < 2 || !/^[a-z][a-z0-9-]{1,23}$/.test(key)) return back('Give the workspace a name (for example “Canada”).', true);
  if (!tab) return back('Tell me the Google Sheet tab that lists this country’s students.', true);
  if ((await listWorkspaces()).some((w) => w.key === key)) return back('A workspace with that name already exists.', true);
  const { error } = await admin().from('portal_workspaces').insert({ key, name, master_tab: tab, extra_tab: extra });
  if (error) return back(`Could not create it: ${error.message}`, true);
  await audit(me.email, 'workspace_created', key, { name, tab });
  back(`Workspace “${name}” created. Give people access below, then add the sheet tab “${tab}”.`);
}

/** Admin: which workspaces one person may open. Admins always open all of them. */
export async function setStaffWorkspaces(f: FormData) {
  const me = await requireTeam();
  if (me.role !== 'admin') return back('Admins only.', true);
  const email = txt(f, 'email').toLowerCase(), valid = new Set((await listWorkspaces()).map((w) => w.key));
  const keys = f.getAll('ws').map(String).filter((k) => valid.has(k));
  if (!keys.length) return back('Pick at least one workspace for that person.', true);
  await admin().from('portal_staff').update({ workspaces: keys }).eq('email', email);
  await audit(me.email, 'staff_workspaces_set', email, { keys });
  back('Access updated.');
}
