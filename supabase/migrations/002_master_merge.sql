-- Merge the curated master sheet (Sheet1) with the raw form log (Applications).
alter table portal_applications
  add column if not exists student_ref text,          -- "Student ID" / OPP id from master sheet when present
  add column if not exists master_row int,            -- row in Sheet1 (informational; rows can shift)
  add column if not exists in_master boolean not null default false,
  add column if not exists has_raw boolean not null default true,
  add column if not exists progress int,              -- % from the pipeline legend
  add column if not exists master_data jsonb,         -- snapshot of the Sheet1 row
  add column if not exists raw_data jsonb;            -- snapshot of the Applications row
