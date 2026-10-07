-- Chat v2: rooms (1:1 and group), members, messages with replies / reactions / attachments / edits / deletes.
create table if not exists portal_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm','group')),
  name text,
  color text default 'navy',
  dm_key text unique,
  created_by text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_preview text,
  last_sender text
);
create table if not exists portal_room_members (
  room_id uuid not null references portal_rooms(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner','member')),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  typing_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (room_id, email)
);
create index if not exists portal_room_members_email on portal_room_members(email);
create table if not exists portal_chat_msgs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references portal_rooms(id) on delete cascade,
  sender text not null,
  body text not null default '',
  reply_to uuid references portal_chat_msgs(id) on delete set null,
  application_id text references portal_applications(application_id) on delete set null,
  att_path text, att_name text, att_size bigint, att_mime text,
  reactions jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_chat_msgs_room_created on portal_chat_msgs(room_id, created_at desc);
create index if not exists portal_chat_msgs_room_updated on portal_chat_msgs(room_id, updated_at desc);
alter table portal_rooms enable row level security;
alter table portal_room_members enable row level security;
alter table portal_chat_msgs enable row level security;
alter table portal_staff add column if not exists last_active_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 4194304) on conflict (id) do update set public = false, file_size_limit = 4194304;

-- carry over the 1:1 messages from chat v1
insert into portal_rooms (kind, dm_key, created_by)
select 'dm', k, split_part(k, '|', 1) from (select distinct least(from_email, to_email) || '|' || greatest(from_email, to_email) as k from portal_chat) t
on conflict (dm_key) do nothing;
insert into portal_room_members (room_id, email)
select r.id, e from portal_rooms r, unnest(string_to_array(r.dm_key, '|')) e where r.kind = 'dm' on conflict do nothing;
insert into portal_chat_msgs (id, room_id, sender, body, application_id, created_at, updated_at)
select c.id, r.id, c.from_email, c.body, c.application_id, c.created_at, c.created_at
from portal_chat c join portal_rooms r on r.dm_key = least(c.from_email, c.to_email) || '|' || greatest(c.from_email, c.to_email)
on conflict (id) do nothing;
update portal_room_members m set last_read_at = coalesce((
  select min(c.created_at) - interval '1 millisecond' from portal_chat c
  join portal_rooms r2 on r2.dm_key = least(c.from_email, c.to_email) || '|' || greatest(c.from_email, c.to_email)
  where r2.id = m.room_id and c.to_email = m.email and c.read_at is null), now());
update portal_rooms r set last_message_at = x.at, last_preview = left(x.body, 80), last_sender = x.sender
from (select distinct on (room_id) room_id, created_at as at, body, sender from portal_chat_msgs order by room_id, created_at desc) x where x.room_id = r.id;
