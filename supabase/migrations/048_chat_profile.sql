-- The new-student chat remembers a structured profile, records when a counsellor was really notified, and logs
-- questions it could not answer so the team can teach it.
alter table portal_leads
  add column if not exists profile jsonb not null default '{}'::jsonb,
  add column if not exists handover_at timestamptz,
  add column if not exists handover_delivered boolean,
  add column if not exists handover_reason text,
  add column if not exists fail_streak int not null default 0;

create table if not exists portal_chat_gaps (
  id uuid primary key default gen_random_uuid(),
  workspace text not null references portal_workspaces(key),
  question text not null,
  lead_id uuid references portal_leads(id) on delete set null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table portal_chat_gaps enable row level security;
create index if not exists portal_chat_gaps_ws on portal_chat_gaps (workspace, resolved, created_at desc);

-- Chats that only ever said hello were flagged "needs a person" by the old fallback text. Nobody was ever notified about them.
update portal_leads set needs_human = false where handover_at is null and converted_app is null and email is null and phone is null;
