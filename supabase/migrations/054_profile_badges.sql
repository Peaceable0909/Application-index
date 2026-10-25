-- Counselor profiles and admin-defined badges.
--  * a cover photo (or one of the built-in covers) behind the profile picture
--  * what a person does in their own words (responsibilities, additional duties, other places they help). Which countries, schools and
--    locations they handle is NOT stored here: it is read from the assignment rules (portal_assign_rules / portal_head_scopes, migration 053).
--  * badges: an admin defines each one (name, meaning, one of five colours, who may hold it) and gives it to people. A badge is a label
--    and nothing else: holding one never opens an application or an admin page.

alter table portal_staff
  add column if not exists cover_url text,
  add column if not exists cover_pos smallint not null default 50 check (cover_pos between 0 and 100),   -- which part of a tall photo stays in view (0 top, 100 bottom)
  add column if not exists cover_preset text,                                                              -- a built-in cover (src/lib/covers.ts) used while there is no photo
  add column if not exists responsibilities text,
  add column if not exists duties text,
  add column if not exists also_supports text;                                                             -- free text, shown as "also helps with"; routing never reads it

-- Cover photos: public like the profile pictures, 2 MB, images only. Files get random names and are written only by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create table if not exists portal_badges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  description text check (description is null or char_length(description) <= 240),     -- the meaning, in the admin's words; shown as the tooltip
  color text not null check (color in ('blue','red','yellow','green','purple')),
  enabled boolean not null default false,                                              -- off = hidden everywhere, assignments are kept
  eligible_roles text[] not null default array['admin','staff','counselor'],           -- which roles may hold it
  show_students boolean not null default false,                                        -- students see it next to their counselor's name
  sort int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz
);
create unique index if not exists portal_badges_name on portal_badges (lower(name));
alter table portal_badges enable row level security;

create table if not exists portal_staff_badges (
  badge_id uuid not null references portal_badges(id) on delete cascade,
  email text not null references portal_staff(email) on delete cascade on update cascade,
  assigned_by text,
  assigned_at timestamptz not null default now(),
  note text,
  primary key (badge_id, email)
);
create index if not exists portal_staff_badges_email on portal_staff_badges (email);
alter table portal_staff_badges enable row level security;

-- Five starting points, one per colour, switched off and without a meaning: the admin decides what each one stands for.
insert into portal_badges (name, color, enabled, sort)
select v.name, v.color, false, v.sort
from (values ('Blue badge','blue',1), ('Red badge','red',2), ('Yellow badge','yellow',3), ('Green badge','green',4), ('Purple badge','purple',5)) as v(name, color, sort)
where not exists (select 1 from portal_badges);
