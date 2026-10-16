-- New-student chat (prospects who are not in the portal yet) and what the Brain remembers about each student.
-- All server-only like every portal_ table.
create table if not exists public.portal_leads (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references public.portal_workspaces(key),
  token_hash text not null unique,                 -- hash of the cookie that lets the visitor come back to their chat
  name text, email text, phone text,
  interest text,                                   -- what they want to study, where, when
  summary text,                                    -- the Brain's running summary of the chat
  needs jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','contacted','converted','closed')),
  consent_at timestamptz not null,
  converted_app text references public.portal_applications(application_id) on delete set null,
  ip_hash text,
  ai_paused boolean not null default false,
  needs_human boolean not null default false,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  staff_read_at timestamptz
);
create index if not exists portal_leads_ws on public.portal_leads(workspace, last_message_at desc);
create index if not exists portal_leads_ip on public.portal_leads(ip_hash, created_at desc);
alter table public.portal_leads enable row level security;

create table if not exists public.portal_lead_msgs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.portal_leads(id) on delete cascade,
  from_lead boolean not null,
  by_ai boolean not null default false,
  sender text,                                     -- staff email for a person's reply
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists portal_lead_msgs_lead on public.portal_lead_msgs(lead_id, created_at);
alter table public.portal_lead_msgs enable row level security;

create table if not exists public.portal_student_memory (
  student_email text primary key,
  summary text not null default '',
  needs jsonb not null default '[]'::jsonb,
  interests jsonb not null default '{}'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '[]'::jsonb,
  msgs_seen int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.portal_student_memory enable row level security;

-- one AI-written note per student, replaced each time instead of piling up
alter table public.portal_notes add column if not exists ai_key text;
create unique index if not exists portal_notes_ai on public.portal_notes(application_id, ai_key) where ai_key is not null;
