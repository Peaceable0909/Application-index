// Everything the Responsibilities page needs, read once: destinations, counselors, the rules and the checks on them, Team Heads, and the schools and
// locations that already exist (so the admin picks the exact spelling the applications use instead of typing it).
import { admin } from './supabase';
import { schoolDisplay, schoolKey } from './docs';
import { listWorkspaces } from './workspace';
import { loadCounselors, loadRules } from './assignCore';
import { normLocation, ruleProblems, type Rule, type RuleProblem, type Scope } from './assignEngine';

export type HeadScopeRow = Scope & { id: string; email: string; school_name: string | null; location_name: string | null };
export type AdminData = {
  workspaces: { key: string; name: string; auto_route: boolean; active: boolean }[];
  counselors: { key: string; name: string; active: boolean }[];
  rules: Rule[]; problems: RuleProblem[];
  heads: { email: string; name: string; role: string; scopes: HeadScopeRow[] }[];
  team: { email: string; name: string; role: string }[];
  schools: Record<string, string[]>; cities: Record<string, string[]>;
  waiting: Record<string, number>;
};

export async function loadAdminData(): Promise<AdminData> {
  const db = admin();
  const [wss, counselors, rules, { data: wsRows }, { data: scopes }, { data: staff }, { data: apps }, { data: flows }] = await Promise.all([
    listWorkspaces(), loadCounselors(db), loadRules(db),
    db.from('portal_workspaces').select('key, auto_route'),
    db.from('portal_head_scopes').select('id, email, workspace, scope, school_key, school_name, location_key, location_name').order('created_at'),
    db.from('portal_staff').select('email, role, display_name, team_head').order('email'),
    db.from('portal_applications').select('workspace, school, city, counselor').limit(5000),
    db.from('portal_workflows').select('workspace, school_name'),
  ]);
  const auto = new Map((wsRows || []).map((w) => [w.key as string, w.auto_route !== false]));

  const schools: Record<string, Map<string, string>> = {}, cities: Record<string, Map<string, string>> = {};
  const put = (m: Record<string, Map<string, string>>, ws: string, key: string, label: string) => { if (!key) return; (m[ws] ||= new Map()); if (!m[ws].has(key)) m[ws].set(key, label); };
  for (const a of apps || []) {
    if (a.school) put(schools, a.workspace as string, schoolKey(a.school as string), schoolDisplay(a.school as string) || (a.school as string));
    if (a.city) put(cities, a.workspace as string, normLocation(a.city as string), String(a.city).trim());
  }
  for (const f of flows || []) if (f.school_name) put(schools, f.workspace as string, schoolKey(f.school_name as string), schoolDisplay(f.school_name as string) || (f.school_name as string));
  for (const r of rules) { if (r.school_key) put(schools, r.workspace, r.school_key, r.school_name || r.school_key); if (r.location_key) put(cities, r.workspace, r.location_key, r.location_name || r.location_key); }
  const flat = (m: Record<string, Map<string, string>>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v.values()].sort((a, b) => a.localeCompare(b))]));

  const people = (staff || []).map((p) => ({ email: p.email as string, name: (p.display_name as string | null) || (p.email as string), role: p.role as string, head: !!p.team_head }));
  const heads = people.filter((p) => p.head).map((p) => ({ email: p.email, name: p.name, role: p.role, scopes: ((scopes || []) as HeadScopeRow[]).filter((s) => s.email.toLowerCase() === p.email.toLowerCase()) }));

  const waiting: Record<string, number> = {};
  const { data: q } = await db.from('portal_applications').select('workspace').in('assign_state', ['queue', 'conflict']).limit(1000);
  (q || []).forEach((r) => { waiting[r.workspace as string] = (waiting[r.workspace as string] || 0) + 1; });

  return {
    workspaces: wss.map((w) => ({ key: w.key, name: w.name, active: w.active, auto_route: auto.get(w.key) !== false })),
    counselors: [...counselors].map(([key, c]) => ({ key, name: c.name, active: c.active })).sort((a, b) => a.name.localeCompare(b.name)),
    rules, problems: ruleProblems(rules, counselors),
    heads, team: people.map((p) => ({ email: p.email, name: p.name, role: p.role })),
    schools: flat(schools), cities: flat(cities), waiting,
  };
}
