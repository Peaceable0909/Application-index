-- In-app voice and video calls between a student and their counselor (WebRTC; the browsers talk to each other,
-- these two tables only carry the "hello, here is how to reach me" messages and a record of each call).
create table if not exists portal_calls (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  application_id text not null,
  kind text not null default 'voice' check (kind in ('voice','video')),
  caller text not null check (caller in ('student','staff')),
  caller_email text not null,
  staff_email text,                      -- the staff member on the call (caller, or whoever picked up)
  status text not null default 'ringing' check (status in ('ringing','active','ended','declined','missed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  beat_at timestamptz not null default now(),
  end_reason text
);
create index if not exists portal_calls_student on portal_calls(student_email, created_at desc);

create table if not exists portal_call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references portal_calls(id) on delete cascade,
  from_role text not null check (from_role in ('student','staff')),
  kind text not null check (kind in ('offer','answer','ice')),
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists portal_call_signals_call on portal_call_signals(call_id, id);

alter table portal_calls enable row level security;
alter table portal_call_signals enable row level security;
