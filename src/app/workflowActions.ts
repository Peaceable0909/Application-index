'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { admin } from '@/lib/supabase';
import { requireTeam } from '@/lib/auth';
import { currentWorkspace } from '@/lib/workspace';
import { schoolKey } from '@/lib/docs';
import { CAS_STATUSES, STATUSES, VISA_STATUSES } from '@/lib/constants';
import { slug } from '@/lib/stageEngine';
import { WORKFLOW_TEMPLATES } from '@/lib/stageTemplates';

// Admin only: change a school's stages and what each stage asks for. Every change is limited to the workflow named in the form,
// and the stage or requirement is checked to belong to it, so one school's workflow can never change another's.
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const ROLES = ['admin', 'staff', 'counselor'];
const NOTIFY = ['none', 'counselor', 'admins', 'both'];
const KINDS = ['document', 'confirmation', 'outcome'];
const NEEDS = ['mandatory', 'optional', 'conditional'];
const SATISFIED = ['uploaded', 'approved', 'accepted'];
const OFFER_TYPES = ['Conditional', 'Unconditional'];

async function adminOnly() {
  const staff = await requireTeam();
  if (staff.role !== 'admin') redirect('/?err=' + encodeURIComponent('Only an admin can change workflows.'));
  return staff;
}
const back = (school: string | null, msg: string, err = false): never => {
  revalidatePath('/workflows'); revalidatePath('/stages');
  redirect(`/workflows${school ? `?school=${encodeURIComponent(school)}` : ''}${school ? '&' : '?'}${err ? 'err' : 'msg'}=${encodeURIComponent(msg)}`);
};

async function ownWorkflow(wfId: string) {
  const { data } = await admin().from('portal_workflows').select('id, school_key, school_name, workspace, conditions').eq('id', wfId).maybeSingle();
  if (!data) back(null, 'That workflow no longer exists.', true);
  return data!;
}
async function ownStage(wfId: string, stageId: string) {
  const { data } = await admin().from('portal_stages').select('id, key, name, position, conditional, workflow_id').eq('id', stageId).eq('workflow_id', wfId).maybeSingle();
  return data;
}
const uniqueKey = (base: string, taken: string[]) => { let k = base, n = 2; while (taken.includes(k)) k = `${base}_${n++}`.slice(0, 60); return k; };
const roles = (f: FormData, min: string[] = ['admin']) => { const r = f.getAll('roles').map(String).filter((x) => ROLES.includes(x)); return [...new Set([...min, ...r])]; };
const list = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);

/** Rewrites the positions of a workflow's stages to 10, 20, 30… in the given order. */
async function renumber(wfId: string, order: string[]) {
  const db = admin();
  for (let i = 0; i < order.length; i++) await db.from('portal_stages').update({ position: (i + 1) * 10 }).eq('id', order[i]).eq('workflow_id', wfId);
}

// ---- schools ----
export async function createWorkflow(f: FormData) {
  await adminOnly();
  const ws = await currentWorkspace(), name = s(f, 'school').replace(/\s+/g, ' ').slice(0, 120), from = s(f, 'from');
  const key = schoolKey(name);
  if (name.length < 2 || !/^[a-z0-9]{2,40}$/.test(key)) back(null, 'Give the school a name (letters and numbers).', true);
  const db = admin();
  const { data: dup } = await db.from('portal_workflows').select('id').eq('workspace', ws).eq('school_key', key).maybeSingle();
  if (dup) back(key, `${name} already has a workflow here.`, true);
  const tpl = from.startsWith('tpl:') ? WORKFLOW_TEMPLATES.find((t) => t.school_key === from.slice(4)) : null;
  const { data: wf, error } = await db.from('portal_workflows').insert({ workspace: ws, school_key: key, school_name: name, conditions: tpl?.conditions ?? [] }).select('id').single();
  if (error || !wf) back(null, `Could not create it: ${error?.message}`, true);
  const wfId = wf!.id as string;
  // starting stages: copied from a template, from another school's workflow, or just the two every school has
  type S = { key: string; name: string; position: number; conditional: boolean; maps_status: string | null; move_roles: string[]; complete_when: string; notify: string; delay_days: number | null; offer_sync: unknown; hint: string | null };
  type R = { stage_key: string; key: string; label: string; kind: string; doc_type: string | null; need: string; condition_key: string | null; upload: boolean; satisfied_at: string; student_visible: boolean; position: number; options: string[] | null; pass_options: string[] | null; hint: string | null };
  let stages: S[] = [], reqs: R[] = [];
  if (tpl) {
    tpl.stages.forEach((st, i) => { stages.push({ key: st.key, name: st.name, position: (i + 1) * 10, conditional: !!st.conditional, maps_status: st.maps ?? null, move_roles: st.roles ?? ROLES, complete_when: st.complete ?? 'manual', notify: st.notify ?? 'counselor', delay_days: st.delay ?? null, offer_sync: st.offer ?? null, hint: st.hint ?? null });
      (st.reqs || []).forEach((r, j) => reqs.push({ stage_key: st.key, key: r.key, label: r.label, kind: r.kind ?? 'document', doc_type: r.doc_type ?? null, need: r.need ?? 'mandatory', condition_key: r.condition ?? null, upload: r.upload ?? (r.kind ?? 'document') === 'document', satisfied_at: r.satisfied_at ?? 'approved', student_visible: r.student_visible ?? (r.kind ?? 'document') === 'document', position: (j + 1) * 10, options: r.options ?? null, pass_options: r.pass ?? null, hint: r.hint ?? null })); });
  } else if (from.startsWith('wf:')) {
    const src = from.slice(3);
    const { data: ss } = await db.from('portal_stages').select('id, key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint').eq('workflow_id', src).order('position');
    const ids = (ss || []).map((x) => x.id as string);
    const { data: rs } = ids.length ? await db.from('portal_stage_reqs').select('stage_id, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint').in('stage_id', ids) : { data: [] };
    const keyOf = new Map((ss || []).map((x) => [x.id as string, x.key as string]));
    stages = (ss || []).map(({ id: _i, ...x }) => { void _i; return x as S; });
    reqs = (rs || []).map(({ stage_id, ...x }) => ({ stage_key: keyOf.get(stage_id as string)!, ...x })) as R[];
    const { data: sw } = await db.from('portal_workflows').select('conditions').eq('id', src).maybeSingle();
    if (sw?.conditions) await db.from('portal_workflows').update({ conditions: sw.conditions }).eq('id', wfId);
  } else {
    stages = [{ key: 'offer_received', name: 'Offer Received', position: 10, conditional: false, maps_status: 'Offer Received', move_roles: ROLES, complete_when: 'manual', notify: 'counselor', delay_days: 14, offer_sync: null, hint: null },
      { key: 'enrolment', name: 'Enrolment', position: 20, conditional: false, maps_status: 'Enrolled', move_roles: ROLES, complete_when: 'manual', notify: 'both', delay_days: null, offer_sync: null, hint: null }];
  }
  if (stages.length) {
    const { data: ins, error: e2 } = await db.from('portal_stages').insert(stages.map((x) => ({ ...x, workflow_id: wfId }))).select('id, key');
    if (e2) back(key, `Created the school, but its stages could not be added: ${e2.message}`, true);
    const idOf = new Map((ins || []).map((x) => [x.key as string, x.id as string]));
    if (reqs.length) await db.from('portal_stage_reqs').insert(reqs.map(({ stage_key, ...x }) => ({ ...x, stage_id: idOf.get(stage_key) })).filter((x) => x.stage_id));
  }
  back(key, `${name} now has its own workflow with ${stages.length} stages. Adjust anything below.`);
}

export async function saveWorkflow(f: FormData) {
  await adminOnly();
  const wf = await ownWorkflow(s(f, 'wf'));
  const name = s(f, 'school_name').replace(/\s+/g, ' ').slice(0, 120);
  if (name.length < 2) back(wf.school_key, 'The school needs a name.', true);
  await admin().from('portal_workflows').update({ school_name: name, active: f.get('active') === 'on', override_roles: roles(f) }).eq('id', wf.id);
  back(wf.school_key, 'Saved.');
}

// ---- circumstances ("needs a TB certificate") ----
export async function saveConditions(f: FormData) {
  await adminOnly();
  const wf = await ownWorkflow(s(f, 'wf'));
  const cur = (wf.conditions || []) as { key: string; label: string }[];
  const next: { key: string; label: string }[] = [];
  for (const c of cur) {
    if (f.get(`del:${c.key}`) === 'on') {
      const { count } = await admin().from('portal_stage_reqs').select('id, portal_stages!inner(workflow_id)', { count: 'exact', head: true }).eq('portal_stages.workflow_id', wf.id).eq('condition_key', `cond:${c.key}`);
      if (count) { back(wf.school_key, `“${c.label}” is still used by ${count} requirement${count === 1 ? '' : 's'}. Change those first.`, true); }
      continue;
    }
    next.push({ key: c.key, label: (s(f, `label:${c.key}`) || c.label).slice(0, 80) });
  }
  const add = s(f, 'new').replace(/\s+/g, ' ').slice(0, 80);
  if (add) { const k = uniqueKey(slug(add), next.map((x) => x.key)); next.push({ key: k, label: add }); }
  await admin().from('portal_workflows').update({ conditions: next }).eq('id', wf.id);
  back(wf.school_key, 'Circumstances saved.');
}

// ---- stages ----
function offerFrom(f: FormData) {
  const o: Record<string, string> = {};
  const cas = s(f, 'offer_cas'), visa = s(f, 'offer_visa'), type = s(f, 'offer_type');
  if (cas && (CAS_STATUSES as readonly string[]).includes(cas)) o.cas_status = cas;
  if (visa && (VISA_STATUSES as readonly string[]).includes(visa)) o.visa_status = visa;
  if (type && OFFER_TYPES.includes(type)) o.offer_type = type;
  return Object.keys(o).length ? o : null;
}
function stageFields(f: FormData) {
  const name = s(f, 'name').replace(/\s+/g, ' ').slice(0, 80);
  const maps = s(f, 'maps_status'), delay = s(f, 'delay_days'), notify = s(f, 'notify'), complete = s(f, 'complete_when');
  return {
    name, ok: name.length >= 2 && (!maps || (STATUSES as readonly string[]).includes(maps)) && (!delay || (/^\d+$/.test(delay) && +delay >= 1 && +delay <= 365)) && NOTIFY.includes(notify) && ['manual', 'requirements'].includes(complete),
    row: { name, maps_status: maps || null, delay_days: delay ? +delay : null, notify, complete_when: complete, conditional: f.get('conditional') === 'on', active: f.get('active') === 'on', move_roles: roles(f, ['admin']), offer_sync: offerFrom(f), hint: s(f, 'hint').slice(0, 300) || null },
  };
}

export async function saveStage(f: FormData) {
  await adminOnly();
  const wf = await ownWorkflow(s(f, 'wf')), st = await ownStage(wf.id, s(f, 'stage'));
  if (!st) back(wf.school_key, 'That stage is not part of this workflow.', true);
  const v = stageFields(f);
  if (!v.ok) back(wf.school_key, 'Check the stage: it needs a name, a real pipeline status, and a number of days between 1 and 365.', true);
  await admin().from('portal_stages').update(v.row).eq('id', st!.id).eq('workflow_id', wf.id);
  back(wf.school_key, `“${v.row.name}” saved.`);
}

export async function addStage(f: FormData) {
  await adminOnly();
  const wf = await ownWorkflow(s(f, 'wf'));
  const v = stageFields(f);
  if (v.name.length < 2) back(wf.school_key, 'Name the new stage.', true);
  const db = admin();
  const { data: all } = await db.from('portal_stages').select('id, key, position').eq('workflow_id', wf.id).order('position');
  const key = uniqueKey(slug(v.name), (all || []).map((x) => x.key as string));
  const { data: ins, error } = await db.from('portal_stages').insert({ workflow_id: wf.id, key, name: v.name, position: 9999, conditional: f.get('conditional') === 'on', notify: 'counselor', move_roles: ROLES, complete_when: 'manual' }).select('id').single();
  if (error || !ins) back(wf.school_key, `Could not add it: ${error?.message}`, true);
  const after = s(f, 'after'), order = (all || []).map((x) => x.id as string);
  const at = after && order.includes(after) ? order.indexOf(after) + 1 : order.length;
  order.splice(at, 0, ins!.id as string);
  await renumber(wf.id, order);
  back(wf.school_key, `“${v.name}” added. Open it below to set what it asks for.`);
}

export async function shiftStage(f: FormData) {
  await adminOnly();
  const wf = await ownWorkflow(s(f, 'wf')), dir = s(f, 'dir') === 'up' ? -1 : 1;
  const { data: all } = await admin().from('portal_stages').select('id').eq('workflow_id', wf.id).order('position');
  const order = (all || []).map((x) => x.id as string), i = order.indexOf(s(f, 'stage')), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) back(wf.school_key, 'It is already at the end.');
  [order[i], order[j]] = [order[j], order[i]];
  await renumber(wf.id, order);
  back(wf.school_key, 'Order changed.');
}

// ---- requirements ----
function reqFields(f: FormData, conds: string[], stageKeys: string[]) {
  const label = s(f, 'label').replace(/\s+/g, ' ').slice(0, 160), kind = s(f, 'kind'), need = s(f, 'need'), satisfied = s(f, 'satisfied_at');
  const docType = kind === 'document' ? (s(f, 'doc_type').replace(/\s+/g, ' ').slice(0, 60) || label) : null;
  const cond = s(f, 'condition_key');
  const condOk = need !== 'conditional' || (cond.startsWith('cond:') ? conds.includes(cond.slice(5)) : cond.startsWith('stage:') && stageKeys.includes(cond.slice(6)));
  const options = kind === 'outcome' ? (list(s(f, 'options')).length ? list(s(f, 'options')) : ['Passed', 'Failed', 'Rescheduled']) : null;
  const pass = kind === 'outcome' ? list(s(f, 'pass_options')).filter((p) => options!.some((o) => o.toLowerCase() === p.toLowerCase())) : null;
  return {
    label, ok: label.length >= 2 && KINDS.includes(kind) && NEEDS.includes(need) && SATISFIED.includes(satisfied) && condOk && (kind !== 'outcome' || !!pass?.length),
    row: { label, kind, doc_type: docType, need, condition_key: need === 'conditional' ? cond : null, upload: kind === 'document' && f.get('upload') === 'on', satisfied_at: satisfied, student_visible: kind === 'document' && f.get('student_visible') === 'on', active: f.get('active') === 'on', options, pass_options: pass, hint: s(f, 'hint').slice(0, 300) || null },
  };
}
async function ctxFor(f: FormData) {
  const wf = await ownWorkflow(s(f, 'wf')), st = await ownStage(wf.id, s(f, 'stage'));
  if (!st) back(wf.school_key, 'That stage is not part of this workflow.', true);
  const { data: all } = await admin().from('portal_stages').select('key').eq('workflow_id', wf.id);
  return { wf, st: st!, conds: ((wf.conditions || []) as { key: string }[]).map((c) => c.key), stageKeys: (all || []).map((x) => x.key as string) };
}

export async function saveRequirement(f: FormData) {
  await adminOnly();
  const { wf, st, conds, stageKeys } = await ctxFor(f);
  const { data: r } = await admin().from('portal_stage_reqs').select('id').eq('id', s(f, 'req')).eq('stage_id', st.id).maybeSingle();
  if (!r) back(wf.school_key, 'That requirement is not part of this stage.', true);
  const v = reqFields(f, conds, stageKeys);
  if (!v.ok) back(wf.school_key, 'Check the requirement: it needs a name; a conditional one needs a circumstance or stage; an interview outcome needs at least one passing choice.', true);
  await admin().from('portal_stage_reqs').update(v.row).eq('id', r!.id).eq('stage_id', st.id);
  back(wf.school_key, `“${v.row.label}” saved.`);
}

export async function addRequirement(f: FormData) {
  await adminOnly();
  const { wf, st, conds, stageKeys } = await ctxFor(f);
  const v = reqFields(f, conds, stageKeys);
  if (!v.ok) back(wf.school_key, 'Check the requirement: it needs a name; a conditional one needs a circumstance or stage; an interview outcome needs at least one passing choice.', true);
  const db = admin();
  const { data: have } = await db.from('portal_stage_reqs').select('key, position').eq('stage_id', st.id);
  const key = uniqueKey(slug(v.row.label), (have || []).map((x) => x.key as string));
  const pos = Math.max(0, ...(have || []).map((x) => x.position as number)) + 10;
  const { error } = await db.from('portal_stage_reqs').insert({ stage_id: st.id, key, position: pos, ...v.row, active: true });
  if (error) back(wf.school_key, `Could not add it: ${error.message}`, true);
  back(wf.school_key, `“${v.row.label}” added to ${st.name}.`);
}

export async function removeRequirement(f: FormData) {
  await adminOnly();
  const { wf, st } = await ctxFor(f);
  const db = admin();
  const { data: r } = await db.from('portal_stage_reqs').select('id, label').eq('id', s(f, 'req')).eq('stage_id', st.id).maybeSingle();
  if (!r) back(wf.school_key, 'That requirement is not part of this stage.', true);
  const { count } = await db.from('portal_req_checks').select('id', { count: 'exact', head: true }).eq('req_id', r!.id);
  if (count) { await db.from('portal_stage_reqs').update({ active: false }).eq('id', r!.id); back(wf.school_key, `“${r!.label}” has been reviewed for ${count} application${count === 1 ? '' : 's'}, so it was switched off instead of deleted. Their history is kept.`); }
  await db.from('portal_stage_reqs').delete().eq('id', r!.id).eq('stage_id', st.id);
  back(wf.school_key, `“${r!.label}” removed.`);
}
