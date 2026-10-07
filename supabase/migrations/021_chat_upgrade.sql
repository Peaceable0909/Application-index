-- Student chat upgrade: attachments, voice notes, replies, reactions, delete-for-everyone.
alter table portal_student_msgs drop constraint if exists portal_student_msgs_body_check;
alter table portal_student_msgs
  add column if not exists att_path text,
  add column if not exists att_name text,
  add column if not exists att_mime text,
  add column if not exists att_size integer,
  add column if not exists duration_ms integer,
  add column if not exists reply_to uuid references portal_student_msgs(id) on delete set null,
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists deleted_at timestamptz;
alter table portal_student_msgs add constraint portal_student_msgs_body_check check (char_length(body) <= 2000 and (char_length(body) >= 1 or att_path is not null or deleted_at is not null));
