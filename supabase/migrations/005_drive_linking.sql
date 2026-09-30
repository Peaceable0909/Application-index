-- Link extra / manual Drive folders to a student, and hold folder suggestions found by searching Drive.
alter table portal_applications
  add column if not exists extra_folder_ids text[] not null default '{}',
  add column if not exists drive_scan_at timestamptz;

create table if not exists portal_folder_suggestions (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references portal_applications(application_id) on delete cascade,
  folder_id text not null,
  folder_name text not null,
  folder_url text,
  parent_name text,
  score numeric not null,
  exact boolean not null default false,
  file_count int,
  modified_at timestamptz,
  status text not null default 'new' check (status in ('new','linked','dismissed')),
  created_at timestamptz not null default now(),
  unique (application_id, folder_id)
);
create index if not exists portal_folder_suggestions_status on portal_folder_suggestions(status);
alter table portal_folder_suggestions enable row level security;
