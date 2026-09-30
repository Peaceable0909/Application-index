-- WhiteRock staff portal. All tables are prefixed portal_ so they never touch
-- the existing ELLT / wr_* tables in this project.
-- RLS is enabled with NO policies: only the server (service role) can read or
-- write. The browser never talks to these tables directly (student PII).

create table if not exists portal_staff (
  email text primary key,
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create table if not exists portal_counselors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_key text not null unique,          -- normalised: lowercase, titles removed
  email text,                             -- entered manually in Settings
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists portal_applications (
  application_id text primary key,        -- Sheet column Q (uuid)
  sheet_row int,
  submitted_at timestamptz,
  name text not null,
  email text,
  phone text,
  school text,
  programme text,
  country text,
  city text,
  gender text,
  dob text,
  age text,
  counselor text,
  status text,
  sheet_notes text,
  drive_folder_id text,
  drive_folder_url text,
  student_key text not null,              -- lower(email)|school, groups duplicate submissions
  docs_synced_at timestamptz,
  last_activity_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists portal_applications_student_key on portal_applications(student_key);
create index if not exists portal_applications_status on portal_applications(status);

create table if not exists portal_documents (
  drive_file_id text primary key,
  application_id text not null references portal_applications(application_id) on delete cascade,
  name text not null,
  doc_type text not null,
  mime_type text,
  size_bytes bigint,
  drive_url text,
  source text not null default 'app' check (source in ('app','portal')),
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists portal_documents_app on portal_documents(application_id);

create table if not exists portal_notes (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references portal_applications(application_id) on delete cascade,
  author text not null,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists portal_notes_app on portal_notes(application_id, created_at desc);

create table if not exists portal_activity (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references portal_applications(application_id) on delete cascade,
  actor text not null,                    -- staff email, or 'system'
  kind text not null,                     -- new_application | status_change | counselor_change | note | email_sent | doc_uploaded
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists portal_activity_app on portal_activity(application_id, created_at desc);

alter table portal_staff enable row level security;
alter table portal_counselors enable row level security;
alter table portal_applications enable row level security;
alter table portal_documents enable row level security;
alter table portal_notes enable row level security;
alter table portal_activity enable row level security;

-- First admin. Add others from Settings in the portal.
insert into portal_staff (email, role) values ('femiolaniyi36@gmail.com', 'admin') on conflict do nothing;
