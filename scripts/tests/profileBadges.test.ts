// Run with: npx tsx scripts/tests/profileBadges.test.ts  (pure)
import { badgeSpeech, cleanBadge, mayHold, splitEligible, toDef, visibleBadges, type BadgeDef } from '../../src/lib/staffBadges';
import { COVER_PRESETS, clampPos, coverBackground, coverPathFromUrl, sniffImage } from '../../src/lib/covers';
import { buildHandles, headline, roleLine, type HandleRule } from '../../src/lib/profileHandles';
import { isLocked, parseLocks, profileTextPatch, type TextFields } from '../../src/lib/profileRules';

let pass = 0, fail = 0;
const ok = (c: unknown, m: string) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`);

// ---------- badge input ----------
const input = { name: '  Country   Manager ', description: 'Runs the UK desk', color: 'purple', roles: ['counselor', 'admin', 'nonsense'], enabled: true, show_students: false };
const good = cleanBadge(input);
ok(good.ok, 'a normal badge is accepted');
if (good.ok) { eq(good.value.name, 'Country Manager', 'spaces are tidied'); eq(good.value.eligible_roles, ['admin', 'counselor'], 'unknown roles are dropped and the order is fixed'); }
ok(!cleanBadge({ ...input, name: '   ' }).ok, 'a badge needs a name');
ok(!cleanBadge({ ...input, name: 'x'.repeat(41) }).ok, 'a name over 40 characters is refused');
ok(!cleanBadge({ ...input, description: 'x'.repeat(241) }).ok, 'a meaning over 240 characters is refused');
ok(!cleanBadge({ ...input, color: 'pink' }).ok, 'only the five colours exist');
ok(!cleanBadge({ ...input, roles: ['nobody'] }).ok, 'at least one eligible role is needed');
const noMeaning = cleanBadge({ ...input, description: '  ', enabled: true });
ok(!noMeaning.ok && /means/.test(noMeaning.ok ? '' : noMeaning.error), 'a badge cannot be switched on without a meaning');
ok(cleanBadge({ ...input, description: '', enabled: false }).ok, 'a badge can be saved off while its meaning is still being written');
for (const c of ['blue', 'red', 'yellow', 'green', 'purple']) ok(cleanBadge({ ...input, color: c }).ok, `${c} is a colour`);

// ---------- who shows what ----------
const def = (o: Partial<BadgeDef> & { id: string }): BadgeDef => ({ name: o.id, description: `${o.id} means something`, color: 'blue', enabled: true, eligible_roles: ['admin', 'staff', 'counselor'], show_students: false, sort: 0, ...o });
const defs = [def({ id: 'b-lead', name: 'Team leader', sort: 2, color: 'green' }), def({ id: 'b-docs', name: 'Document officer', sort: 1, color: 'red' }), def({ id: 'b-off', enabled: false }), def({ id: 'b-adm', name: 'Admin only', eligible_roles: ['admin'] }), def({ id: 'b-stu', name: 'For students', show_students: true })];
const links = [
  { badge_id: 'b-lead', email: 'Ada@x.org' }, { badge_id: 'b-docs', email: 'ada@x.org' }, { badge_id: 'b-off', email: 'ada@x.org' },
  { badge_id: 'b-adm', email: 'ada@x.org' }, { badge_id: 'b-adm', email: 'bo@x.org' }, { badge_id: 'b-stu', email: 'bo@x.org' }, { badge_id: 'b-gone', email: 'bo@x.org' },
];
const roles = new Map([['ada@x.org', 'counselor'], ['bo@x.org', 'admin']]);
const vis = visibleBadges(defs, links, roles);
eq(vis.get('ada@x.org')?.map((b) => b.name), ['Document officer', 'Team leader'], 'badges are ordered by the admin\'s order; a switched-off badge and one the role may not hold are hidden');
eq(vis.get('bo@x.org')?.map((b) => b.name).sort(), ['Admin only', 'For students'], 'an admin can hold the admin-only badge; an assignment to a deleted badge is ignored');
eq(visibleBadges(defs, links, roles, { students: true }).get('bo@x.org')?.map((b) => b.name), ['For students'], 'students see only badges the admin opened to them');
ok(!visibleBadges(defs, links, roles, { students: true }).has('ada@x.org'), 'a person with no student-visible badge has none');
ok(!visibleBadges(defs, [{ badge_id: 'b-lead', email: 'zed@x.org' }], roles).has('zed@x.org'), 'someone who is no longer on the team shows no badge');
ok(mayHold(def({ id: 'x', eligible_roles: ['staff'] }), 'staff') && !mayHold(def({ id: 'x', eligible_roles: ['staff'] }), 'counselor'), 'eligibility follows the role');
eq(splitEligible(def({ id: 'x', eligible_roles: ['counselor'] }), [{ email: 'A@x.org', role: 'counselor' }, { email: 'b@x.org', role: 'admin' }]), { ok: ['a@x.org'], blocked: ['b@x.org'] }, 'assigning is split into who can and cannot hold it');
eq(badgeSpeech({ name: 'Team leader', description: 'Leads the UK team' }), 'Team leader: Leads the UK team', 'the spoken label is the admin\'s name and meaning');
ok(!/verif/i.test(badgeSpeech({ name: 'Green badge', description: 'Document officer' })), 'a badge is never called "verified" unless the admin wrote that');
eq(toDef({ id: 'a', name: 'n', color: 'weird', eligible_roles: ['admin', 'x'] }).color, 'blue', 'an unknown stored colour falls back safely');
ok(!toDef({ id: 'a', name: 'n', color: 'red' }).enabled, 'a row without the flag is off');

// ---------- covers ----------
ok(Object.keys(COVER_PRESETS).length >= 5, 'there are built-in covers to choose from');
ok(coverBackground('horizon', 'rose') === COVER_PRESETS.horizon.css, 'a chosen built-in cover is used as is');
ok(coverBackground(null, 'rose').includes('#9f1239'), 'with nothing chosen the cover follows the accent colour');
ok(coverBackground('nope', undefined).includes('#0f2a63'), 'an unknown cover name falls back to the default accent');
eq(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.ext, 'jpg', 'jpeg is recognised by its bytes');
eq(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))?.mime, 'image/png', 'png is recognised by its bytes');
eq(sniffImage(Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]))?.ext, 'webp', 'webp is recognised by its bytes');
eq(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null, 'an SVG (which can carry scripts) is refused');
eq(sniffImage(Buffer.from('GIF89a......')), null, 'other image types are refused');
eq(sniffImage(new Uint8Array(0)), null, 'an empty file is refused');
eq(coverPathFromUrl('https://abc.supabase.co/storage/v1/object/public/covers/4f2a-1.jpg'), '4f2a-1.jpg', 'a cover address gives its file name');
eq(coverPathFromUrl('https://abc.supabase.co/storage/v1/object/public/avatars/me.jpg'), null, 'an address from another bucket is never touched');
eq(coverPathFromUrl('https://abc.supabase.co/storage/v1/object/public/covers/../avatars/x.jpg'), null, 'a path that climbs out of the bucket is refused');
eq(coverPathFromUrl(null), null, 'no address, no file');
eq([clampPos(-5), clampPos(140), clampPos('37.6'), clampPos('abc'), clampPos(undefined)], [0, 100, 38, 50, 50], 'the photo position stays between 0 and 100');

// ---------- what a person handles (from the assignment records) ----------
const rule = (o: Partial<HandleRule>): HandleRule => ({ workspace: 'uk', kind: 'application', scope: 'school', school_key: 'rcl', school_name: 'Regent College London', location_key: null, counselor_key: 'ada', role: 'primary', active: true, paused_until: null, ...o });
const names = new Map([['uk', 'United Kingdom'], ['jp', 'Japan']]);
const rules: HandleRule[] = [
  rule({}), rule({ kind: 'documents' }),
  rule({ school_key: 'bpp', school_name: 'BPP', role: 'backup' }),
  rule({ scope: 'country', school_key: null, school_name: null }),
  rule({ scope: 'location', school_key: null, location_key: 'lagos', location_name: 'Lagos' }),
  rule({ school_key: 'ysj', school_name: 'York St John', active: false }),
  rule({ workspace: 'jp', scope: 'country', school_key: null, paused_until: '2026-11-10' }),
  rule({ counselor_key: 'bo', school_key: 'cccu', school_name: 'CCCU' }),
];
const h = buildHandles({ counselorKey: 'ada', rules, scopes: [], workspaces: names, today: '2026-10-25' });
eq(h.schools.map((s) => s.label), ['BPP', 'Regent College London'], 'schools come from her rules, merged and sorted; a switched-off rule and someone else\'s rule are left out');
eq(roleLine(h.schools.find((s) => s.label === 'Regent College London')!.by), 'Primary · applications and documents', 'application and documents rules for one school are one line');
eq(roleLine(h.schools.find((s) => s.label === 'BPP')!.by), 'Backup · applications', 'a backup is shown as a backup');
eq(h.countries.map((c) => `${c.workspaceName}:${c.pausedUntil}`), ['Japan:2026-11-10', 'United Kingdom:null'], 'a whole country shows its name, and a paused rule says until when');
eq(h.locations.map((l) => l.label), ['Lagos'], 'locations are listed');
eq(roleLine({ application: 'primary', documents: 'backup' }), 'Primary for applications, backup for documents', 'mixed roles are spelled out');
eq(headline(h), 'Japan, United Kingdom · 2 schools · 1 location', 'the card headline counts schools and locations');
ok(!buildHandles({ counselorKey: 'zed', rules, scopes: [], workspaces: names, today: '2026-10-25' }).any, 'someone with no rules handles nothing');
ok(!buildHandles({ counselorKey: null, rules, scopes: [], workspaces: names, today: '2026-10-25' }).any, 'a person who is not linked to a counselor handles nothing');
const head = buildHandles({ counselorKey: null, rules: [], scopes: [{ workspace: 'uk', scope: 'school', school_key: 'rcl', school_name: 'Regent College London', location_key: null }, { workspace: 'uk', scope: 'school', school_key: 'rcl', school_name: 'Regent College London', location_key: null }], workspaces: names, today: '2026-10-25' });
eq(head.oversees.map((o) => o.label), ['Regent College London'], 'a Team Head\'s scope is listed once');
eq(headline(head), 'Oversees Regent College London', 'a Team Head with no counselor rules gets an "oversees" line');
eq(headline(buildHandles({ counselorKey: 'x', rules: [], scopes: [], workspaces: names, today: '2026-10-25' })), '', 'nothing assigned, nothing said');

// ---------- who may edit which profile field ----------
const cur: TextFields = { title: 'Counselor', bio: 'Hi', responsibilities: 'UK desk', duties: null, also_supports: null };
const locks = parseLocks({ locked: ['title', 'responsibilities', 'cover', 'bogus'] });
eq(locks, ['title', 'responsibilities', 'cover'], 'only known fields can be locked');
ok(isLocked(locks, 'title', 'counselor') && !isLocked(locks, 'title', 'admin') && !isLocked(locks, 'bio', 'counselor'), 'locks bind counselors and staff, never admins, and only the locked fields');
eq(parseLocks(null), [], 'no setting means nothing is locked');
const edited = profileTextPatch(cur, { title: 'Head of everything', bio: '  A new   bio ', responsibilities: 'All of it', duties: 'Mentoring', also_supports: 'Ghana' }, { role: 'counselor', locks });
eq(edited.patch, { title: 'Counselor', bio: 'A new bio', responsibilities: 'UK desk', duties: 'Mentoring', also_supports: 'Ghana' }, 'locked fields keep what an admin set; the rest are saved tidied');
eq(edited.blocked, ['title', 'responsibilities'], 'the form is told which of its changes were not allowed');
eq(profileTextPatch(cur, { title: 'Head of everything' }, { role: 'admin', locks }).patch.title, 'Head of everything', 'an admin can still change a locked field');
eq(profileTextPatch(cur, { bio: 'Only the bio' }, { role: 'counselor', locks }).blocked, [], 'a form that does not send a locked field changes nothing and complains about nothing');
eq(profileTextPatch(cur, { duties: 'x'.repeat(900), also_supports: 'y'.repeat(500) }, { role: 'staff', locks: [] }).patch.duties?.length, 600, 'long text is cut to its limit');
eq(profileTextPatch(cur, { bio: '   ' }, { role: 'staff', locks: [] }).patch.bio, null, 'an emptied field is cleared');

console.log(`${pass} checks passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
