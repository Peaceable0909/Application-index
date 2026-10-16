import { currentWorkspace } from './workspace';
import { admin } from './supabase';
import { buildCatalog, type Catalog } from './moves';

/** Every school and programme in use, for the suggestion chips in the move sheet. */
export async function getCatalog(): Promise<Catalog> {
  const { data } = await admin().from('portal_applications').select('school, programme, student_key').eq('workspace', await currentWorkspace()).or('email.is.null,email.neq.test@example.com').limit(5000);
  return buildCatalog(data || []);
}
