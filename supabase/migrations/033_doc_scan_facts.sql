-- Key details the document reader found on each file (e.g. Degree class, IELTS overall). Server-only, like every portal_ table.
alter table public.portal_doc_scans add column if not exists facts jsonb not null default '[]'::jsonb;
