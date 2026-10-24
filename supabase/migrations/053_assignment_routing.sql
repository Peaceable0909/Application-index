-- Counselor responsibilities and automatic routing.
--
-- A responsibility (rule) says "this counselor is responsible for this school / this whole destination (workspace) / this location", as the
-- primary or a backup, for receiving the application or for handling its documents. Rules never change existing applications: they are read when
-- a new application arrives (or when an admin runs them on the unassigned queue). Priority: school, then destination, then location, then the
-- Team Head / admin queue. Two primaries at the same level is a conflict that a person resolves.
alter table public.portal_workspaces add column if not exists auto_route boolean not null default true;

create table if not exists public.portal_assign_rules (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references public.portal_workspaces(key),
  kind text not null default 'application' check (kind in ('application','documents')),
  scope text not null check (scope in ('school','country','location')),
  school_key text,                      -- schoolKey() of the school (scope = school)
  school_name text,
  location_key text,                    -- normalised city / office (scope = location)
  location_name text,
  counselor_key text not null,          -- portal_counselors.name_key (names come from the sheet, so no foreign key)
  role text not null default 'primary' check (role in ('primary','backup')),
  active boolean not null default true,
  paused_until date,                    -- switched off until this date (a counselor away); null = until switched back on
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  check ((scope = 'school' and school_key is not null) or (scope = 'location' and location_key is not null) or scope = 'country')
);
create index if not exists portal_assign_rules_ws on public.portal_assign_rules(workspace, kind, scope);

-- Who owned each application, since when, why, and who changed it. One row per change; nothing is overwritten.
create table if not exists public.portal_assign_log (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('auto','manual','bulk','sheet','queue','conflict','resolved','documents')),
  from_counselor text,
  to_counselor text,
  reason text,
  level text,
  rule_id uuid,
  actor text not null default 'system',
  detail jsonb
);
create index if not exists portal_assign_log_app on public.portal_assign_log(application_id, at desc);

-- Two or more counselors qualify equally: flagged for a person to choose, never decided at random.
create table if not exists public.portal_assign_conflicts (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  level text not null,
  candidates jsonb not null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  chosen text,
  note text
);
create unique index if not exists portal_assign_conflicts_open on public.portal_assign_conflicts(application_id) where status = 'open';

-- What a Team Head oversees. A Team Head is a person with at least one scope here; their normal role (admin / staff / counselor) is unchanged.
create table if not exists public.portal_head_scopes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  workspace text not null references public.portal_workspaces(key),
  scope text not null check (scope in ('school','country','location')),
  school_key text,
  school_name text,
  location_key text,
  location_name text,
  created_by text,
  created_at timestamptz not null default now(),
  check ((scope = 'school' and school_key is not null) or (scope = 'location' and location_key is not null) or scope = 'country')
);
create index if not exists portal_head_scopes_email on public.portal_head_scopes(email);
alter table public.portal_staff add column if not exists team_head boolean not null default false;

alter table public.portal_applications
  add column if not exists assign_state text check (assign_state in ('assigned','queue','conflict')),
  add column if not exists assign_reason text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by text,
  add column if not exists doc_handler text,        -- counselor_key of whoever receives and processes this application's documents
  add column if not exists routed_at timestamptz;   -- set once routing has looked at the application, so an update never routes it again
create index if not exists portal_applications_assign_state on public.portal_applications(assign_state) where assign_state is not null;

alter table public.portal_assign_rules enable row level security;
alter table public.portal_assign_log enable row level security;
alter table public.portal_assign_conflicts enable row level security;
alter table public.portal_head_scopes enable row level security;
