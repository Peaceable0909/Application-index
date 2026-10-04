import { gzipSync } from 'zlib';
import { admin } from './supabase';
import { audit } from './audit';

const TABLES = ['portal_applications', 'portal_documents', 'portal_notes', 'portal_activity', 'portal_tasks', 'portal_reminders', 'portal_counselors', 'portal_staff', 'portal_messages', 'portal_audit', 'portal_rooms', 'portal_room_members', 'portal_chat_msgs'];
const KEEP = 14;

async function all(table: string) {
  const db = admin(), out: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('*').range(from, from + 999);
    if (error) return { rows: out, error: error.message };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { rows: out as unknown[], error: null as string | null };
}

/** Copies the portal's own data (not the Google Sheet or Drive) into a private, dated, compressed file. Keeps the newest 14. */
export async function runBackup(by: string) {
  const dump: Record<string, unknown> = { made_at: new Date().toISOString(), tables: {} }, counts: Record<string, number> = {}, failed: string[] = [];
  for (const t of TABLES) { const r = await all(t); if (r.error) { failed.push(`${t}: ${r.error}`); continue; } (dump.tables as Record<string, unknown>)[t] = r.rows; counts[t] = r.rows.length; }
  const db = admin(), name = `portal-${new Date().toISOString().slice(0, 10)}.json.gz`;
  const up = await db.storage.from('backups').upload(name, gzipSync(Buffer.from(JSON.stringify(dump))), { contentType: 'application/gzip', upsert: true });
  if (up.error) throw new Error(up.error.message);
  const { data: files } = await db.storage.from('backups').list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
  const old = (files || []).filter((f) => f.name.startsWith('portal-')).slice(KEEP).map((f) => f.name);
  if (old.length) await db.storage.from('backups').remove(old);
  await audit(by, 'backup_created', name, { counts, failed });
  return { name, counts, failed };
}

export async function listBackups() {
  const { data } = await admin().storage.from('backups').list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
  return (data || []).filter((f) => f.name.startsWith('portal-')).map((f) => ({ name: f.name, size: (f.metadata as { size?: number } | null)?.size ?? 0, at: f.created_at || f.updated_at || '' }));
}
