// What a person handles, read from the assignment records (portal_assign_rules for counselors, portal_head_scopes for Team Heads).
// Those records are the one source of truth for operational responsibility: the profile never stores its own copy, so the two cannot disagree.
// Pure, so the wording and the merging are tested.

export type HandleRule = {
  workspace: string; kind: 'application' | 'documents'; scope: 'school' | 'country' | 'location';
  school_key: string | null; school_name?: string | null; location_key: string | null; location_name?: string | null;
  counselor_key: string; role: 'primary' | 'backup'; active: boolean; paused_until: string | null;
};
export type HandleScope = { workspace: string; scope: 'school' | 'country' | 'location'; school_key: string | null; school_name?: string | null; location_key: string | null; location_name?: string | null };

export type Kind = 'application' | 'documents';
export type HandleItem = {
  id: string; scope: 'school' | 'country' | 'location'; label: string; workspace: string; workspaceName: string;
  by: Partial<Record<Kind, 'primary' | 'backup'>>;
  /** Back on from this date: the rule is paused, so new applications are not routed here until then. */
  pausedUntil: string | null;
};
export type Handles = { countries: HandleItem[]; schools: HandleItem[]; locations: HandleItem[]; oversees: { id: string; scope: HandleItem['scope']; label: string; workspaceName: string }[]; any: boolean };

const nameOf = (names: Map<string, string>, ws: string) => names.get(ws) || ws.toUpperCase();
const labelOf = (r: HandleScope, names: Map<string, string>) =>
  r.scope === 'country' ? nameOf(names, r.workspace) : r.scope === 'school' ? (r.school_name || r.school_key || 'School') : (r.location_name || r.location_key || 'Location');
const targetKey = (r: HandleScope) => `${r.scope}|${r.workspace}|${r.scope === 'school' ? r.school_key : r.scope === 'location' ? r.location_key : ''}`;

export function buildHandles(o: { counselorKey: string | null; rules: HandleRule[]; scopes: HandleScope[]; workspaces: Map<string, string>; today: string }): Handles {
  const merged = new Map<string, HandleItem>();
  for (const r of o.rules) {
    if (!o.counselorKey || r.counselor_key !== o.counselorKey || !r.active) continue;
    const id = targetKey(r), paused = r.paused_until && r.paused_until > o.today ? r.paused_until : null;
    const cur = merged.get(id) || { id, scope: r.scope, label: labelOf(r, o.workspaces), workspace: r.workspace, workspaceName: nameOf(o.workspaces, r.workspace), by: {}, pausedUntil: null };
    // the strongest role wins when the same target is listed twice for one kind
    if (cur.by[r.kind] !== 'primary') cur.by[r.kind] = r.role;
    if (paused && (!cur.pausedUntil || paused > cur.pausedUntil)) cur.pausedUntil = paused;
    merged.set(id, cur);
  }
  const all = [...merged.values()].sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.label.localeCompare(b.label));
  const oversees = [...new Map(o.scopes.map((s) => [targetKey(s), { id: targetKey(s), scope: s.scope, label: labelOf(s, o.workspaces), workspaceName: nameOf(o.workspaces, s.workspace) }])).values()]
    .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.label.localeCompare(b.label));
  const pick = (s: HandleItem['scope']) => all.filter((x) => x.scope === s);
  return { countries: pick('country'), schools: pick('school'), locations: pick('location'), oversees, any: all.length > 0 || oversees.length > 0 };
}

/** "Primary · applications and documents", or "Primary for applications, backup for documents". */
export function roleLine(by: HandleItem['by']): string {
  const a = by.application, d = by.documents;
  const word = (r: 'primary' | 'backup') => (r === 'primary' ? 'Primary' : 'Backup');
  if (a && d) return a === d ? `${word(a)} · applications and documents` : `${word(a)} for applications, ${word(d).toLowerCase()} for documents`;
  if (a) return `${word(a)} · applications`;
  if (d) return `${word(d)} · documents`;
  return '';
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** One short line for a card: "UK · 3 schools · 2 locations". Empty when nothing is assigned. */
export function headline(h: Handles): string {
  const parts: string[] = [];
  const places = [...new Set([...h.countries, ...h.schools, ...h.locations].map((x) => x.workspaceName))];
  if (h.countries.length) parts.push(h.countries.map((c) => c.label).join(', '));
  else if (places.length) parts.push(places.join(', '));
  if (h.schools.length) parts.push(plural(h.schools.length, 'school'));
  if (h.locations.length) parts.push(plural(h.locations.length, 'location'));
  if (!parts.length && h.oversees.length) parts.push(`Oversees ${h.oversees.map((o) => o.label).join(', ')}`);
  return parts.join(' · ');
}
