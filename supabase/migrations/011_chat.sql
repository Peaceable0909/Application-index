-- Private 1:1 messages between portal users (team + counselors). Students never appear here.
create table if not exists portal_chat (
  id uuid primary key default gen_random_uuid(),
  from_email text not null,
  to_email text not null,
  body text not null check (char_length(body) between 1 and 2000),
  application_id text references portal_applications(application_id) on delete set null,   -- optional "about this student" tag
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists portal_chat_pair on portal_chat(from_email, to_email, created_at desc);
create index if not exists portal_chat_inbox on portal_chat(to_email, read_at, created_at desc);
alter table portal_chat enable row level security;
