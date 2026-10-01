-- Sent-email log (counselor + student messages) and daily snapshots for "vs last 7 days" trends.
create table if not exists portal_messages (
  id uuid primary key default gen_random_uuid(),
  application_id text references portal_applications(application_id) on delete set null,
  counselor_name text,
  to_email text not null,
  to_kind text not null default 'other' check (to_kind in ('counselor','student','other')),
  subject text not null,
  body text not null,
  sent_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists portal_messages_app on portal_messages(application_id, created_at desc);
create index if not exists portal_messages_time on portal_messages(created_at desc);

create table if not exists portal_snapshots (
  day date primary key,
  total int not null,
  awaiting int not null,
  missing int not null,
  in_progress int not null,
  created_at timestamptz not null default now()
);
alter table portal_messages enable row level security;
alter table portal_snapshots enable row level security;
