-- The documents every student of a workspace must send. Null = the original list (Passport, CV, Transcript, Degree Certificate, WAEC/NECO, SOP). Set from the portal.
alter table public.portal_workspaces add column if not exists required_docs text[] check (required_docs is null or cardinality(required_docs) between 1 and 15);
