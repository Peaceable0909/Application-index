-- Words spoken in a student's voice note, written down by the speech-to-text step (opt-in, AI_VOICE=on).
alter table portal_student_msgs
  add column if not exists transcript text,
  add column if not exists transcript_at timestamptz;
