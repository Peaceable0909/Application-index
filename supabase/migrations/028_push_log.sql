-- A short rolling record of what happened to each phone alert, so "why didn't I get it?" can be answered.
create table if not exists portal_push_log (
  id bigint generated always as identity primary key,
  email text not null, tag text, result text not null, detail text,
  created_at timestamptz not null default now()
);
create index if not exists portal_push_log_at on portal_push_log(created_at desc);
alter table portal_push_log enable row level security;
