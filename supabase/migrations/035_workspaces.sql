-- Workspaces: one per country. Students, documents and chats belong to exactly one; staff are given the workspaces they may open.
-- Everything that exists today becomes the 'uk' workspace, so nothing changes until a second one is created.
create table if not exists public.portal_workspaces (
  key text primary key check (key ~ '^[a-z][a-z0-9-]{1,23}$'),
  name text not null check (char_length(name) between 2 and 60),
  master_tab text not null,                 -- the Google Sheet tab that lists this workspace's students
  extra_tab text,                           -- optional second tab (like "Regent Only")
  drive_folder_name text,                   -- Drive folder that holds this workspace's student folders (null = the default one)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.portal_workspaces enable row level security;
insert into public.portal_workspaces (key, name, master_tab, extra_tab) values ('uk', 'United Kingdom', 'Sheet1', 'Regent Only') on conflict (key) do nothing;

alter table public.portal_applications add column if not exists workspace text not null default 'uk' references public.portal_workspaces(key);
create index if not exists portal_applications_workspace on public.portal_applications(workspace);
alter table public.portal_staff add column if not exists workspaces text[] not null default '{uk}';
alter table public.portal_brain_notes add column if not exists workspace text not null default 'uk' references public.portal_workspaces(key);
alter table public.portal_interview_slots add column if not exists workspace text not null default 'uk' references public.portal_workspaces(key);
alter table public.portal_cred_questions add column if not exists workspace text not null default 'uk' references public.portal_workspaces(key);
