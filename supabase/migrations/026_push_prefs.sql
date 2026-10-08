-- Per-person notification setting: 'first' (calm, default), 'every' (every message) or 'off' (no phone alerts at all).
create table if not exists portal_push_prefs (
  email text primary key,
  mode text not null default 'first' check (mode in ('first','every','off')),
  updated_at timestamptz not null default now()
);
alter table portal_push_prefs enable row level security;
