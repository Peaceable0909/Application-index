import { currentWorkspace } from './workspace';
import { admin } from './supabase';
import { docScanEnabled, scanOne } from './docscan';

export const dailyLimit = () => Number(process.env.AI_DAILY_LIMIT || 60);

type Doc = { drive_file_id: string; application_id: string; doc_type: string; type_override: string | null; name: string };

async function allDocs(): Promise<Doc[]> {
  const db = admin(), ws = await currentWorkspace(), out: Doc[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('portal_documents').select('drive_file_id, application_id, doc_type, type_override, name, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).order('drive_file_id').range(from, from + 999);
    out.push(...((data || []) as Doc[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function scannedIds(): Promise<Set<string>> {
  const db = admin(), out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('portal_doc_scans').select('drive_file_id').order('drive_file_id').range(from, from + 999);
    (data || []).forEach((r) => out.add(r.drive_file_id));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function usedToday(): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await admin().from('portal_ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());
  return count || 0;
}

/** Where the document check stands across every student. */
export async function scanStatus() {
  const [docs, done, used] = await Promise.all([allDocs(), scannedIds(), usedToday()]);
  const left = docs.filter((d) => !done.has(d.drive_file_id));
  const other = left.filter((d) => (d.type_override || d.doc_type) === 'Other').length;
  const limit = dailyLimit();
  return { total: docs.length, checked: docs.length - left.length, unchecked: left.length, uncheckedOther: other, used, limit, budget: Math.max(0, limit - used) };
}

// A problem with this one file (so it can be marked "couldn't read" and skipped), not with the service.
const FILE_PROBLEM = /too large|not found|no access|permission|unsupported|cannot be read|can't be read|not a/i;

/** Checks the next few unchecked documents, files filed as "Other" first. Returns what happened so the page can keep going. */
export async function scanNext(actor: string, o: { skip?: string[]; max?: number; budgetMs?: number } = {}) {
  if (!docScanEnabled()) return { ok: 0, flagged: 0, failed: [] as { id: string; error: string }[], stop: 'off' as const, left: 0, budget: 0 };
  const db = admin(), started = Date.now(), skip = new Set(o.skip || []);
  const [docs, done, used] = await Promise.all([allDocs(), scannedIds(), usedToday()]);
  const eff = (d: Doc) => d.type_override || d.doc_type;
  const queue = docs.filter((d) => !done.has(d.drive_file_id) && !skip.has(d.drive_file_id)).sort((a, b) => Number(eff(b) === 'Other') - Number(eff(a) === 'Other'));
  const budget = Math.max(0, dailyLimit() - used);
  const names = new Map<string, string>();
  const ids = [...new Set(queue.slice(0, 12).map((d) => d.application_id))];
  if (ids.length) { const { data } = await db.from('portal_applications').select('application_id, name').in('application_id', ids); (data || []).forEach((r) => names.set(r.application_id, r.name)); }

  let ok = 0, flagged = 0, stop: 'limit' | 'time' | null = budget <= 0 ? 'limit' : null;
  const failed: { id: string; error: string }[] = [];
  // Three files at a time: Google's text recognition and the AI both wait on the network, so reading side by side is about three times faster.
  const batch = queue.slice(0, Math.min(o.max ?? 6, budget));
  for (let i = 0; i < batch.length && !stop; i += 3) {
    if (Date.now() - started > (o.budgetMs ?? 35_000)) { stop = 'time'; break; }
    const wave = batch.slice(i, i + 3);
    const results = await Promise.allSettled(wave.map((d) => scanOne({ appId: d.application_id, fileId: d.drive_file_id, filedAs: eff(d), studentName: names.get(d.application_id) || '', actor })));
    for (let k = 0; k < wave.length; k++) {
      const d = wave[k], res = results[k];
      if (res.status === 'fulfilled') { ok++; if (res.value.flags.length) flagged++; continue; }
      const msg = (res.reason as Error)?.message || 'Failed';
      if (/Daily AI limit/i.test(msg)) { stop = 'limit'; continue; }
      if (FILE_PROBLEM.test(msg)) {
        await db.from('portal_doc_scans').upsert({ drive_file_id: d.drive_file_id, application_id: d.application_id, detected_type: null, confidence: null, person_name: null, issuer: null, expiry_date: null, readable: false, method: 'unreadable', flags: [{ kind: 'unreadable', text: `Couldn’t check this file: ${msg}` }], scanned_by: actor, created_at: new Date().toISOString() }, { onConflict: 'drive_file_id' });
        ok++;
      } else failed.push({ id: d.drive_file_id, error: msg });
    }
  }
  const left = queue.length - ok - failed.length;
  return { ok, flagged, failed, stop, left: Math.max(0, left), budget: Math.max(0, budget - ok - failed.length) };
}

export type Suggestion = { fileId: string; appId: string; student: string; file: string; filedAs: string; detected: string; confidence: number };

/** Files whose filed type differs from what the reader sees, ready to accept. Files filed as "Other" come first. */
export async function typeSuggestions(): Promise<Suggestion[]> {
  const db = admin(), ws = await currentWorkspace();
  const { data: scans } = await db.from('portal_doc_scans').select('drive_file_id, application_id, detected_type, confidence, flags, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).eq('readable', true).not('detected_type', 'is', null).limit(2000);
  const cand = (scans || []).filter((s) => Array.isArray(s.flags) && (s.flags as { kind: string }[]).some((f) => f.kind === 'type') && s.detected_type && s.detected_type !== 'Other');
  if (!cand.length) return [];
  const out: Suggestion[] = [];
  for (let i = 0; i < cand.length; i += 100) {
    const part = cand.slice(i, i + 100), ids = part.map((c) => c.drive_file_id), apps = [...new Set(part.map((c) => c.application_id))];
    const [{ data: docs }, { data: as }] = await Promise.all([
      db.from('portal_documents').select('drive_file_id, name, doc_type, type_override').in('drive_file_id', ids),
      db.from('portal_applications').select('application_id, name').in('application_id', apps),
    ]);
    const dm = new Map((docs || []).map((d) => [d.drive_file_id, d])), am = new Map((as || []).map((a) => [a.application_id, a.name]));
    for (const c of part) {
      const d = dm.get(c.drive_file_id); if (!d) continue;
      const filed = d.type_override || d.doc_type;
      if (filed === c.detected_type) continue; // already accepted
      out.push({ fileId: c.drive_file_id, appId: c.application_id, student: am.get(c.application_id) || '—', file: d.name, filedAs: filed, detected: c.detected_type as string, confidence: Number(c.confidence) || 0 });
    }
  }
  return out.sort((a, b) => Number(b.filedAs === 'Other') - Number(a.filedAs === 'Other') || b.confidence - a.confidence);
}

export type Quality = { checked: number; mrz: number; ai: number; unreadable: number; byType: { type: string; n: number; unreadable: number }[]; worst: { fileId: string; appId: string; student: string; file: string; filedAs: string }[] };

/** How well the reader is doing in this workspace: how many files it read exactly (passports), with AI, or could not read at all, and which kinds fail most. */
export async function scanQuality(): Promise<Quality> {
  const db = admin(), ws = await currentWorkspace();
  const rows: { drive_file_id: string; application_id: string; detected_type: string | null; readable: boolean; method: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('portal_doc_scans').select('drive_file_id, application_id, detected_type, readable, method, portal_applications!inner(workspace)').eq('portal_applications.workspace', ws).order('drive_file_id').range(from, from + 999);
    rows.push(...((data || []) as unknown as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const bad = rows.filter((r) => !r.readable);
  const types = new Map<string, { n: number; unreadable: number }>();
  const ids = bad.map((r) => r.drive_file_id);
  const docs = new Map<string, { name: string; filed: string; app: string }>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await db.from('portal_documents').select('drive_file_id, name, doc_type, type_override, application_id').in('drive_file_id', ids.slice(i, i + 100));
    (data || []).forEach((d) => docs.set(d.drive_file_id, { name: d.name, filed: d.type_override || d.doc_type, app: d.application_id }));
  }
  rows.forEach((r) => { const t = r.readable ? r.detected_type || 'Other' : docs.get(r.drive_file_id)?.filed || 'Other'; const c = types.get(t) || { n: 0, unreadable: 0 }; c.n++; if (!r.readable) c.unreadable++; types.set(t, c); });
  const worstIds = bad.slice(0, 8), apps = [...new Set(worstIds.map((r) => r.application_id))];
  const { data: names } = apps.length ? await db.from('portal_applications').select('application_id, name').in('application_id', apps) : { data: [] };
  const nm = new Map((names || []).map((a) => [a.application_id, a.name]));
  return {
    checked: rows.length, mrz: rows.filter((r) => r.method === 'mrz').length, ai: rows.filter((r) => r.method === 'ai').length, unreadable: bad.length,
    byType: [...types].map(([type, c]) => ({ type, ...c })).sort((a, b) => b.unreadable - a.unreadable || b.n - a.n).slice(0, 8),
    worst: worstIds.map((r) => ({ fileId: r.drive_file_id, appId: r.application_id, student: nm.get(r.application_id) || '—', file: docs.get(r.drive_file_id)?.name || '', filedAs: docs.get(r.drive_file_id)?.filed || '' })),
  };
}
