-- Reversible archive for applications hidden from active portal lists.
-- This intentionally preserves source Sheets, Drive files, and linked portal history.
alter table public.portal_applications
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;

create index if not exists portal_applications_archived_workspace
  on public.portal_applications (workspace, archived_at desc)
  where archived_at is not null;
