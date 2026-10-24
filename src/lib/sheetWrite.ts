import { admin } from './supabase';
import { callScript } from './appsScript';
import { tabArgs } from './sheets';

// Status/counselor/notes live in the hand-maintained master sheet when the student is in it;
// otherwise they go to the raw Applications sheet. Notes are appended, never overwritten.
export async function writeBack(id: string, fields: Record<string, string>, notesAppend?: string, by?: string) {
  const { data: app } = await admin().from('portal_applications')
    .select('in_master, has_raw, master_data, workspace').eq('application_id', id).single();
  if (!app) throw new Error('Application not found');
  if (app.in_master && app.master_data) {
    const m = app.master_data as { email: string; name: string; school: string };
    await callScript('updateMaster', { email: m.email, name: m.name, school: m.school, fields, notesAppend, by, ...(await tabArgs(app.workspace)) });
  } else if (app.has_raw) {
    await callScript('updateRow', { applicationId: id, fields, notesAppend, by });
  }
}
