-- v2.0.2: bot_status, leads, sort_order, bot_logs.admin_id
-- Idempotent

create table if not exists public.bot_status (
  id              text primary key default 'main',
  is_online       boolean not null default true,
  last_heartbeat  timestamptz,
  updated_at      timestamptz not null default now(),
  note            text default ''
);
insert into public.bot_status (id, is_online) values ('main', true)
  on conflict (id) do nothing;

alter table public.bot_logs add column if not exists admin_id uuid;
alter table public.bot_logs add column if not exists source text default 'bot';

create table if not exists public.leads (
  id           uuid primary key default gen_random_uuid(),
  name         text not null default '',
  contact      text not null default '',
  message      text not null default '',
  status       text not null default 'new', -- new | done
  created_at   timestamptz not null default now()
);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);

alter table public.ecosystem_sites add column if not exists sort_order int not null default 0;

alter table public.bot_status enable row level security;
alter table public.leads enable row level security;

drop policy if exists bot_status_select on public.bot_status;
create policy bot_status_select on public.bot_status for select to anon, authenticated using (true);
drop policy if exists bot_status_update on public.bot_status;
create policy bot_status_update on public.bot_status for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
drop policy if exists bot_status_insert on public.bot_status;
create policy bot_status_insert on public.bot_status for insert to authenticated
  with check (public.is_admin_user());

-- leads: anon can insert (форма с лендинга), admins read/update
drop policy if exists leads_insert_public on public.leads;
create policy leads_insert_public on public.leads for insert to anon, authenticated
  with check (length(name) <= 120 and length(contact) <= 200 and length(message) <= 2000);
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (public.is_admin_user());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated using (public.is_super());

-- bot_logs: allow service role / authenticated insert with broader check for bot (service key preferred)
drop policy if exists botlogs_insert on public.bot_logs;
create policy botlogs_insert on public.bot_logs for insert to authenticated
  with check (true);
-- anon insert for heartbeat from bot using service... bot should use service role key server-side
drop policy if exists botlogs_insert_anon on public.bot_logs;
-- no anon insert on logs; bot uses SUPABASE_SERVICE_KEY

-- sort: allow admins to update sort_order via existing sites_update policy
