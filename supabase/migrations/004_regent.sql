-- Third source: the "Regent Only" tab (OPP ID, payment, interview booking).
alter table portal_applications
  add column if not exists opp_id text,
  add column if not exists payment text,
  add column if not exists interview text,
  add column if not exists regent_row int,
  add column if not exists in_regent boolean not null default false,
  add column if not exists regent_data jsonb;
