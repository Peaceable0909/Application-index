// Moving students between schools and changing their programme.
// Pure functions only (no database), so the browser and the server can both use them:
//  - tidy, de-duplicated names (so "regent", "RCL" and "Regent College London (RCL)" are one school),
//  - the override that makes a move survive the nightly sync, and the rule that ends it,
//  - the small checks the move sheet shows before anything is saved.
import { schoolDisplay, schoolKey } from './docs';

export type Kind = 'school' | 'programme';
export type MoveReason = 'fix' | 'switch';
/** to = what the portal should show. from = what the sheets said when the move was made (null when they said nothing). */
export type Pair = { to: string; from: string | null };
export type Moved = { school?: Pair | null; programme?: Pair | null; at?: string; by?: string; sheet?: boolean };

/** First usable value: trimmed, and the form's "N/A" counts as nothing. */
export const pick = (...v: (string | null | undefined)[]) => v.map((x) => (x || '').trim()).find((x) => x && x.toUpperCase() !== 'N/A') || null;

export const progKey = (p: string | null | undefined) => (p || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const same = (k: Kind, a: string | null, b: string | null) => (k === 'school' ? schoolKey(a) === schoolKey(b) : progKey(a) === progKey(b));

// ---------------------------------------------------------------- the override and the sync

export type Resolved = { value: string | null; pair: Pair | null; dropped?: 'agrees' | 'sheet-changed' };

/**
 * What a sync should show for one field.
 *  - no move on record: the sheet's value, as always
 *  - the sheet has nothing to say: keep the move
 *  - the sheet now says the same thing: the move did its job, hand the field back to the sheet
 *  - the sheet still says what it said when we moved: keep the move (the form log, for one, never changes)
 *  - the sheet says something else: someone edited the sheet after the move, so the sheet wins
 */
export function resolveField(k: Kind, sheet: string | null, p?: Pair | null): Resolved {
  if (!p) return { value: sheet, pair: null };
  if (!sheet) return { value: p.to, pair: p };
  if (same(k, sheet, p.to)) return { value: sheet, pair: null, dropped: 'agrees' };
  if (p.from !== null && same(k, sheet, p.from)) return { value: p.to, pair: p };
  return { value: sheet, pair: null, dropped: 'sheet-changed' };
}

export function resolveMoved(sheet: { school: string | null; programme: string | null }, moved: Moved | null | undefined) {
  const s = resolveField('school', sheet.school, moved?.school), p = resolveField('programme', sheet.programme, moved?.programme);
  const next: Moved | null = s.pair || p.pair ? { ...moved, school: s.pair, programme: p.pair } : null;
  const dropped = ([['school', s.dropped], ['programme', p.dropped]] as [Kind, Resolved['dropped']][]).filter(([, why]) => !!why).map(([kind, why]) => ({ kind, why: why! }));
  return { school: s.value, programme: p.value, moved: next, dropped };
}

type Sheety = { raw_data?: { school?: string | null; programme?: string | null } | null; master_data?: { school?: string | null; programme?: string | null } | null; regent_data?: { school?: string | null; programme?: string | null } | null };
/** What the sheets say about this application, in the same order of trust the sync uses (form, then Sheet1, then Regent Only). */
export const sheetSchool = (a: Sheety) => schoolDisplay(pick(a.raw_data?.school, a.master_data?.school, a.regent_data?.school));
export const sheetProgramme = (a: Sheety) => pick(a.master_data?.programme, a.regent_data?.programme, a.raw_data?.programme);

// ---------------------------------------------------------------- names

const SMALL = /^(of|the|and|in|for|at|to|on)$/;
const KEEP_UPPER: Record<string, string> = { msc: 'MSc', bsc: 'BSc', ma: 'MA', ba: 'BA', mba: 'MBA', mres: 'MRes', mphil: 'MPhil', phd: 'PhD', llm: 'LLM', llb: 'LLB', mpa: 'MPA', mph: 'MPH', meng: 'MEng', beng: 'BEng', pgdip: 'PGDip', pgcert: 'PGCert', hnd: 'HND', bpp: 'BPP', rcl: 'RCL', cccu: 'CCCU', uk: 'UK', usa: 'USA', it: 'IT', ai: 'AI' };

/** Collapses spaces. Names typed all in lower case get capitals; anything with a capital in it is left as the person wrote it. */
export function tidyName(s: string): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (!t || /[A-Z]/.test(t)) return t;
  return t.replace(/[a-z][a-z']*/g, (w, off: number) => KEEP_UPPER[w] || (off > 0 && SMALL.test(w) ? w : w[0].toUpperCase() + w.slice(1)));
}

export type CatalogSchool = { name: string; key: string; n: number; programmes: { name: string; n: number }[] };
export type Catalog = { schools: CatalogSchool[] };

/** Every school and programme in use, with how many students have it. One spelling per school/programme: the most used one. */
export function buildCatalog(rows: { school: string | null; programme: string | null; student_key?: string | null }[]): Catalog {
  type PB = { variants: Map<string, number>; people: Set<string> };
  const by = new Map<string, PB & { progs: Map<string, PB> }>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  rows.forEach((r, i) => {
    const disp = schoolDisplay(r.school), k = schoolKey(disp);
    if (!disp || !k) return;
    const who = r.student_key || `#${i}`;
    let b = by.get(k);
    if (!b) by.set(k, (b = { variants: new Map(), people: new Set(), progs: new Map() }));
    bump(b.variants, disp); b.people.add(who);
    const prog = pick(r.programme), pk = progKey(prog);
    if (!prog || !pk) return;
    let pb = b.progs.get(pk);
    if (!pb) b.progs.set(pk, (pb = { variants: new Map(), people: new Set() }));
    bump(pb.variants, prog); pb.people.add(who);
  });
  // the most used spelling wins; on a tie prefer one with capitals, then the longer (fuller) one
  const caps = (x: string) => (x === x.toLowerCase() ? 0 : 1);
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || caps(b[0]) - caps(a[0]) || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0][0];
  const byCount = <T extends { n: number; name: string }>(a: T, b: T) => b.n - a.n || a.name.localeCompare(b.name);
  return { schools: [...by].map(([key, b]) => ({ name: top(b.variants), key, n: b.people.size, programmes: [...b.progs.values()].map((p) => ({ name: top(p.variants), n: p.people.size })).sort(byCount) })).sort(byCount) };
}

/** The school's name as the portal already spells it. A school nobody has used yet keeps the typed name (tidied). */
export function canonicalSchool(input: string, cat: Catalog): string {
  const t = tidyName(input);
  if (!t) return '';
  const hit = cat.schools.find((s) => s.key === schoolKey(t));
  return hit ? hit.name : schoolDisplay(t) || t;
}

/** The programme's name as the portal already spells it: first at that school, then anywhere. */
export function canonicalProgramme(input: string, schoolK: string, cat: Catalog): string {
  const t = tidyName(input);
  if (!t || t.toUpperCase() === 'N/A') return '';
  const k = progKey(t), at = (s?: CatalogSchool) => s?.programmes.find((p) => progKey(p.name) === k)?.name;
  return at(cat.schools.find((s) => s.key === schoolK)) || cat.schools.map(at).find(Boolean) || t;
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}

/** Names already in use that are nearly the same as what was typed ("Did you mean…"). Exact matches are not "nearly". */
export function nearest(input: string, names: string[], max = 3): string[] {
  const k = progKey(input);
  if (k.length < 3) return [];
  return names.map((n) => {
    const nk = progKey(n);
    if (!nk || nk === k) return { n, s: 0 };
    return { n, s: Math.max(1 - lev(k, nk) / Math.max(k.length, nk.length), nk.includes(k) || k.includes(nk) ? 0.8 : 0) };
  }).filter((x) => x.s >= 0.72).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.n);
}

/** Case-insensitive "contains" match for the suggestion chips, best matches first. */
export function suggest<T extends { name: string; n: number }>(items: T[], typed: string, max = 6): T[] {
  const q = progKey(typed);
  const hits = q ? items.filter((i) => progKey(i.name).includes(q) || q.split(' ').every((w) => progKey(i.name).includes(w))) : items;
  return hits.slice(0, max);
}

// ---------------------------------------------------------------- what a move means for the rest of the record

const RESET_FROM = new Set(['Offer Received', 'Interview Taken', 'Interview Passed', 'Unconditional Offer', 'CAS Applied', 'CAS Received', 'Visa Applied', 'Enrolled', 'Awaiting CAS', 'CAS Request', 'Rejected', 'Withdrawn']);
/** A student who is switching schools starts the new application again: an offer or CAS from the old school does not carry over. */
export function statusDefault(current: string | null, reason: MoveReason): string | null {
  return reason === 'switch' && current && RESET_FROM.has(current) ? 'Documents Requested' : null;
}

type OfferLike = { offer_type?: string | null; offer_date?: string | null; conditions?: unknown[] | null; deposit_due?: string | null; cas_status?: string | null; visa_status?: string | null } | null | undefined;
/** True when an offer, CAS or visa has actually been recorded (an empty row does not count). */
export const offerHasData = (o: OfferLike) => !!o && !!(o.offer_type || o.offer_date || (o.conditions || []).length || o.deposit_due || (o.cas_status && o.cas_status !== 'Not started') || (o.visa_status && o.visa_status !== 'Not started'));

// ---------------------------------------------------------------- shapes shared by the move sheet and the server

/** status: '' keeps each student's status, RESET_STATUS restarts those whose status belonged to the old school, anything else sets that status. */
export const RESET_STATUS = '__reset';
export type MoveInput = { ids: string[]; school: string; programme: string; reason: MoveReason; status?: string };
export type ApplyInput = MoveInput & { clearOffer: boolean; notify: boolean; email: boolean };
export type Note = { tone: 'stop' | 'warn' | 'info'; text: string; href?: string };
export type PlanRow = {
  key: string; ids: string[]; primary: string; name: string; status: string | null; toStatus: string | null;
  fromSchool: string | null; fromProgramme: string | null; toSchool: string | null; toProgramme: string | null;
  state: 'ok' | 'nochange' | 'blocked'; notes: Note[]; hasOffer: boolean; inRegent: boolean; inMaster: boolean; canNotify: boolean;
};
export type Preview = {
  ok: true; toSchool: string | null; toProgramme: string | null; schoolIsNew: boolean; programmeIsNew: boolean;
  similarSchools: string[]; similarProgrammes: string[]; rows: PlanRow[];
  anyOffer: boolean; anyNotify: boolean; skipped: number;
} | { ok: false; error: string };
export type Outcome = { key: string; name: string; primary: string; result: 'moved' | 'nochange' | 'blocked' | 'failed'; sheet: 'updated' | 'pending' | 'none'; note?: string; undo?: string };
export type Applied = { ok: true; outcomes: Outcome[]; moved: number; sheetPending: number; undo: string[]; left: number } | { ok: false; error: string };

/** The line shown for a move in a student's activity timeline. */
export function moveTitle(d: { from?: { school?: string | null; programme?: string | null }; to?: { school?: string | null; programme?: string | null } }): string {
  const f = d.from || {}, t = d.to || {};
  const school = schoolKey(f.school || null) !== schoolKey(t.school || null), prog = progKey(f.programme) !== progKey(t.programme);
  if (school && prog) return `Moved to ${t.school || 'another school'} · ${t.programme || 'no programme'}`;
  if (school) return `Moved to ${t.school || 'another school'}`;
  if (prog) return `Programme changed to ${t.programme || 'none'}`;
  return 'School or programme updated';
}
