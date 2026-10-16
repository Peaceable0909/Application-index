-- The "vs last 7 days" snapshot is kept per workspace.
alter table public.portal_snapshots add column if not exists workspace text not null default 'uk';
alter table public.portal_snapshots drop constraint if exists portal_snapshots_pkey;
alter table public.portal_snapshots add primary key (day, workspace);
