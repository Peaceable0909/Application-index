-- Small key/value store for portal-wide switches that admins can change from the screen
-- (first use: key 'two_step', value {"who": "off" | "admins" | "everyone"}).
create table if not exists portal_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table portal_settings enable row level security;

-- Fast lookup for "who opened which document" in the admin log.
create index if not exists portal_audit_action_created on portal_audit (action, created_at desc);
