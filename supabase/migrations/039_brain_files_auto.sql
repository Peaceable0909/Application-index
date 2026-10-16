-- Teaching the Brain from files, and automatic replies (off by default, per workspace).
create table if not exists public.portal_brain_docs (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'uk' references public.portal_workspaces(key),
  title text not null check (char_length(title) between 2 and 120),
  school text,
  body text not null,
  chars int not null,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index if not exists portal_brain_docs_ws on public.portal_brain_docs(workspace);
alter table public.portal_brain_docs enable row level security;

alter table public.portal_workspaces add column if not exists auto_reply boolean not null default false;
alter table public.portal_student_msgs add column if not exists by_ai boolean not null default false;

-- Per student: a counselor can pause the AI in one chat.
create table if not exists public.portal_brain_chat (
  student_email text primary key,
  paused boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.portal_brain_chat enable row level security;
