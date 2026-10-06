-- Offer & visa tracking (one row per application) and interview-training sessions students can book (Teams link per session).
create table if not exists portal_offers (
  application_id text primary key references portal_applications(application_id) on delete cascade,
  offer_type text check (offer_type in ('Conditional','Unconditional')),
  offer_date date,
  offer_doc_id text references portal_documents(drive_file_id) on delete set null,
  conditions jsonb not null default '[]'::jsonb,      -- [{ "text": "...", "met": false, "due": "2026-11-01" }]
  deposit_due date,
  cas_status text, cas_applied_date date, cas_received_date date,
  visa_status text, visa_applied_date date, visa_biometrics_date date, visa_decision_date date,
  student_note text,
  visible_to_student boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table portal_offers enable row level security;
create table if not exists portal_interview_slots (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  duration_min int not null default 45 check (duration_min between 10 and 240),
  trainer text, teams_url text not null,
  capacity int not null default 1 check (capacity between 1 and 20),
  notes text, created_by text not null,
  created_at timestamptz not null default now(), cancelled_at timestamptz
);
create index if not exists portal_interview_slots_time on portal_interview_slots(starts_at);
create table if not exists portal_interview_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references portal_interview_slots(id) on delete cascade,
  application_id text not null references portal_applications(application_id) on delete cascade,
  student_email text not null,
  status text not null default 'booked' check (status in ('booked','cancelled','completed','no_show')),
  booked_by text, feedback text, feedback_visible boolean not null default false,
  reminded_at timestamptz,
  created_at timestamptz not null default now(), cancelled_at timestamptz
);
create index if not exists portal_interview_bookings_slot on portal_interview_bookings(slot_id);
create index if not exists portal_interview_bookings_app on portal_interview_bookings(application_id);
alter table portal_interview_slots enable row level security;
alter table portal_interview_bookings enable row level security;
