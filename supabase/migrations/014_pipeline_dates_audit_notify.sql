-- Intake + deadline per student, admin audit log, email-notification log/opt-out, private backups bucket.
alter table portal_applications add column if not exists intake text, add column if not exists deadline date;
alter table portal_staff add column if not exists notify_email boolean not null default true;
create table if not exists portal_audit (
  id uuid primary key default gen_random_uuid(),
  actor text not null, action text not null, target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists portal_audit_time on portal_audit(created_at desc);
alter table portal_audit enable row level security;
create table if not exists portal_notify_log (
  id uuid primary key default gen_random_uuid(),
  email text not null, kind text not null, ref text,
  created_at timestamptz not null default now()
);
create index if not exists portal_notify_log_lookup on portal_notify_log(email, kind, ref, created_at desc);
alter table portal_notify_log enable row level security;
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do update set public = false;
