'use server';
// Moving students between schools and changing their programme.
//  previewMove  - read-only: tidies the names, then says what would happen to each student (and what would stop it).
//  applyMove    - does it: portal first (always works), then Sheet1, then the student is told. Everything is undoable.
//  undoMoves    - puts back what a move changed.
//  retrySheetMove - tries Sheet1 again for a move the sheet missed (for example before the Apps Script was updated).
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { randomUUID } from 'crypto';
import { admin } from '@/lib/supabase';
import { canSee, requireStaff, type Staff } from '@/lib/auth';
import { schoolKey, schoolShort, studentKey } from '@/lib/docs';
import { STATUSES } from '@/lib/constants';
import { addNotice } from '@/lib/notices';
import { sendMail } from '@/lib/mail';
import { studentSite } from '@/lib/emailTemplate';
import { refreshTasks } from '@/lib/overview';
import { buildCatalog, canonicalProgramme, canonicalSchool, nearest, offerHasData, pick, progKey, RESET_STATUS, statusDefault, type ApplyInput, type Applied, type Moved, type MoveInput, type Note, type Outcome, type PlanRow, type Preview } from '@/lib/moves';
import { chunk, commitRow, display, log, pushOne, rowsBy, writeSheet, type Group, type Light, type Row, type SheetState, type Snap } from '@/lib/moveCore';

const MAX_STUDENTS = 300;       // students per move
const SHEET_BUDGET_MS = 38_000; // stop starting sheet updates after this long; the portal side is already done and the sheet can be retried
const EMAIL_MAX = 15;           // emails are sent one by one, so only for small moves
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- planning (shared by preview and apply)

type Planned = { error: string } | { error?: undefined; groups: Group[]; rows: PlanRow[]; preview: Extract<Preview, { ok: true }>; school: string; programme: string; offers: Map<string, Record<string, unknown>> };

async function plan(input: MoveInput, staff: Staff): Promise<Planned> {
  const ids = [...new Set((input.ids || []).map(String).filter(Boolean))].slice(0, MAX_STUDENTS * 3);
  if (!ids.length) return { error: 'Pick at least one student first.' };
  const db = admin();
  const [{ data: allRaw }, picked] = await Promise.all([
    db.from('portal_applications').select('application_id, name, email, school, programme, student_key').or('email.is.null,email.neq.test@example.com').limit(5000),
    rowsBy('application_id', ids),
  ]);
  const all = (allRaw || []) as Light[];
  const visible = picked.filter((a) => canSee(staff, a.counselor));
  if (!visible.length) return { error: 'Those students were not found, or they are not assigned to you.' };

  const cat = buildCatalog(all);
  const school = canonicalSchool((input.school || '').slice(0, 120), cat), sk = schoolKey(school);
  const programme = canonicalProgramme((input.programme || '').slice(0, 160), sk, cat);
  const peek = !school && !programme;   // nothing typed yet: just list the students

  // one group per student at a school: every submission they made there moves together
  const sibs = await rowsBy('student_key', [...new Set(visible.map((a) => a.student_key))]);
  const groups: Group[] = [];
  const order = new Map(ids.map((id, i) => [id, i]));
  for (const key of [...new Set(visible.map((a) => a.student_key))].slice(0, MAX_STUDENTS)) {
    const rows = sibs.filter((a) => a.student_key === key);
    const lead = visible.filter((a) => a.student_key === key).sort((a, b) => (order.get(a.application_id) ?? 0) - (order.get(b.application_id) ?? 0))[0] || rows[0];
    if (rows.length) groups.push({ key, rows, lead });
  }

  const allIds = groups.flatMap((g) => g.rows.map((r) => r.application_id));
  const offers = new Map<string, Record<string, unknown>>();
  for (const c of chunk(allIds, 40)) { const { data } = await db.from('portal_offers').select('*').in('application_id', c); (data || []).forEach((o) => offers.set(o.application_id, o)); }
  const byKey = new Map<string, Light[]>();
  all.forEach((a) => { const k = studentKey(a.email, a.school, a.name); byKey.set(k, [...(byKey.get(k) || []), a]); });

  const known = cat.schools.find((s) => s.key === sk)?.programmes.map((p) => p.name) || [];
  const schoolIsNew = !!school && !cat.schools.some((s) => s.key === sk);
  const programmeIsNew = !!programme && !known.some((n) => progKey(n) === progKey(programme));
  const pool = known.length ? known : [...new Set(cat.schools.flatMap((s) => s.programmes.map((p) => p.name)))];
  // the status each student ends up with: kept, restarted if it belonged to the old school, or one status for everyone
  const toStatusFor = (lead: Row): string | null => {
    const want = input.status || '';
    if (want === RESET_STATUS) return statusDefault(lead.status, 'switch');
    return want && want !== lead.status ? want : null;
  };

  const rows: PlanRow[] = groups.map((g) => {
    const { lead } = g;
    const fromSchool = lead.school, fromProgramme = pick(lead.programme);
    const toSchool = school || fromSchool, toProgramme = programme || fromProgramme;
    const schoolChanged = !!school && schoolKey(school) !== schoolKey(fromSchool);
    const progChanged = !!programme && progKey(programme) !== progKey(fromProgramme);
    // same school or programme, spelled differently ("BPP" and "BPP University"): tidying the name to match the rest
    const renamed = (!!school && !schoolChanged && display(fromSchool) !== school) || (!!programme && !progChanged && !!fromProgramme && fromProgramme !== programme);
    const notes: Note[] = [];
    const ids2 = g.rows.map((r) => r.application_id);
    const hasOffer = ids2.some((i) => offerHasData(offers.get(i) as never));
    const inRegent = g.rows.some((r) => r.in_regent), inMaster = g.rows.some((r) => r.in_master);
    const canNotify = !!lead.email && EMAIL_RE.test(lead.email);
    let state: PlanRow['state'] = schoolChanged || progChanged || renamed ? 'ok' : 'nochange';
    if (state === 'ok' && !schoolChanged && !progChanged) notes.push({ tone: 'info', text: 'Same school and programme, spelled to match the rest.' });
    if (state === 'nochange' && !peek) notes.push({ tone: 'info', text: 'Already at this school and programme.' });
    if (schoolChanged) {
      const newKey = studentKey(lead.email, toSchool, lead.name);
      const clash = (byKey.get(newKey) || []).find((a) => !ids2.includes(a.application_id));
      if (clash) { state = 'blocked'; notes.push({ tone: 'stop', text: `Already has an application at ${display(clash.school)}. Open it instead of moving this one.`, href: `/applications/${encodeURIComponent(clash.application_id)}` }); }
      if (state === 'ok') {
        if (hasOffer) notes.push({ tone: 'warn', text: `An offer, CAS or visa is recorded for ${display(fromSchool) || 'the old school'}.` });
        if (statusDefault(lead.status, 'switch')) notes.push({ tone: 'warn', text: `The status “${lead.status}” belonged to the old school.` });
        if (lead.status === 'Enrolled') notes.push({ tone: 'warn', text: 'This student is already enrolled. Check this is right.' });
        if (inRegent && sk !== 'rcl') notes.push({ tone: 'info', text: 'Listed in the Regent Only sheet. That row stays there; update or remove it by hand.' });
        if (!inRegent && sk === 'rcl') notes.push({ tone: 'info', text: 'Not in the Regent Only sheet yet. Add them there if they should be tracked for payment.' });
      }
    }
    if (state === 'ok' && !inMaster) notes.push({ tone: 'info', text: 'Not in Sheet1, so this is saved in the portal only.' });
    if (state === 'ok' && g.rows.length > 1) notes.push({ tone: 'info', text: `Also moves ${g.rows.length - 1} other submission${g.rows.length === 2 ? '' : 's'} by this student at this school.` });
    return {
      key: g.key, ids: ids2, primary: lead.application_id, name: lead.name, status: lead.status, toStatus: state === 'ok' ? toStatusFor(lead) : null, fromSchool: display(fromSchool), fromProgramme, toSchool: display(toSchool), toProgramme,
      state, notes, hasOffer, inRegent, inMaster, canNotify,
    };
  });

  const preview: Extract<Preview, { ok: true }> = {
    ok: true, toSchool: school || null, toProgramme: programme || null, schoolIsNew, programmeIsNew,
    similarSchools: schoolIsNew ? nearest(school, cat.schools.map((s) => s.name)) : [],
    similarProgrammes: programmeIsNew ? nearest(programme, pool) : [],
    rows, anyOffer: rows.some((r) => r.state === 'ok' && r.hasOffer), anyNotify: rows.some((r) => r.state === 'ok' && r.canNotify),
    skipped: Math.max(0, new Set(visible.map((a) => a.student_key)).size - MAX_STUDENTS),
  };
  return { groups, rows, preview, school, programme, offers };
}

export async function previewMove(input: MoveInput): Promise<Preview> {
  const staff = await requireStaff();
  const p = await plan(input, staff);
  return p.error !== undefined ? { ok: false, error: p.error } : p.preview;
}

// ---------------------------------------------------------------- apply

export async function applyMove(input: ApplyInput): Promise<Applied> {
  const staff = await requireStaff();
  if (input.status && input.status !== RESET_STATUS && !(STATUSES as readonly string[]).includes(input.status)) return { ok: false, error: 'That status is not in the list.' };
  const p = await plan(input, staff);
  if (p.error !== undefined) return { ok: false, error: p.error };
  if (!p.school && !p.programme) return { ok: false, error: 'Choose a new school or a new programme.' };
  const db = admin(), t0 = Date.now(), at = new Date().toISOString();
  const outcomes: Outcome[] = [], undo: string[] = [], led: string[] = [];
  let moved = 0, sheetPending = 0;

  for (const g of p.groups) {
    const pr = p.rows.find((r) => r.key === g.key)!;
    const base: Outcome = { key: g.key, name: pr.name, primary: pr.primary, result: 'moved', sheet: 'none' };
    if (pr.state !== 'ok') { outcomes.push({ ...base, result: pr.state, note: pr.notes.find((n) => n.tone === 'stop')?.text || pr.notes[0]?.text }); continue; }
    try {
      const { lead } = g;
      const fromSchool = lead.school, fromProgramme = lead.programme;
      const toSchool = p.school || fromSchool, toProgramme = p.programme || fromProgramme;
      const schoolChanged = !!p.school && schoolKey(p.school) !== schoolKey(fromSchool);
      const progChanged = !!p.programme && progKey(p.programme) !== progKey(fromProgramme);
      const schoolRenamed = !!p.school && !schoolChanged && display(fromSchool) !== p.school;
      const progRenamed = !!p.programme && !progChanged && !!fromProgramme && fromProgramme !== p.programme;
      const newStatus = pr.toStatus;

      // 1) Sheet1 (the portal side below does not depend on it)
      const fields: Record<string, string> = {};
      if (schoolChanged || (schoolRenamed && lead.master_data && schoolShort(toSchool) !== lead.master_data.school)) fields.school = schoolShort(toSchool);
      if ((progChanged || progRenamed) && toProgramme) fields.programme = toProgramme;
      if (newStatus) fields.status = newStatus;
      const sheet = Date.now() - t0 < SHEET_BUDGET_MS ? await writeSheet(lead, fields, staff.email) : { state: (lead.in_master ? 'pending' : 'none') as SheetState, note: 'Left for later: Sheet1 is updated a few at a time.', applied: new Set<string>() };
      const sheetOk = lead.in_master ? sheet.state !== 'pending' : undefined;

      // 2) the portal: every submission this student made at this school
      const offerRows = g.rows.map((r) => p.offers.get(r.application_id)).filter(Boolean) as Record<string, unknown>[];
      const before = g.rows.map((r) => ({ id: r.application_id, school: r.school, programme: r.programme, status: r.status, student_key: r.student_key, moved: r.moved, master: r.master_data }));
      for (const r of g.rows) {
        if (sheet.state === 'updated' && r.in_master && r.master_data) r.master_data = { ...r.master_data, ...(fields.school ? { school: fields.school } : {}), ...(fields.programme ? { programme: fields.programme } : {}) };
        await commitRow(r, { school: schoolChanged || schoolRenamed ? toSchool : r.school, programme: progChanged || progRenamed ? toProgramme : r.programme, status: newStatus ?? r.status }, staff.email, at, sheetOk);
      }
      if (input.clearOffer && offerRows.length) await db.from('portal_offers').delete().in('application_id', g.rows.map((r) => r.application_id));

      // 3) the record, with everything needed to undo it
      const moveId = randomUUID();
      const detail = {
        move_id: moveId, reason: input.reason, from: { school: display(fromSchool), programme: fromProgramme, status: lead.status }, to: { school: display(toSchool), programme: toProgramme, status: newStatus ?? lead.status },
        sheet: sheet.state, offer_cleared: !!(input.clearOffer && offerRows.length), student_told: false,
        undo: { rows: before, offers: input.clearOffer ? offerRows : [], sheetWritten: sheet.state === 'updated', statusWritten: !!newStatus && sheet.applied.has('status') },
      };
      let leadAct = '';
      for (const r of g.rows) { const aid = await log(r.application_id, staff.email, 'school_moved', detail); if (r.application_id === lead.application_id) leadAct = aid; }

      // 4) tell the student
      if (input.notify && pr.canNotify && lead.email && (schoolChanged || progChanged)) {
        const first = (lead.preferred_name || lead.name).split(/[\s,]+/)[0];
        const where = [display(toSchool), toProgramme].filter(Boolean).join(' · ');
        const line = schoolChanged ? `Your counselor moved your application to ${where}.` : `Your programme is now ${toProgramme}.`;
        await addNotice({ email: lead.email, applicationId: lead.application_id, kind: 'message', title: 'Your application was updated', body: line, href: '/student', by: staff.email });
        if (input.email && p.groups.length <= EMAIL_MAX) {
          try {
            await sendMail({
              to: lead.email, subject: 'Your application was updated', body: `Hi ${first},\n\n${line}\n\nSign in to your student portal to see the details: ${studentSite()}/student/login`, replyTo: staff.email, from: staff.email,
              eyebrow: 'Application update', title: 'Your application was updated', greeting: `Hi ${first},`, preheader: line,
              blocks: [{ type: 'p', text: line }, { type: 'list', items: [`University: ${display(toSchool) || '—'}`, `Programme: ${toProgramme || '—'}`] }], cta: { label: 'See my progress', href: `${studentSite()}/student/login` },
            });
            await db.from('portal_messages').insert({ application_id: lead.application_id, to_email: lead.email, to_kind: 'student', subject: 'Your application was updated', body: line, sent_by: staff.email });
          } catch { /* the notice above still reached them */ }
        }
      }

      if (sheet.state === 'pending') sheetPending++;
      moved++;
      led.push(lead.application_id);
      if (leadAct) undo.push(leadAct);
      outcomes.push({ ...base, sheet: sheet.state, note: sheet.note, undo: leadAct || undefined });
    } catch (e) {
      outcomes.push({ ...base, result: 'failed', note: (e as Error).message });
    }
  }

  revalidatePath('/'); revalidatePath('/applications'); revalidatePath('/student'); revalidatePath('/my');
  led.forEach((id) => revalidatePath(`/applications/${id}`));
  after(() => refreshTasks().catch(() => {}));
  return { ok: true, outcomes, moved, sheetPending, undo, left: p.preview.skipped };
}

// ---------------------------------------------------------------- undo

type Undo = { rows: { id: string; school: string | null; programme: string | null; status: string | null; student_key: string; moved: Moved | null; master: Snap | null }[]; offers: Record<string, unknown>[]; sheetWritten: boolean; statusWritten: boolean };

export async function undoMoves(activityIds: string[]): Promise<{ ok: boolean; undone: number; problems: string[] }> {
  const staff = await requireStaff();
  const db = admin(), at = new Date().toISOString();
  let undone = 0;
  const problems: string[] = [];
  for (const aid of [...new Set(activityIds.map(String))].slice(0, MAX_STUDENTS)) {
    const { data: act } = await db.from('portal_activity').select('id, application_id, kind, detail').eq('id', aid).maybeSingle();
    if (!act || act.kind !== 'school_moved') { problems.push('That move was not found.'); continue; }
    const d = act.detail as { to: { school: string | null; programme: string | null; status: string | null }; from: { school: string | null; programme: string | null; status: string | null }; undo: Undo };
    const { data: later } = await db.from('portal_activity').select('detail').eq('application_id', act.application_id).eq('kind', 'school_move_undone');
    if ((later || []).some((x) => (x.detail as { of?: string })?.of === aid)) { problems.push('That move was already undone.'); continue; }
    const rows = await rowsBy('application_id', d.undo.rows.map((r) => r.id));
    const lead = rows.find((r) => r.application_id === act.application_id) || rows[0];
    if (!lead || !canSee(staff, lead.counselor)) { problems.push('You can only undo moves for your own students.'); continue; }
    const stillThere = rows.every((r) => schoolKey(r.school) === schoolKey(d.to.school) && progKey(r.programme) === progKey(d.to.programme));
    if (!stillThere) { problems.push(`${lead.name} has been changed since, so this move was not undone.`); continue; }
    try {
      // sheet back first, finding the row by the school it has now
      const fields: Record<string, string> = {};
      const prev = d.undo.rows.find((r) => r.id === lead.application_id) || d.undo.rows[0];
      if (d.undo.sheetWritten && prev.master) { if (prev.master.school) fields.school = prev.master.school; if (prev.master.programme !== undefined) fields.programme = prev.master.programme || ''; }
      if (d.undo.statusWritten && prev.status) fields.status = prev.status;
      const sheet = Object.keys(fields).length ? await writeSheet(lead, fields, staff.email) : { state: 'none' as SheetState, applied: new Set<string>() };
      for (const r of rows) {
        const b = d.undo.rows.find((x) => x.id === r.application_id);
        if (!b) continue;
        if (sheet.state === 'updated' && b.master && r.in_master) r.master_data = b.master;
        await commitRow(r, { school: b.school, programme: b.programme, status: b.status }, staff.email, at, lead.in_master ? sheet.state !== 'pending' : undefined);
        await log(r.application_id, staff.email, 'school_move_undone', { of: aid });
      }
      if (d.undo.offers.length) {
        // bring the old offer back, unless someone has entered new offer details since
        const { data: now } = await db.from('portal_offers').select('*').in('application_id', d.undo.offers.map((o) => String(o.application_id)));
        if ((now || []).some((o) => offerHasData(o as never))) problems.push(`${lead.name}: offer details were entered after the move, so the old ones were not put back.`);
        else await db.from('portal_offers').upsert(d.undo.offers);
      }
      undone++;
      revalidatePath(`/applications/${lead.application_id}`);
    } catch (e) { problems.push(`${lead.name}: ${(e as Error).message}`); }
  }
  revalidatePath('/applications'); revalidatePath('/'); revalidatePath('/student');
  return { ok: undone > 0, undone, problems };
}

// ---------------------------------------------------------------- try Sheet1 again

export async function retrySheetMove(id: string): Promise<{ ok: boolean; error?: string }> {
  const staff = await requireStaff();
  const [a] = await rowsBy('application_id', [id]);
  if (!a || !canSee(staff, a.counselor)) return { ok: false, error: 'Student not found.' };
  const r = await pushOne(a, staff.email);
  if (r.ok) revalidatePath(`/applications/${id}`);
  return r;
}
