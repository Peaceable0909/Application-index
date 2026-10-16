-- What the AI Brain is allowed to know beyond a student's own file: facts the team writes down once (school requirements, fees policy, visa steps...).
-- Server-only like every portal_ table (RLS on, no policies).
create table if not exists public.portal_brain_notes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 80),
  body text not null check (char_length(body) between 2 and 1500),
  school text,                       -- null = applies to every student; otherwise matched to the student's school
  active boolean not null default true,
  created_by text not null,
  updated_at timestamptz not null default now()
);
alter table public.portal_brain_notes enable row level security;
