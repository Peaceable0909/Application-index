-- What the team has asked of a student or told them by email, mirrored inside the student portal (bell + "to do").
create table if not exists portal_student_notices (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  application_id text references portal_applications(application_id) on delete set null,
  kind text not null,                  -- docs | payment | offer | interview | message
  title text not null, body text, href text, created_by text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists portal_student_notices_email on portal_student_notices(email, created_at desc);
alter table portal_student_notices enable row level security;
