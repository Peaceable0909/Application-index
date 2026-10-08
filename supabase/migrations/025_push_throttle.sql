-- Calm push notifications: one alert per conversation until the person reads it (or 30 minutes pass).
create table if not exists portal_push_throttle (
  email text not null, tag text not null,
  last_sent_at timestamptz not null default now(),
  suppressed int not null default 0,
  primary key (email, tag)
);
alter table portal_push_throttle enable row level security;
