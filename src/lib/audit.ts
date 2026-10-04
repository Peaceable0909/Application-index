import { admin } from './supabase';

/** Records who did a sensitive admin action (access changes, backups, …). Never blocks the action itself. */
export async function audit(actor: string, action: string, target?: string | null, detail: Record<string, unknown> = {}) {
  try { await admin().from('portal_audit').insert({ actor, action, target: target || null, detail }); } catch { /* logging must not break the action */ }
}
