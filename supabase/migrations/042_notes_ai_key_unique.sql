-- A plain (not partial) unique index, so the portal can upsert "the AI note of this kind for this student". Ordinary notes have no ai_key (null), and nulls never clash.
drop index if exists public.portal_notes_ai;
create unique index if not exists portal_notes_ai_key on public.portal_notes(application_id, ai_key);
