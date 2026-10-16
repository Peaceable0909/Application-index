import { admin } from './supabase';
import { callScript } from './appsScript';

/**
 * Another country's students have no form that makes a Drive folder for them. The first time one needs somewhere to put a document,
 * a private folder is made for them under that country's main folder and linked like a hand-linked one (so syncs keep it).
 */
export async function ensureFolder(appId: string): Promise<string> {
  const db = admin();
  const { data: a } = await db.from('portal_applications').select('name, workspace, drive_folder_id, extra_folder_ids').eq('application_id', appId).single();
  if (!a) throw new Error('Student not found');
  if (a.drive_folder_id) return a.drive_folder_id;
  const { data: w } = await db.from('portal_workspaces').select('name, drive_folder_name').eq('key', a.workspace).maybeSingle();
  let f: { id: string; url: string };
  try { f = await callScript<{ id: string; url: string }>('createStudentFolder', { rootName: w?.drive_folder_name || `${w?.name || a.workspace} applications`, name: a.name }); }
  catch (e) { throw new Error(/unknown action/i.test((e as Error).message) ? 'Your Apps Script needs the newest PortalApi.gs to create student folders.' : (e as Error).message); }
  await db.from('portal_applications').update({ drive_folder_id: f.id, drive_folder_url: f.url, extra_folder_ids: [...new Set([...(a.extra_folder_ids || []), f.id])] }).eq('application_id', appId);
  return f.id;
}
