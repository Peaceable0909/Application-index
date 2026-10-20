-- The daily follow-up list: what was sent to a student (chat or email) or skipped, so the same reminder isn't offered again too soon.
create table if not exists public.portal_nudges (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references public.portal_applications(application_id) on delete cascade,
  kind text not null check (kind in ('reply','docs','passport','interview','follow_up')),
  channel text not null check (channel in ('chat','email','skipped')),
  by text not null,
  skip_until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portal_nudges_app on public.portal_nudges(application_id, kind, created_at desc);
alter table public.portal_nudges enable row level security;
