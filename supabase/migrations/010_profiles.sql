-- Staff profiles: display name, photo, role title, contact, bio, accent colour. Photos live in a public "avatars" bucket.
alter table portal_staff add column if not exists display_name text;
alter table portal_staff add column if not exists avatar_url text;
alter table portal_staff add column if not exists title text;
alter table portal_staff add column if not exists phone text;
alter table portal_staff add column if not exists bio text;
alter table portal_staff add column if not exists color text default 'navy';
alter table portal_staff add column if not exists updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
