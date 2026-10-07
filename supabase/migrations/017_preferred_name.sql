-- What the student likes to be called (set by the student in the student portal). Never overwritten by sync.
alter table portal_applications add column if not exists preferred_name text;
