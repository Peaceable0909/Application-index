-- Phone/browser push notifications (Web Push). The server keeps its own signing keys here so no setup is needed; only the service role can read them.
create table if not exists portal_push_config (
  id int primary key default 1 check (id = 1),
  public_key text not null, private_key text not null,
  created_at timestamptz not null default now()
);
create table if not exists portal_push_subs (
  id uuid primary key default gen_random_uuid(),
  email text not null, role text not null check (role in ('student','staff')),
  endpoint text not null unique, p256dh text not null, auth text not null,
  user_agent text, created_at timestamptz not null default now(), last_ok_at timestamptz
);
create index if not exists portal_push_subs_email on portal_push_subs(email);
alter table portal_push_config enable row level security;
alter table portal_push_subs enable row level security;
