-- How a document was read: 'mrz' (a passport read exactly from its machine-readable lines, no AI), 'ai', or 'unreadable'.
alter table public.portal_doc_scans add column if not exists method text check (method is null or method in ('mrz','ai','unreadable'));
