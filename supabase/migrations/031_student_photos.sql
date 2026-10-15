-- A student's own profile picture (shown in their portal and to their counselors). One row per email; the picture is in the public "avatars" bucket.
create table if not exists portal_student_profiles (
  email text primary key,
  avatar_url text,
  updated_at timestamptz not null default now()
);
alter table portal_student_profiles enable row level security;
