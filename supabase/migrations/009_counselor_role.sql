-- Counselors can sign in and see only their own students.
alter table portal_staff add column if not exists counselor_key text;   -- links the login to a counselor (portal_counselors.name_key)
alter table portal_staff drop constraint if exists portal_staff_role_check;
alter table portal_staff add constraint portal_staff_role_check check (role in ('admin','staff','counselor'));
