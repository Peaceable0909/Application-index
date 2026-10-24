-- Stage workflows: every school has its own stages, and every stage can have requirements (documents, confirmations, recorded outcomes)
-- that must be in order before an application leaves it. Everything here is edited from the portal (Workflows page), never in code.
-- The global pipeline status (the one the master sheet shows) stays as it is: a stage can say which status it stands for
-- (maps_status), and moving an application into it sets that status.

create table if not exists public.portal_workflows (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references public.portal_workspaces(key),
  school_key text not null check (school_key ~ '^[a-z0-9]{2,40}$'),     -- schoolKey() in src/lib/docs.ts: rcl, cccu, bpp, ysj, or the letters of another school's name
  school_name text not null check (char_length(school_name) between 2 and 120),
  active boolean not null default true,
  override_roles text[] not null default '{admin}',                     -- who may move an application forward although requirements are open (with a written reason)
  conditions jsonb not null default '[]'::jsonb,                        -- circumstances a counselor can switch on per applicant: [{ "key": "tb_required", "label": "Needs a TB test certificate" }]
  created_at timestamptz not null default now(),
  unique (workspace, school_key)
);

create table if not exists public.portal_stages (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.portal_workflows(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  name text not null check (char_length(name) between 2 and 80),
  position int not null,
  active boolean not null default true,                                  -- false = hidden from the route (kept, with its history)
  conditional boolean not null default false,                            -- only applies to applicants it was switched on for
  maps_status text,                                                      -- the pipeline status (constants.ts STATUSES) this stage stands for
  move_roles text[] not null default '{admin,staff,counselor}',          -- roles allowed to move an application INTO this stage
  complete_when text not null default 'manual' check (complete_when in ('manual','requirements')),
  notify text not null default 'counselor' check (notify in ('none','counselor','admins','both')),
  delay_days int check (delay_days is null or delay_days between 1 and 365),
  offer_sync jsonb,                                                      -- sets the Offer & visa tab on entry: { "cas_status": "Requested", "visa_status": "...", "offer_type": "..." }
  hint text,
  unique (workflow_id, key)
);
create index if not exists portal_stages_workflow on public.portal_stages(workflow_id, position);

create table if not exists public.portal_stage_reqs (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.portal_stages(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_]{2,60}$'),
  label text not null check (char_length(label) between 2 and 160),
  kind text not null default 'document' check (kind in ('document','confirmation','outcome')),
  doc_type text,                                                         -- the kind of document, as the portal names it ("Passport", "Bank statement")
  need text not null default 'mandatory' check (need in ('mandatory','optional','conditional')),
  condition_key text,                                                    -- for conditional: "cond:<circumstance>" or "stage:<conditional stage key>"
  upload boolean not null default true,                                  -- show an upload field in the stage panel
  satisfied_at text not null default 'approved' check (satisfied_at in ('uploaded','approved','accepted')),
  student_visible boolean not null default true,                         -- ask the student for it in their portal
  position int not null default 0,
  active boolean not null default true,
  options text[],                                                        -- outcome: the choices
  pass_options text[],                                                   -- outcome: the choices that count as passing
  hint text,
  unique (stage_id, key)
);

-- Per application. The stage is the portal's own (the sheet sync never touches it).
alter table public.portal_applications add column if not exists stage_key text, add column if not exists stage_at timestamptz, add column if not exists stage_by text;
create index if not exists portal_applications_stage on public.portal_applications(stage_key);

create table if not exists public.portal_app_flags (                     -- "stage:<key>" switches a conditional stage on or off, "cond:<key>" a circumstance
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  flag text not null,
  enabled boolean not null,
  note text,
  set_by text,
  set_at timestamptz not null default now(),
  primary key (application_id, flag)
);

create table if not exists public.portal_app_reqs (                      -- a requirement added for one applicant only
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  stage_key text not null,
  label text not null check (char_length(label) between 2 and 160),
  kind text not null default 'document' check (kind in ('document','confirmation','outcome')),
  doc_type text,
  need text not null default 'mandatory' check (need in ('mandatory','optional')),
  satisfied_at text not null default 'approved' check (satisfied_at in ('uploaded','approved','accepted')),
  options text[],
  pass_options text[],
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists portal_app_reqs_app on public.portal_app_reqs(application_id);

create table if not exists public.portal_req_checks (                    -- the state of one requirement for one application
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  req_id uuid references public.portal_stage_reqs(id) on delete cascade,
  app_req_id uuid references public.portal_app_reqs(id) on delete cascade,
  state text not null check (state in ('requested','received','reviewed','approved','rejected','accepted')),
  doc_id text,                                                           -- the file it is about (portal_documents.drive_file_id; no foreign key: files can leave Drive)
  value text,                                                            -- outcome requirements: the recorded outcome
  note text,
  checked_by text not null,
  checked_at timestamptz not null default now(),
  check ((req_id is not null) <> (app_req_id is not null))
);
create unique index if not exists portal_req_checks_std on public.portal_req_checks(application_id, req_id) where req_id is not null;
create unique index if not exists portal_req_checks_app on public.portal_req_checks(application_id, app_req_id) where app_req_id is not null;

create table if not exists public.portal_stage_history (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  from_key text, from_name text, to_key text, to_name text,
  kind text not null default 'move' check (kind in ('move','placed','override','school_changed','reset')),
  actor text not null,
  note text,
  missing jsonb,                                                          -- what was still open when someone overrode
  moved_at timestamptz not null default now()
);
create index if not exists portal_stage_history_app on public.portal_stage_history(application_id, moved_at desc);

alter table public.portal_workflows enable row level security;
alter table public.portal_stages enable row level security;
alter table public.portal_stage_reqs enable row level security;
alter table public.portal_app_flags enable row level security;
alter table public.portal_app_reqs enable row level security;
alter table public.portal_req_checks enable row level security;
alter table public.portal_stage_history enable row level security;

-- Starting workflows for the four schools already in the portal. Anything an admin changes later is kept: these only run once.
-- Regent College London (RCL)
insert into public.portal_workflows (workspace, school_key, school_name, conditions) values ('uk', 'rcl', 'Regent College London (RCL)'::text, '[{"key":"tb_required","label":"Needs a TB test certificate"}]'::jsonb) on conflict (workspace, school_key) do nothing;
insert into public.portal_stages (workflow_id, key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
select w.id, v.key, v.name, v.position, v.conditional, v.maps_status, v.move_roles, v.complete_when, v.notify, v.delay_days, v.offer_sync, v.hint
from public.portal_workflows w, (values
  ('offer_received'::text, 'Offer Received'::text, 10, false, 'Offer Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('interview_to_be_booked'::text, 'Interview to Be Booked'::text, 20, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, null::jsonb, null::text),
  ('interview_passed'::text, 'Interview Passed'::text, 30, false, 'Interview Passed'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, null::jsonb, null::text),
  ('tuition_fee_stage'::text, 'Tuition Fee Stage'::text, 40, true, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, 'Only when a tuition fee arrangement applies to this student.'::text),
  ('payment_plan_sent'::text, 'Payment Plan Sent'::text, 50, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, null::jsonb, null::text),
  ('qc_form_sent'::text, 'QC Form Sent'::text, 60, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, null::jsonb, null::text),
  ('payment_plan_signed'::text, 'Payment Plan Signed'::text, 70, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, null::text),
  ('tuition_fee_payment_required'::text, 'Tuition Fee Payment Required'::text, 80, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 14::int, null::jsonb, null::text),
  ('student_documents_pending'::text, 'Student Documents Pending'::text, 90, false, null::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'both'::text, 14::int, null::jsonb, 'The student sends the documents below. Each one must be reviewed and approved before this stage can finish.'::text),
  ('cas_requested'::text, 'CAS Requested'::text, 100, false, 'CAS Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 14::int, '{"cas_status":"Requested"}'::jsonb, null::text),
  ('pending_documents'::text, 'Pending Documents'::text, 110, true, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, 'Only when the school asks for more before issuing the CAS.'::text),
  ('cas_received'::text, 'CAS Received'::text, 120, false, 'CAS Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 7::int, '{"cas_status":"Received"}'::jsonb, null::text),
  ('visa_application'::text, 'Visa Application'::text, 130, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 21::int, '{"visa_status":"Preparing"}'::jsonb, null::text),
  ('visa_decision'::text, 'Visa Decision'::text, 140, false, 'Visa Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 28::int, '{"visa_status":"Decision awaited"}'::jsonb, null::text),
  ('enrolment'::text, 'Enrolment'::text, 150, false, 'Enrolled'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, null::int, null::jsonb, null::text)
) as v(key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
where w.workspace = 'uk' and w.school_key = 'rcl'
on conflict (workflow_id, key) do nothing;
insert into public.portal_stage_reqs (stage_id, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint)
select s.id, v.key, v.label, v.kind, v.doc_type, v.need, v.condition_key, v.upload, v.satisfied_at, v.student_visible, v.position, v.options, v.pass_options, v.hint
from public.portal_stages s
join public.portal_workflows w on w.id = s.workflow_id and w.workspace = 'uk' and w.school_key = 'rcl'
join (values
  ('offer_received'::text, 'offer_letter'::text, 'Offer letter'::text, 'document'::text, 'Offer Letter'::text, 'optional'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('interview_to_be_booked'::text, 'interview_outcome'::text, 'Interview outcome'::text, 'outcome'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, array['Passed','Failed','Rescheduled']::text[], array['Passed']::text[], 'Record what happened. Only “Passed” lets the application move on.'::text),
  ('tuition_fee_stage'::text, 'tuition_agreed'::text, 'Tuition fee arrangement agreed with the student'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('payment_plan_sent'::text, 'plan_sent'::text, 'Payment plan sent to the student'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('qc_form_sent'::text, 'qc_sent'::text, 'QC form sent to the student'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('payment_plan_signed'::text, 'plan_signed'::text, 'Student has signed the payment plan'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('tuition_fee_payment_required'::text, 'tuition_paid'::text, 'Tuition fee payment confirmed'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('student_documents_pending'::text, 'tb_certificate'::text, 'TB test certificate'::text, 'document'::text, 'TB certificate'::text, 'conditional'::text, 'cond:tb_required'::text, true, 'approved'::text, true, 10, null::text[], null::text[], 'Only for applicants from a country that needs a TB test.'::text),
  ('student_documents_pending'::text, 'bank_statement'::text, 'Bank statement'::text, 'document'::text, 'Bank statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 20, null::text[], null::text[], null::text),
  ('student_documents_pending'::text, 'tuition_receipt'::text, 'Tuition fee payment receipt'::text, 'document'::text, 'Tuition fee payment receipt'::text, 'conditional'::text, 'stage:tuition_fee_payment_required'::text, true, 'approved'::text, true, 30, null::text[], null::text[], null::text),
  ('student_documents_pending'::text, 'signed_payment_plan'::text, 'Signed payment plan'::text, 'document'::text, 'Signed payment plan'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 40, null::text[], null::text[], null::text),
  ('student_documents_pending'::text, 'additional_documents'::text, 'Any additional document the school asks for'::text, 'document'::text, 'Additional document'::text, 'optional'::text, null::text, true, 'approved'::text, true, 50, null::text[], null::text[], null::text),
  ('cas_requested'::text, 'cas_request_sent'::text, 'CAS request sent to the school'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('pending_documents'::text, 'school_requested_doc'::text, 'Document requested by the school'::text, 'document'::text, 'Additional document'::text, 'mandatory'::text, null::text, true, 'accepted'::text, true, 10, null::text[], null::text[], null::text),
  ('cas_received'::text, 'cas_statement'::text, 'CAS statement'::text, 'document'::text, 'CAS statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('visa_application'::text, 'visa_requirements'::text, 'Visa application requirements completed'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], 'Tick when the visa form, funds, passport and other visa requirements are all in order. Needed before the application is marked as submitted.'::text),
  ('visa_decision'::text, 'visa_decision'::text, 'Visa decision letter'::text, 'document'::text, 'Visa decision'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], 'The decision from the Home Office. A refusal needs a different route, not Enrolment.'::text)
) as v(stage_key, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint) on v.stage_key = s.key
on conflict (stage_id, key) do nothing;

-- Canterbury Christ Church University (CCCU)
insert into public.portal_workflows (workspace, school_key, school_name, conditions) values ('uk', 'cccu', 'Canterbury Christ Church University (CCCU)'::text, '[{"key":"tb_required","label":"Needs a TB test certificate"},{"key":"deposit_required","label":"Pays a tuition deposit before the CAS"}]'::jsonb) on conflict (workspace, school_key) do nothing;
insert into public.portal_stages (workflow_id, key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
select w.id, v.key, v.name, v.position, v.conditional, v.maps_status, v.move_roles, v.complete_when, v.notify, v.delay_days, v.offer_sync, v.hint
from public.portal_workflows w, (values
  ('offer_received'::text, 'Offer Received'::text, 10, false, 'Offer Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('first_interview'::text, 'First Interview'::text, 20, false, 'Interview Taken'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, null::text),
  ('documents_for_unconditional_offer'::text, 'Documents Required for Unconditional Offer'::text, 30, false, null::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'both'::text, 14::int, null::jsonb, 'These must be received and approved before the unconditional offer is requested.'::text),
  ('unconditional_offer_requested'::text, 'Unconditional Offer Requested'::text, 40, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('unconditional_offer_received'::text, 'Unconditional Offer Received'::text, 50, false, 'Unconditional Offer'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 7::int, '{"offer_type":"Unconditional"}'::jsonb, null::text),
  ('precas_interview'::text, 'Pre-CAS Interview'::text, 60, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, null::text),
  ('precas_interview_passed'::text, 'Pre-CAS Interview Passed'::text, 70, false, null::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'counselor'::text, 10::int, null::jsonb, 'Check the school’s CAS requirements and have everything ready before the CAS is requested.'::text),
  ('cas_requested'::text, 'CAS Requested'::text, 80, false, 'CAS Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 14::int, '{"cas_status":"Requested"}'::jsonb, null::text),
  ('cas_received'::text, 'CAS Received'::text, 90, false, 'CAS Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 7::int, '{"cas_status":"Received"}'::jsonb, null::text),
  ('visa_application_started'::text, 'Visa Application Started'::text, 100, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 21::int, '{"visa_status":"Preparing"}'::jsonb, null::text),
  ('visa_application_submitted'::text, 'Visa Application Submitted'::text, 110, false, 'Visa Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, '{"visa_status":"Applied"}'::jsonb, null::text),
  ('awaiting_visa_decision'::text, 'Awaiting Visa Decision'::text, 120, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 28::int, '{"visa_status":"Decision awaited"}'::jsonb, null::text),
  ('visa_decision_received'::text, 'Visa Decision Received'::text, 130, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, null::int, null::jsonb, null::text),
  ('enrolment'::text, 'Enrolment'::text, 140, false, 'Enrolled'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, null::int, null::jsonb, null::text)
) as v(key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
where w.workspace = 'uk' and w.school_key = 'cccu'
on conflict (workflow_id, key) do nothing;
insert into public.portal_stage_reqs (stage_id, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint)
select s.id, v.key, v.label, v.kind, v.doc_type, v.need, v.condition_key, v.upload, v.satisfied_at, v.student_visible, v.position, v.options, v.pass_options, v.hint
from public.portal_stages s
join public.portal_workflows w on w.id = s.workflow_id and w.workspace = 'uk' and w.school_key = 'cccu'
join (values
  ('offer_received'::text, 'offer_letter'::text, 'Offer letter'::text, 'document'::text, 'Offer Letter'::text, 'optional'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('first_interview'::text, 'interview_outcome'::text, 'First interview outcome'::text, 'outcome'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, array['Passed','Failed','Rescheduled']::text[], array['Passed']::text[], 'Record what happened. Only “Passed” lets the application move on.'::text),
  ('documents_for_unconditional_offer'::text, 'passport'::text, 'Passport'::text, 'document'::text, 'Passport'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('documents_for_unconditional_offer'::text, 'degree_certificate'::text, 'Degree certificate'::text, 'document'::text, 'Degree Certificate'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 20, null::text[], null::text[], null::text),
  ('documents_for_unconditional_offer'::text, 'transcript'::text, 'Transcript'::text, 'document'::text, 'Transcript'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 30, null::text[], null::text[], null::text),
  ('documents_for_unconditional_offer'::text, 'english_test'::text, 'English language test'::text, 'document'::text, 'IELTS'::text, 'optional'::text, null::text, true, 'approved'::text, true, 40, null::text[], null::text[], null::text),
  ('unconditional_offer_requested'::text, 'request_sent'::text, 'Request for the unconditional offer sent to the university'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('unconditional_offer_received'::text, 'unconditional_letter'::text, 'Unconditional offer letter'::text, 'document'::text, 'Offer Letter'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('precas_interview'::text, 'interview_outcome'::text, 'Pre-CAS interview outcome'::text, 'outcome'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, array['Passed','Failed','Rescheduled']::text[], array['Passed']::text[], 'Record what happened. Only “Passed” lets the application move on.'::text),
  ('precas_interview_passed'::text, 'passport_cas'::text, 'Passport'::text, 'document'::text, 'Passport'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('precas_interview_passed'::text, 'bank_statement'::text, 'Bank statement'::text, 'document'::text, 'Bank statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 20, null::text[], null::text[], null::text),
  ('precas_interview_passed'::text, 'tb_certificate'::text, 'TB test certificate'::text, 'document'::text, 'TB certificate'::text, 'conditional'::text, 'cond:tb_required'::text, true, 'approved'::text, true, 30, null::text[], null::text[], 'Only for applicants from a country that needs a TB test.'::text),
  ('precas_interview_passed'::text, 'deposit_receipt'::text, 'Tuition deposit receipt'::text, 'document'::text, 'Tuition deposit receipt'::text, 'conditional'::text, 'cond:deposit_required'::text, true, 'approved'::text, true, 40, null::text[], null::text[], null::text),
  ('precas_interview_passed'::text, 'cas_checked'::text, 'The school’s CAS requirements have been checked'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 50, null::text[], null::text[], null::text),
  ('cas_received'::text, 'cas_statement'::text, 'CAS statement'::text, 'document'::text, 'CAS statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('visa_application_started'::text, 'visa_requirements'::text, 'Visa application requirements completed'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], 'Tick when the visa form, funds, passport and other visa requirements are all in order. Needed before the application is marked as submitted.'::text),
  ('visa_application_submitted'::text, 'visa_submission'::text, 'Visa application confirmation'::text, 'document'::text, 'Visa application confirmation'::text, 'optional'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('visa_decision_received'::text, 'visa_decision'::text, 'Visa decision letter'::text, 'document'::text, 'Visa decision'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], 'The decision from the Home Office. A refusal needs a different route, not Enrolment.'::text)
) as v(stage_key, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint) on v.stage_key = s.key
on conflict (stage_id, key) do nothing;

-- BPP University
insert into public.portal_workflows (workspace, school_key, school_name, conditions) values ('uk', 'bpp', 'BPP University'::text, '[{"key":"tb_required","label":"Needs a TB test certificate"}]'::jsonb) on conflict (workspace, school_key) do nothing;
insert into public.portal_stages (workflow_id, key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
select w.id, v.key, v.name, v.position, v.conditional, v.maps_status, v.move_roles, v.complete_when, v.notify, v.delay_days, v.offer_sync, v.hint
from public.portal_workflows w, (values
  ('documents_sent'::text, 'Documents Sent'::text, 10, false, 'Submitted'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('offer_received'::text, 'Offer Received'::text, 20, false, 'Offer Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('bank_statement_review'::text, 'Bank Statement Review'::text, 30, false, null::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'counselor'::text, 7::int, null::jsonb, 'Check the funds on the statement against the school’s financial requirement.'::text),
  ('application_form_completed'::text, 'Application Form Completed'::text, 40, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, null::text),
  ('cas_documents_ready'::text, 'CAS Documents Ready'::text, 50, false, null::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'both'::text, 10::int, null::jsonb, 'Everything the school needs for the CAS. Move on only when all of it is ready.'::text),
  ('cas_requested'::text, 'CAS Requested'::text, 60, false, 'CAS Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, '{"cas_status":"Requested"}'::jsonb, null::text),
  ('awaiting_precas_interview'::text, 'Awaiting Pre-CAS Interview'::text, 70, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('precas_interview_completed'::text, 'Pre-CAS Interview Completed'::text, 80, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, null::text),
  ('cas_received'::text, 'CAS Received'::text, 90, false, 'CAS Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 7::int, '{"cas_status":"Received"}'::jsonb, null::text),
  ('visa_application_submitted'::text, 'Visa Application Submitted'::text, 100, false, 'Visa Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, '{"visa_status":"Applied"}'::jsonb, null::text),
  ('awaiting_visa_decision'::text, 'Awaiting Visa Decision'::text, 110, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 28::int, '{"visa_status":"Decision awaited"}'::jsonb, null::text),
  ('enrolment'::text, 'Enrolment'::text, 120, false, 'Enrolled'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, null::int, null::jsonb, null::text)
) as v(key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
where w.workspace = 'uk' and w.school_key = 'bpp'
on conflict (workflow_id, key) do nothing;
insert into public.portal_stage_reqs (stage_id, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint)
select s.id, v.key, v.label, v.kind, v.doc_type, v.need, v.condition_key, v.upload, v.satisfied_at, v.student_visible, v.position, v.options, v.pass_options, v.hint
from public.portal_stages s
join public.portal_workflows w on w.id = s.workflow_id and w.workspace = 'uk' and w.school_key = 'bpp'
join (values
  ('offer_received'::text, 'offer_letter'::text, 'Offer letter'::text, 'document'::text, 'Offer Letter'::text, 'optional'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('bank_statement_review'::text, 'bank_statement'::text, 'Bank statement'::text, 'document'::text, 'Bank statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('bank_statement_review'::text, 'funds_verified'::text, 'Financial requirement checked and met'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 20, null::text[], null::text[], null::text),
  ('application_form_completed'::text, 'application_form'::text, 'Completed application form'::text, 'document'::text, 'Application form'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('cas_documents_ready'::text, 'passport'::text, 'Passport'::text, 'document'::text, 'Passport'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('cas_documents_ready'::text, 'tb_certificate'::text, 'TB test certificate'::text, 'document'::text, 'TB certificate'::text, 'conditional'::text, 'cond:tb_required'::text, true, 'approved'::text, true, 20, null::text[], null::text[], 'Only for applicants from a country that needs a TB test.'::text),
  ('cas_documents_ready'::text, 'cas_ready'::text, 'All CAS documents are ready'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 30, null::text[], null::text[], null::text),
  ('awaiting_precas_interview'::text, 'interview_outcome'::text, 'Pre-CAS interview outcome'::text, 'outcome'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, array['Passed','Failed','Rescheduled']::text[], array['Passed']::text[], 'Record what happened. Only “Passed” lets the application move on.'::text),
  ('cas_received'::text, 'cas_statement'::text, 'CAS statement'::text, 'document'::text, 'CAS statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('cas_received'::text, 'visa_requirements'::text, 'Visa application requirements completed'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 20, null::text[], null::text[], 'Tick when the visa form, funds, passport and other visa requirements are all in order. Needed before the application is marked as submitted.'::text),
  ('awaiting_visa_decision'::text, 'visa_decision'::text, 'Visa decision letter'::text, 'document'::text, 'Visa decision'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], 'The decision from the Home Office. A refusal needs a different route, not Enrolment.'::text)
) as v(stage_key, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint) on v.stage_key = s.key
on conflict (stage_id, key) do nothing;

-- York St John University
insert into public.portal_workflows (workspace, school_key, school_name, conditions) values ('uk', 'ysj', 'York St John University'::text, '[{"key":"tb_required","label":"Needs a TB test certificate"},{"key":"deposit_required","label":"Pays a tuition deposit before the CAS"}]'::jsonb) on conflict (workspace, school_key) do nothing;
insert into public.portal_stages (workflow_id, key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
select w.id, v.key, v.name, v.position, v.conditional, v.maps_status, v.move_roles, v.complete_when, v.notify, v.delay_days, v.offer_sync, v.hint
from public.portal_workflows w, (values
  ('offer_received'::text, 'Offer Received'::text, 10, false, 'Offer Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('interview_pending'::text, 'Interview Pending'::text, 20, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 10::int, null::jsonb, null::text),
  ('interview_passed'::text, 'Interview Passed'::text, 30, false, 'Interview Passed'::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'counselor'::text, 10::int, null::jsonb, 'Documents the university needs before an unconditional offer can be requested.'::text),
  ('unconditional_offer_requested'::text, 'Unconditional Offer Requested'::text, 40, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, null::jsonb, null::text),
  ('unconditional_offer_received'::text, 'Unconditional Offer Received'::text, 50, false, 'Unconditional Offer'::text, array['admin','staff','counselor']::text[], 'requirements'::text, 'both'::text, 10::int, '{"offer_type":"Unconditional"}'::jsonb, 'Check the CAS requirements and have the documents ready before the CAS is requested.'::text),
  ('cas_requested'::text, 'CAS Requested'::text, 60, false, 'CAS Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 14::int, '{"cas_status":"Requested"}'::jsonb, null::text),
  ('cas_sent'::text, 'CAS Sent'::text, 70, false, 'CAS Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 7::int, null::jsonb, null::text),
  ('cas_received'::text, 'CAS Received'::text, 80, false, 'CAS Received'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, 7::int, '{"cas_status":"Received"}'::jsonb, null::text),
  ('visa_application_started'::text, 'Visa Application Started'::text, 90, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 21::int, '{"visa_status":"Preparing"}'::jsonb, null::text),
  ('visa_application_submitted'::text, 'Visa Application Submitted'::text, 100, false, 'Visa Applied'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 7::int, '{"visa_status":"Applied"}'::jsonb, null::text),
  ('awaiting_visa_decision'::text, 'Awaiting Visa Decision'::text, 110, false, null::text, array['admin','staff','counselor']::text[], 'manual'::text, 'counselor'::text, 28::int, '{"visa_status":"Decision awaited"}'::jsonb, null::text),
  ('enrolment'::text, 'Enrolment'::text, 120, false, 'Enrolled'::text, array['admin','staff','counselor']::text[], 'manual'::text, 'both'::text, null::int, null::jsonb, null::text)
) as v(key, name, position, conditional, maps_status, move_roles, complete_when, notify, delay_days, offer_sync, hint)
where w.workspace = 'uk' and w.school_key = 'ysj'
on conflict (workflow_id, key) do nothing;
insert into public.portal_stage_reqs (stage_id, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint)
select s.id, v.key, v.label, v.kind, v.doc_type, v.need, v.condition_key, v.upload, v.satisfied_at, v.student_visible, v.position, v.options, v.pass_options, v.hint
from public.portal_stages s
join public.portal_workflows w on w.id = s.workflow_id and w.workspace = 'uk' and w.school_key = 'ysj'
join (values
  ('offer_received'::text, 'offer_letter'::text, 'Offer letter'::text, 'document'::text, 'Offer Letter'::text, 'optional'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('interview_pending'::text, 'interview_outcome'::text, 'Interview outcome'::text, 'outcome'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, array['Passed','Failed','Rescheduled']::text[], array['Passed']::text[], 'Record what happened. Only “Passed” lets the application move on.'::text),
  ('interview_passed'::text, 'passport'::text, 'Passport'::text, 'document'::text, 'Passport'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('interview_passed'::text, 'degree_certificate'::text, 'Degree certificate'::text, 'document'::text, 'Degree Certificate'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 20, null::text[], null::text[], null::text),
  ('interview_passed'::text, 'transcript'::text, 'Transcript'::text, 'document'::text, 'Transcript'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 30, null::text[], null::text[], null::text),
  ('interview_passed'::text, 'english_test'::text, 'English language test'::text, 'document'::text, 'IELTS'::text, 'optional'::text, null::text, true, 'approved'::text, true, 40, null::text[], null::text[], null::text),
  ('unconditional_offer_requested'::text, 'request_sent'::text, 'Request for the unconditional offer sent to the university'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], null::text),
  ('unconditional_offer_received'::text, 'unconditional_letter'::text, 'Unconditional offer letter'::text, 'document'::text, 'Offer Letter'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('unconditional_offer_received'::text, 'bank_statement'::text, 'Bank statement'::text, 'document'::text, 'Bank statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 20, null::text[], null::text[], null::text),
  ('unconditional_offer_received'::text, 'tb_certificate'::text, 'TB test certificate'::text, 'document'::text, 'TB certificate'::text, 'conditional'::text, 'cond:tb_required'::text, true, 'approved'::text, true, 30, null::text[], null::text[], 'Only for applicants from a country that needs a TB test.'::text),
  ('unconditional_offer_received'::text, 'deposit_receipt'::text, 'Tuition deposit receipt'::text, 'document'::text, 'Tuition deposit receipt'::text, 'conditional'::text, 'cond:deposit_required'::text, true, 'approved'::text, true, 40, null::text[], null::text[], null::text),
  ('cas_received'::text, 'cas_statement'::text, 'CAS statement'::text, 'document'::text, 'CAS statement'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], null::text),
  ('visa_application_started'::text, 'visa_requirements'::text, 'Visa application requirements completed'::text, 'confirmation'::text, null::text, 'mandatory'::text, null::text, false, 'approved'::text, false, 10, null::text[], null::text[], 'Tick when the visa form, funds, passport and other visa requirements are all in order. Needed before the application is marked as submitted.'::text),
  ('awaiting_visa_decision'::text, 'visa_decision'::text, 'Visa decision letter'::text, 'document'::text, 'Visa decision'::text, 'mandatory'::text, null::text, true, 'approved'::text, true, 10, null::text[], null::text[], 'The decision from the Home Office. A refusal needs a different route, not Enrolment.'::text)
) as v(stage_key, key, label, kind, doc_type, need, condition_key, upload, satisfied_at, student_visible, position, options, pass_options, hint) on v.stage_key = s.key
on conflict (stage_id, key) do nothing;

