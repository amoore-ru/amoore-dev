-- Amoore v0.4: Telegram subscriber registry for admin broadcasts.
create table if not exists public.bot_subscribers (
  telegram_id bigint primary key,
  chat_id bigint not null,
  username text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists bot_subscribers_active_idx on public.bot_subscribers(is_active);
alter table public.bot_subscribers enable row level security;
-- No anon/authenticated policies: only the bot's service-role key and Edge Function may access this table.

grant all on table public.bot_subscribers to service_role;
