-- The public "new student" chat for a workspace. Off until an admin switches it on.
alter table public.portal_workspaces add column if not exists lead_chat boolean not null default false;
