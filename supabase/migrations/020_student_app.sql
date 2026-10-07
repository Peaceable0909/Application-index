-- Student app: in-portal conversation with the counselor, a per-student checklist, and a heartbeat so we don't email people who are already here.
create table if not exists portal_student_msgs (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  application_id text references portal_applications(application_id) on delete set null,
  from_student boolean not null,
  sender_email text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  student_read_at timestamptz,
  staff_read_at timestamptz
);
create index if not exists portal_student_msgs_thread on portal_student_msgs(student_email, created_at desc);
create index if not exists portal_student_msgs_unread on portal_student_msgs(from_student, staff_read_at) where staff_read_at is null;
alter table portal_student_msgs enable row level security;
create table if not exists portal_checklist (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references portal_applications(application_id) on delete cascade,
  text text not null check (char_length(text) between 2 and 160),
  due date, done boolean not null default false, done_at timestamptz,
  created_by text not null, created_at timestamptz not null default now()
);
create index if not exists portal_checklist_app on portal_checklist(application_id, created_at);
alter table portal_checklist enable row level security;
create table if not exists portal_student_seen (email text primary key, last_active_at timestamptz not null default now());
alter table portal_student_seen enable row level security;
