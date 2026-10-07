-- AI overview, to-do list, "new since last visit" tracking.
alter table portal_staff add column if not exists last_seen_at timestamptz;

create table if not exists portal_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,            -- kind:application_id — one task per situation, so nothing is reported twice
  kind text not null,
  application_id text references portal_applications(application_id) on delete cascade,
  title text not null,
  detail text,
  priority int not null default 2,          -- 1 high, 2 normal, 3 low
  status text not null default 'open' check (status in ('open','done','dismissed','snoozed','resolved')),
  suppress_until timestamptz,               -- done/dismissed/snoozed tasks stay hidden until then
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text                          -- staff email, or 'system' when the situation cleared by itself
);
create index if not exists portal_tasks_status on portal_tasks(status, priority);

create table if not exists portal_ai_cache (
  cache_key text primary key,
  kind text not null,
  input_hash text not null,                 -- summary is reused until the underlying data changes
  output jsonb not null,
  model text,
  tokens int,
  created_at timestamptz not null default now()
);

create table if not exists portal_ai_usage (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  tokens int,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists portal_ai_usage_day on portal_ai_usage(created_at);

alter table portal_tasks enable row level security;
alter table portal_ai_cache enable row level security;
alter table portal_ai_usage enable row level security;
