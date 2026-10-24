// Tells people about routing, through the notifications the portal already has (push, and the opt-in "new student assigned" email).
// Everything here works from what a routing run or a reassignment actually changed, so an application that is merely updated never notifies
// anyone, and nobody is told twice about the same assignment. Best effort: a failed notification never undoes an assignment.
import { admin } from './supabase';
import { sendPush } from './push';
import { notifyAssigned } from './notify';
import { inScope, type Scope } from './assignEngine';
import { loadCounselors, type RouteResult } from './assignCore';

type Student = { id: string; name: string; school: string | null; programme: string | null };
const list = (xs: string[], n = 3) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` and ${xs.length - n} more` : ''}`;

/** One push (and the opt-in email) per counselor, for the students just given to them. `by` is the person who did it, or empty for the system. */
export async function notifyOwner(counselorName: string, email: string | null, students: Student[], by = '') {
  if (!students.length) return;
  if (email && by && email.toLowerCase() === by.toLowerCase()) return;   // nobody needs telling that they gave something to themselves
  try { await notifyAssigned(counselorName, students, by); } catch { /* the email is opt-in and optional */ }
  if (email) {
    try {
      await sendPush({
        emails: [email], tag: 'assigned',
        title: students.length === 1 ? `New student: ${students[0].name}` : `${students.length} new students assigned to you`,
        body: students.length === 1 ? [students[0].school, students[0].programme && students[0].programme.toUpperCase() !== 'N/A' ? students[0].programme : ''].filter(Boolean).join(' · ') || 'Open the application.' : list(students.map((s) => s.name)),
        url: students.length === 1 ? `/applications/${encodeURIComponent(students[0].id)}` : '/my',
      });
    } catch { /* ignore */ }
  }
}

/** Same, for a person who changed owners by hand: looks up the counselor's email. */
export async function notifyOwnerByKey(counselorKey: string, students: Student[], by = '') {
  try { const c = (await loadCounselors(admin())).get(counselorKey); if (c) await notifyOwner(c.name, c.email, students, by); } catch { /* the assignment is already saved */ }
}

/** After a routing run: tell each new owner, each document handler, and the admins and Team Heads who have applications waiting for a decision. */
export async function notifyRouting(r: RouteResult): Promise<void> {
  try {
    const db = admin(), counselors = await loadCounselors(db);
    const byOwner = new Map<string, Student[]>();
    for (const a of r.assigned) byOwner.set(a.counselorKey, [...(byOwner.get(a.counselorKey) || []), { id: a.id, name: a.name, school: a.school, programme: a.programme }]);
    for (const [k, students] of byOwner) { const c = counselors.get(k); if (c) await notifyOwner(c.name, c.email, students); }

    // someone who only receives the documents hears about it too (unless they are also the owner)
    const owners = new Map(r.assigned.map((a) => [a.id, a.counselorKey]));
    const byDoc = new Map<string, string[]>();
    for (const d of r.docHandlers) if (owners.get(d.id) !== d.counselorKey) byDoc.set(d.counselorKey, [...(byDoc.get(d.counselorKey) || []), d.name]);
    for (const [k, names] of byDoc) { const c = counselors.get(k); if (c?.email) await sendPush({ emails: [c.email], tag: 'assigned-docs', title: names.length === 1 ? `Documents for ${names[0]} come to you` : `Documents for ${names.length} new students come to you`, body: list(names), url: '/documents' }).catch(() => undefined); }

    // decisions needed: the admins, and each Team Head whose scope covers the application
    const waiting = [...r.queued.map((x) => ({ ...x, why: 'queue' as const })), ...r.conflicts.map((x) => ({ ...x, why: 'conflict' as const }))];
    if (!waiting.length) return;
    const [{ data: admins }, { data: scopeRows }] = await Promise.all([db.from('portal_staff').select('email').eq('role', 'admin'), db.from('portal_head_scopes').select('email, workspace, scope, school_key, location_key')]);
    const per = new Map<string, typeof waiting>();
    const add = (email: string, w: (typeof waiting)[number]) => per.set(email.toLowerCase(), [...(per.get(email.toLowerCase()) || []), w]);
    for (const w of waiting) {
      for (const a of admins || []) add(a.email, w);
      const heads = new Map<string, Scope[]>();
      (scopeRows || []).forEach((s) => heads.set((s.email as string).toLowerCase(), [...(heads.get((s.email as string).toLowerCase()) || []), s as Scope]));
      for (const [email, scopes] of heads) if (inScope(scopes, { workspace: w.workspace, school: w.school, city: w.city })) add(email, w);
    }
    for (const [email, items] of per) {
      const uniq = [...new Map(items.map((i) => [i.id, i])).values()], conflicts = uniq.filter((i) => i.why === 'conflict').length;
      await sendPush({
        emails: [email], tag: 'assign-queue',
        title: `${uniq.length} application${uniq.length === 1 ? '' : 's'} need${uniq.length === 1 ? 's' : ''} an assignment`,
        body: `${list(uniq.map((i) => i.name))}${conflicts ? `. ${conflicts} ${conflicts === 1 ? 'has' : 'have'} more than one counselor who could take ${conflicts === 1 ? 'it' : 'them'}.` : '.'}`,
        url: '/head',
      }).catch(() => undefined);
    }
  } catch { /* routing is already saved */ }
}
