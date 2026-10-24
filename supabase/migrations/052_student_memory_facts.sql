-- Lasting facts about a student (previous study, budget, dates, preferences) kept apart from the rolling summary, so they are not forgotten
-- when the conversation grows. The assistant keeps every one that is still true and drops one only when it is contradicted.
alter table public.portal_student_memory add column if not exists facts jsonb not null default '[]'::jsonb;
