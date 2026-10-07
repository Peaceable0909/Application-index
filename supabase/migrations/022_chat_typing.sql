-- "typing…" indicator for the student chat: one row per student, timestamps refreshed while someone types.
create table if not exists portal_thread_typing (
  student_email text primary key,
  student_typing_at timestamptz,
  staff_typing_at timestamptz
);
alter table portal_thread_typing enable row level security;
