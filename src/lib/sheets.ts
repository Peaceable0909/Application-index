import { callScript } from './appsScript';
import { admin } from './supabase';
import { DEFAULT_WS } from './workspaceCore';

let supported: Promise<void> | null = null;
/** An old Apps Script ignores the tab name and would read or write the UK sheet, so check the new one is installed before touching another country's tab. */
function assertTabSupport(): Promise<void> {
  supported ||= callScript<{ tabs?: boolean }>('tabSupport').then((r) => { if (!r?.tabs) throw new Error('x'); }).catch(() => { supported = null; throw new Error('Your Apps Script needs the newest PortalApi.gs (it does not know about other countries’ sheet tabs yet). Paste it in and deploy a new version.'); });
  return supported;
}

/** What to add to a sheet call for this workspace: nothing for the original one, the tab name for any other. */
export async function tabArgs(workspace: string | null | undefined): Promise<{ tab?: string }> {
  if (!workspace || workspace === DEFAULT_WS) return {};
  await assertTabSupport();
  const { data } = await admin().from('portal_workspaces').select('master_tab').eq('key', workspace).maybeSingle();
  if (!data?.master_tab) throw new Error('That workspace has no sheet tab set.');
  return { tab: data.master_tab };
}

/** Rows of a workspace's master tab (the original workspace uses the classic call). */
export async function listMasterFor<T>(workspace: string, tab: string): Promise<T[]> {
  if (workspace === DEFAULT_WS) return callScript<T[]>('listMaster');
  await assertTabSupport();
  const r = await callScript<{ tab: string; rows: T[] } | T[]>('listMaster', { tab });
  if (Array.isArray(r) || r.tab !== tab) throw new Error('Your Apps Script needs the newest PortalApi.gs to read other countries’ tabs.');
  return r.rows;
}
