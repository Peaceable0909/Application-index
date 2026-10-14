// Shared by the move actions and by the nightly sync: reading rows, writing Sheet1, and saving a move in the portal.
import { admin } from './supabase';
import { callScript } from './appsScript';
import { progressFor, schoolDisplay, schoolKey, schoolShort, studentKey } from './docs';
import { progKey, sheetProgramme, sheetSchool, type Moved, type Pair } from './moves';

export type Snap = { email: string; name: string; school: string; programme?: string };
export type Row = {
  application_id: string; name: string; email: string | null; school: string | null; programme: string | null; status: string | null; student_key: string; counselor: string | null;
  moved: Moved | null; in_master: boolean; in_regent: boolean; has_raw: boolean; master_data: Snap | null; regent_data: Snap | null; raw_data: Snap | null; preferred_name: string | null;
};
export type Group = { key: string; rows: Row[]; lead: Row };
export type Light = { application_id: string; name: string; email: string | null; school: string | null; programme: string | null; student_key: string };

export const COLS = 'application_id, name, email, school, programme, status, student_key, counselor, moved, in_master, in_regent, has_raw, master_data, regent_data, raw_data, preferred_name';
export const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function rowsBy(col: 'application_id' | 'student_key', vals: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (const c of chunk(vals, 40)) { const { data } = await admin().from('portal_applications').select(COLS).in(col, c); out.push(...((data || []) as Row[])); }
  return out;
}
export async function log(applicationId: string, actor: string, kind: string, detail: object): Promise<string> {
  const db = admin();
  const { data } = await db.from('portal_activity').insert({ application_id: applicationId, actor, kind, detail }).select('id').single();
  await db.from('portal_applications').update({ last_activity_at: new Date().toISOString() }).eq('application_id', applicationId);
  return (data?.id as string) || '';
}
export const display = (s: string | null) => schoolDisplay(s) || s || null;


// ---------------------------------------------------------------- the sheet

export type SheetState = 'updated' | 'pending' | 'none';
/**
 * Writes the change into Sheet1. The Apps Script says which fields it actually wrote ("applied"); an older script
 * ignores school and programme without saying so, and we must not pretend it worked.
 */
export async function writeSheet(lead: Row, fields: Record<string, string>, by: string): Promise<{ state: SheetState; note?: string; applied: Set<string> }> {
  const keys = Object.keys(fields);
  if (!keys.length) return { state: 'none', applied: new Set() };
  const need = keys.filter((k) => k === 'school' || k === 'programme');
  try {
    if (lead.in_master && lead.master_data) {
      const m = lead.master_data;
      const r = await callScript<{ row: number; applied?: string[] }>('updateMaster', { email: m.email, name: m.name, school: m.school, fields, by });
      const applied = new Set(r?.applied ?? keys.filter((k) => k === 'status'));
      if (need.every((k) => applied.has(k))) return { state: need.length ? 'updated' : 'none', applied };
      return { state: 'pending', note: 'Sheet1 was not changed: the Apps Script needs its new version.', applied };
    }
    if (lead.has_raw && fields.status) { await callScript('updateRow', { applicationId: lead.application_id, fields: { status: fields.status }, by }); return { state: 'none', applied: new Set(['status']) }; }
  } catch (e) { return { state: 'pending', note: (e as Error).message, applied: new Set() }; }
  return { state: 'none', applied: new Set() };
}

/** What the sheets would show once the portal's own override is taken away. */
export const pairFor = (kind: 'school' | 'programme', to: string | null, sheet: string | null): Pair | null => {
  if (!to) return null;
  const same = kind === 'school' ? schoolKey(to) === schoolKey(sheet) : progKey(to) === progKey(sheet);
  return sheet && same ? null : { to, from: sheet };
};

/** Saves one application's new school/programme/status in the portal, with the override that keeps it through the next sync. */
export async function commitRow(r: Row, to: { school: string | null; programme: string | null; status: string | null }, by: string, at: string, sheet: boolean | undefined) {
  const school = to.school ? display(to.school) : null;
  const moved: Moved | null = (() => {
    const s = pairFor('school', school, sheetSchool(r)), p = pairFor('programme', to.programme, sheetProgramme(r));
    return s || p ? { school: s, programme: p, at, by, ...(sheet === undefined ? {} : { sheet }) } : null;
  })();
  const patch: Record<string, unknown> = { school, programme: to.programme, student_key: studentKey(r.email, school, r.name), moved, master_data: r.master_data };
  if (to.status !== r.status) { patch.status = to.status; patch.progress = progressFor(to.status); }
  await admin().from('portal_applications').update(patch).eq('application_id', r.application_id);
}


/**
 * Writes one student's school/programme (as the portal now shows them) into Sheet1, if Sheet1 differs.
 * Used for "Update Sheet1" and, automatically, by the nightly sync for moves the sheet missed.
 */
export async function pushOne(a: Row, by: string): Promise<{ ok: boolean; error?: string }> {
  if (!a.in_master || !a.master_data) return { ok: false, error: 'This student is not in Sheet1.' };
  const fields: Record<string, string> = {};
  if (a.school && schoolKey(a.school) !== schoolKey(a.master_data.school)) fields.school = schoolShort(a.school);
  if (a.programme && progKey(a.programme) !== progKey(a.master_data.programme)) fields.programme = a.programme;
  if (!Object.keys(fields).length) return { ok: true };
  const r = await writeSheet(a, fields, by);
  if (r.state !== 'updated') return { ok: false, error: r.note || 'Sheet1 was not changed.' };
  const at = new Date().toISOString();
  for (const s of await rowsBy('student_key', [a.student_key])) {
    if (!s.in_master || !s.master_data) continue;
    s.master_data = { ...s.master_data, ...(fields.school ? { school: fields.school } : {}), ...(fields.programme ? { programme: fields.programme } : {}) };
    await commitRow(s, { school: s.school, programme: s.programme, status: s.status }, by, at, true);
  }
  await log(a.application_id, by, 'move_sheet_updated', fields);
  return { ok: true };
}

/** Moves that reached the portal but not Sheet1 (the script was old, or time ran out). Tries a few at a time. */
export async function pushPendingMoves(opts: { max?: number; budgetMs?: number } = {}): Promise<{ tried: number; done: number }> {
  const t0 = Date.now(), max = opts.max ?? 6, budget = opts.budgetMs ?? 8_000;   // small: it runs inside the nightly sync, which has a 60 second limit
  const { data } = await admin().from('portal_applications').select(COLS).not('moved', 'is', null);
  const pending = ((data || []) as Row[]).filter((a) => a.in_master && a.moved?.sheet === false);
  const seen = new Set<string>();
  let tried = 0, done = 0;
  for (const a of pending) {
    if (tried >= max || Date.now() - t0 > budget) break;
    if (seen.has(a.student_key)) continue;
    seen.add(a.student_key); tried++;
    try { if ((await pushOne(a, 'sync')).ok) done++; } catch { /* stays pending; the next sync tries again */ }
  }
  return { tried, done };
}
