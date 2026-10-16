-- A short "about this country" text the AI Brain reads for every student of that workspace.
alter table public.portal_workspaces add column if not exists brief text check (brief is null or char_length(brief) <= 3000);
