-- Each person's chosen look (light / soft / dark / auto + accent colour), so it follows them across devices.
create table if not exists portal_theme_prefs (
  email text primary key,
  mode text not null default 'light' check (mode in ('light','soft','dark','system')),
  accent text not null default 'blue' check (accent in ('blue','emerald','violet','rose','amber')),
  updated_at timestamptz not null default now()
);
alter table portal_theme_prefs enable row level security;
