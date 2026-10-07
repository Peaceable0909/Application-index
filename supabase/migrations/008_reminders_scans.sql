create table if not exists portal_reminders (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references portal_applications(application_id) on delete cascade,
  due_on date not null,
  note text not null,
  status text not null default 'pending' check (status in ('pending','done')),
  created_by text not null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists portal_reminders_due on portal_reminders(status, due_on);

-- Result of an opt-in AI check of one document. Only extracted facts are kept, never the document text.
create table if not exists portal_doc_scans (
  drive_file_id text primary key,
  application_id text not null references portal_applications(application_id) on delete cascade,
  detected_type text,
  confidence numeric,
  person_name text,
  issuer text,
  expiry_date text,
  flags jsonb not null default '[]'::jsonb,
  readable boolean not null default true,
  scanned_by text not null,
  created_at timestamptz not null default now()
);
alter table portal_reminders enable row level security;
alter table portal_doc_scans enable row level security;
