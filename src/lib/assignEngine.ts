// Who should own a new application, decided by the responsibilities admins have set (no database in here, so every rule can be tested alone).
//
// A responsibility ("rule") says a counselor is responsible for one school, for a whole destination (workspace), or for a location, as the
// primary or as a backup, for receiving the application or for handling its documents. The order is fixed:
//   1. the application's school   2. its destination (country)   3. its location   4. nobody: the Team Head / admin queue
// Within one level: exactly one available primary gets it; no primary but one backup, the backup gets it; two different primaries (or two
// backups with no primary) is a conflict for a person to resolve. Nothing here ever picks at random and nothing overwrites an existing owner.
import { counselorKey, schoolKey } from './docs';

export type Level = 'school' | 'country' | 'location';
export type Kind = 'application' | 'documents';
export type Role = 'primary' | 'backup';

export type Rule = {
  id: string; workspace: string; kind: Kind; scope: Level;
  school_key: string | null; school_name?: string | null; location_key: string | null; location_name?: string | null;
  counselor_key: string; role: Role; active: boolean; paused_until: string | null; note?: string | null;
};
export type CounselorInfo = { name: string; active: boolean };
export type AppFacts = { workspace: string; school: string | null; city: string | null };

export type Candidate = { rule_id: string; counselor_key: string; name: string; role: Role };
export type Decision =
  | { kind: 'assigned'; level: Level; counselor_key: string; name: string; rule_id: string; role: Role; reason: string }
  | { kind: 'conflict'; level: Level; candidates: Candidate[]; reason: string }
  | { kind: 'queue'; reason: string };

const LEVELS: Level[] = ['school', 'country', 'location'];
const LEVEL_WORD: Record<Level, string> = { school: 'school', country: 'destination', location: 'location' };

/** "Lagos", "LAGOS", "lagos state" and "Lagos." are the same place. Typos are not guessed: an admin can add a rule for the spelling they see. */
export function normLocation(city: string | null | undefined): string {
  return (city || '').toLowerCase().replace(/\b(state|city|lga|metropolis)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** The form lets a student pick "I don't have a counselor yet": that is not an owner. */
export const isPlaceholderCounselor = (name: string | null | undefined) => {
  const t = (name || '').trim();
  return !t || /^(none|n\/?a|nil|-+|unassigned|not (sure|applicable)|i (do not|don'?t) have|no counsel+or|nobody|tbd)/i.test(t) || /don'?t have a counsel+or/i.test(t);
};

/** Today as YYYY-MM-DD (UTC), the form a rule's `paused_until` date is kept in. */
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

/** A rule applies today when it is switched on and not paused: "paused until 1 Nov" means off through 31 Oct and back on from 1 Nov. */
export const ruleIsLive = (r: Rule, now = Date.now()) => r.active && !(r.paused_until && r.paused_until > day(now));

function matches(r: Rule, level: Level, app: AppFacts): boolean {
  if (r.scope !== level || r.workspace !== app.workspace) return false;
  if (level === 'school') return !!r.school_key && r.school_key === schoolKey(app.school);
  if (level === 'location') return !!r.location_key && r.location_key === normLocation(app.city);
  return true;
}

const target = (level: Level, app: AppFacts, rules: Rule[]) => {
  if (level === 'school') return rules.find((r) => r.school_name)?.school_name || app.school || 'this school';
  if (level === 'location') return rules.find((r) => r.location_name)?.location_name || app.city || 'this location';
  return 'this destination';
};

/**
 * Decides who is responsible. `kind` picks which responsibility is being resolved: owning the application, or receiving its documents.
 * `counselors` is every counselor known to the portal; a rule whose counselor is missing or switched off is treated as unavailable.
 */
export function resolveAssignment(rules: Rule[], app: AppFacts, counselors: Map<string, CounselorInfo>, o: { kind?: Kind; now?: number } = {}): Decision {
  const kind = o.kind ?? 'application', now = o.now ?? Date.now();
  const notes: string[] = [], absent: Level[] = [];
  let anyRule = false;
  for (const level of LEVELS) {
    const here = rules.filter((r) => r.kind === kind && matches(r, level, app));
    if (!here.length) { absent.push(level); continue; }
    anyRule = true;
    const name = (k: string) => counselors.get(k)?.name || k;
    const usable = here.filter((r) => ruleIsLive(r, now) && counselors.get(r.counselor_key)?.active);
    const unusable = here.filter((r) => !usable.includes(r));
    const label = target(level, app, here);
    const skippedNote = unusable.length ? `${[...new Set(unusable.map((r) => name(r.counselor_key)))].join(', ')} ${unusable.length === 1 ? 'is' : 'are'} unavailable` : '';
    // one entry per counselor, a primary wins over a backup
    const by = new Map<string, Candidate>();
    for (const r of usable) { const cur = by.get(r.counselor_key); if (!cur || (cur.role === 'backup' && r.role === 'primary')) by.set(r.counselor_key, { rule_id: r.id, counselor_key: r.counselor_key, name: name(r.counselor_key), role: r.role }); }
    const primaries = [...by.values()].filter((c) => c.role === 'primary'), backups = [...by.values()].filter((c) => c.role === 'backup');
    const what = kind === 'documents' ? 'receives documents for' : 'is responsible for';
    // why this level decided: which rule, and what was looked at first
    const trail = [...(absent.length ? [`no ${absent.map((l) => LEVEL_WORD[l]).join(' or ')} rule applied`] : []), ...notes].join('; ');
    const via = `${LEVEL_WORD[level]} rule${trail ? `; ${trail}` : ''}`;
    if (primaries.length === 1) {
      const c = primaries[0];
      return { kind: 'assigned', level, counselor_key: c.counselor_key, name: c.name, rule_id: c.rule_id, role: 'primary', reason: `${c.name} ${what} ${label} (${via})` };
    }
    if (primaries.length > 1) return { kind: 'conflict', level, candidates: primaries, reason: `${primaries.map((c) => c.name).join(' and ')} are both primary for ${label}. A person has to choose.` };
    if (backups.length === 1) {
      const c = backups[0];
      return { kind: 'assigned', level, counselor_key: c.counselor_key, name: c.name, rule_id: c.rule_id, role: 'backup', reason: `${c.name} is the backup for ${label} (${via})${skippedNote ? ` because ${skippedNote}` : ' and there is no primary'}` };
    }
    if (backups.length > 1) return { kind: 'conflict', level, candidates: backups, reason: `${backups.map((c) => c.name).join(' and ')} are all backups for ${label} and no primary is available. A person has to choose.` };
    // every responsible counselor at this level is unavailable: say so and look at the next level
    notes.push(`the ${LEVEL_WORD[level]} rule was skipped because ${skippedNote || 'nobody is available'}`);
  }
  return { kind: 'queue', reason: anyRule ? `Every responsible counselor is unavailable (${notes.join('; ')}), so it needs a Team Head or admin.` : `No assignment rule covers this ${kind === 'documents' ? 'school' : 'school, destination or location'}, so it needs a Team Head or admin.` };
}

// ---- checks an admin sees on the rules page ----
export type RuleProblem = { rule_ids: string[]; level: 'conflict' | 'warning' | 'info'; text: string };

/** Things worth fixing in the current set of rules: two primaries for one target, a missing counselor, a backup with no primary, paused rules. */
export function ruleProblems(rules: Rule[], counselors: Map<string, CounselorInfo>, now = Date.now()): RuleProblem[] {
  const out: RuleProblem[] = [];
  const groups = new Map<string, Rule[]>();
  for (const r of rules) {
    const key = [r.workspace, r.kind, r.scope, r.scope === 'school' ? r.school_key : r.scope === 'location' ? r.location_key : ''].join('|');
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const nm = (k: string) => counselors.get(k)?.name || k;
  for (const g of groups.values()) {
    const r0 = g[0], what = r0.scope === 'school' ? r0.school_name || r0.school_key : r0.scope === 'location' ? r0.location_name || r0.location_key : 'the whole destination';
    const live = g.filter((r) => ruleIsLive(r, now));
    const prim = [...new Set(live.filter((r) => r.role === 'primary').map((r) => r.counselor_key))];
    if (prim.length > 1) out.push({ rule_ids: live.filter((r) => r.role === 'primary').map((r) => r.id), level: 'conflict', text: `${prim.map(nm).join(' and ')} are both primary for ${what} (${r0.kind === 'documents' ? 'documents' : 'applications'}). New applications will be flagged until one becomes the backup.` });
    if (live.length && !prim.length) out.push({ rule_ids: live.map((r) => r.id), level: 'warning', text: `${what} has a backup (${live.map((r) => nm(r.counselor_key)).join(', ')}) but no primary.` });
    for (const r of g) {
      if (!counselors.has(r.counselor_key)) out.push({ rule_ids: [r.id], level: 'warning', text: `${r.counselor_key} is not a counselor in the portal, so this rule for ${what} cannot assign anyone.` });
      else if (!counselors.get(r.counselor_key)!.active) out.push({ rule_ids: [r.id], level: 'warning', text: `${nm(r.counselor_key)} is switched off as a counselor, so their rule for ${what} is skipped.` });
      else if (r.active && r.paused_until && r.paused_until > day(now)) out.push({ rule_ids: [r.id], level: 'info', text: `${nm(r.counselor_key)}'s rule for ${what} is paused until ${r.paused_until}.` });
    }
  }
  return out;
}

// ---- for the Team Head dashboard ----
export type Review = 'queue' | 'conflict' | 'wrong-counselor' | 'counselor-unavailable' | null;

/** Whether an application that already has an owner needs a second look: the rules point elsewhere, or the owner is no longer available. */
export function needsReview(rules: Rule[], app: AppFacts & { counselor: string | null }, counselors: Map<string, CounselorInfo>, now = Date.now()): { review: Review; expected?: string } {
  if (isPlaceholderCounselor(app.counselor)) return { review: 'queue' };
  const cur = counselorKey(app.counselor);
  const info = counselors.get(cur);
  if (!info || !info.active) return { review: 'counselor-unavailable' };
  const d = resolveAssignment(rules, app, counselors, { now });
  if (d.kind === 'assigned' && d.counselor_key !== cur) return { review: 'wrong-counselor', expected: d.name };
  return { review: null };
}

/** Which of an admin's / Team Head's scopes covers an application (a scope is a school, a whole destination or a location). */
export type Scope = { workspace: string; scope: Level; school_key: string | null; location_key: string | null };
export const inScope = (scopes: Scope[], app: AppFacts) => scopes.some((s) => s.workspace === app.workspace && (s.scope === 'country' || (s.scope === 'school' && !!s.school_key && s.school_key === schoolKey(app.school)) || (s.scope === 'location' && !!s.location_key && s.location_key === normLocation(app.city))));
