-- =====================================================================================================
-- amoore v5.1 «MASTER» — 001_init_database.sql · ЕДИНЫЙ источник правды (Single Source of Truth)
-- Supabase → SQL Editor → Run. Запускать целиком; скрипт идемпотентен (можно перезапускать).
-- Содержит всё: таблицы (admins, profiles, business_automations, changelog_versions, leads …), функции,
-- триггеры, RLS-политики, Storage (media, avatars), индексы и сид-данные. Заменяет старые 001–009.
-- Разделы 1–9 — прежняя схема v1.0–v5.0 в порядке применения, раздел 10 — новое в v5.1.
-- =====================================================================================================

-- ####################################################################################
-- ## Раздел 1: из 001_amoore_schema.sql
-- ####################################################################################
-- =====================================================================
-- amoore ecosystem — единая SQL-миграция (Clean Build v1.0)
-- Supabase → SQL Editor → вставить целиком → Run.
--
-- БЕЗОПАСНО ДЛЯ ТЕКУЩЕЙ БАЗЫ: данные не удаляются. Таблицы создаются
-- только если их нет, недостающие колонки добавляются, а все RLS-политики
-- пересоздаются с нуля (старые, возможно дырявые, удаляются).
-- Можно запускать повторно сколько угодно раз.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. ТАБЛИЦЫ
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,
  name         text not null default '',
  nickname     text not null default '',
  role         text not null default 'moderator',
  access_token text not null,
  permissions  jsonb,
  created_at   timestamptz not null default now()
);
alter table public.admins add column if not exists permissions jsonb;
alter table public.admins add column if not exists created_at timestamptz not null default now();

create table if not exists public.ecosystem_sites (
  id                text primary key,
  name              text not null,
  url               text not null default '',
  status            text not null default 'open',
  overlay_type      text not null default 'maintenance',
  banner_active     boolean not null default false,
  banner_text       text not null default '',
  demo_chat_active  boolean not null default true,
  news_active       boolean not null default true,
  updated_at        timestamptz not null default now()
);
alter table public.ecosystem_sites add column if not exists overlay_type     text    not null default 'maintenance';
alter table public.ecosystem_sites add column if not exists banner_active    boolean not null default false;
alter table public.ecosystem_sites add column if not exists banner_text      text    not null default '';
alter table public.ecosystem_sites add column if not exists demo_chat_active boolean not null default true;
alter table public.ecosystem_sites add column if not exists news_active      boolean not null default true;
alter table public.ecosystem_sites add column if not exists updated_at       timestamptz not null default now();

create table if not exists public.news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null default '',
  type         text not null default 'news',
  display_date date,
  is_published boolean not null default true,
  published_at timestamptz not null default now()
);
alter table public.news add column if not exists display_date date;
alter table public.news add column if not exists is_published boolean not null default true;
alter table public.news add column if not exists published_at timestamptz not null default now();

create table if not exists public.site_visits (
  id         bigint generated always as identity primary key,
  site_id    text not null,
  created_at timestamptz not null default now()
);
create index if not exists site_visits_created_idx on public.site_visits (created_at desc);

create table if not exists public.audit_logs (
  id           bigint generated always as identity primary key,
  admin_id     uuid references public.admins(id) on delete set null,
  action       text not null,
  site_id      text references public.ecosystem_sites(id) on delete cascade,
  overlay_type text,
  details      text,
  created_at   timestamptz not null default now()
);
alter table public.audit_logs add column if not exists details text;
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);

-- лог рассылок из Edge Function send-telegram (опционально)
create table if not exists public.bot_logs (
  id         bigint generated always as identity primary key,
  message    text,
  status     text,
  error_text text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. ПРАВА: роли + permissions (JSONB), дефолты роли и персональные оверрайды
--    Ключи: toggle_status, toggle_banner, toggle_chat, toggle_news,
--           manage_news, manage_media, manage_sites, view_logs,
--           manage_admins, download_backup
--    permissions = NULL  → дефолт роли. Явный true/false перекрывает дефолт.
-- ---------------------------------------------------------------------
create or replace function public.role_default_perm(p_role text, p_key text)
returns boolean language sql immutable as $$
  select case
    when p_role = 'super_admin' then true
    when p_role = 'admin' then p_key in
      ('toggle_status','toggle_banner','toggle_chat','toggle_news','manage_news','manage_media','view_logs')
    else false
  end;
$$;

-- текущий админ определяется по email из JWT (Supabase Auth)
create or replace function public.current_admin()
returns public.admins language sql stable security definer set search_path = public as $$
  select a.* from public.admins a
  where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.has_perm(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare a public.admins;
begin
  select * into a from public.current_admin();
  if a.id is null then return false; end if;
  if a.role = 'super_admin' then return true; end if;
  if a.permissions is not null and a.permissions ? p_key
     and jsonb_typeof(a.permissions -> p_key) = 'boolean' then
    return (a.permissions ->> p_key)::boolean;
  end if;
  return public.role_default_perm(a.role, p_key);
end $$;

create or replace function public.is_admin_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a
                 where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and a.role = 'super_admin');
$$;

-- ---------------------------------------------------------------------
-- 3. RPC (токен сверяется на сервере, колонка access_token клиенту недоступна)
-- ---------------------------------------------------------------------
-- вход в админку: Supabase Auth (email+пароль) + токен доступа
create or replace function public.verify_admin(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare a public.admins;
begin
  select * into a from public.admins
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     and access_token = p_token
   limit 1;
  if a.id is null then return null; end if;
  return json_build_object('id', a.id, 'email', a.email, 'name', a.name,
                           'nickname', a.nickname, 'role', a.role, 'permissions', a.permissions);
end $$;

-- God Mode на публичных сайтах: валиден ли токен (без раскрытия данных админа)
create or replace function public.verify_god(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins
                 where access_token = p_token and role in ('super_admin','admin'));
$$;

-- кнопка «Открыть сайт» в золотой плашке God Mode
create or replace function public.god_open_site(p_token text, p_site text)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.admins; allowed boolean;
begin
  select * into a from public.admins
   where access_token = p_token and role in ('super_admin','admin') limit 1;
  if a.id is null then return false; end if;
  allowed := a.role = 'super_admin'
          or coalesce((a.permissions ->> 'toggle_status')::boolean,
                      public.role_default_perm(a.role, 'toggle_status'));
  if not allowed then return false; end if;
  perform set_config('amoore.bypass', '1', true);
  update public.ecosystem_sites set status = 'open' where id = p_site;
  insert into public.audit_logs (admin_id, action, site_id) values (a.id, 'open', p_site);
  return true;
end $$;

grant execute on function public.verify_admin(text)        to authenticated;
grant execute on function public.verify_god(text)          to anon, authenticated;
grant execute on function public.god_open_site(text,text)  to anon, authenticated;
grant execute on function public.has_perm(text)            to anon, authenticated;
grant execute on function public.is_admin_user()           to anon, authenticated;
grant execute on function public.is_super()                to anon, authenticated;
grant execute on function public.current_admin()           to authenticated;

-- ---------------------------------------------------------------------
-- 4. ТРИГГЕРЫ БЕЗОПАСНОСТИ
-- ---------------------------------------------------------------------
-- ecosystem_sites: каждый тумблер защищён своим правом на уровне БД
create or replace function public.trg_sites_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('amoore.bypass', true) = '1' then
    new.updated_at := now(); return new;
  end if;
  if new.status is distinct from old.status or new.overlay_type is distinct from old.overlay_type then
    if not public.has_perm('toggle_status') then raise exception 'no permission: toggle_status'; end if;
  end if;
  if new.banner_active is distinct from old.banner_active or new.banner_text is distinct from old.banner_text then
    if not public.has_perm('toggle_banner') then raise exception 'no permission: toggle_banner'; end if;
  end if;
  if new.demo_chat_active is distinct from old.demo_chat_active then
    if not public.has_perm('toggle_chat') then raise exception 'no permission: toggle_chat'; end if;
  end if;
  if new.news_active is distinct from old.news_active then
    if not public.has_perm('toggle_news') then raise exception 'no permission: toggle_news'; end if;
  end if;
  if new.id is distinct from old.id or new.name is distinct from old.name or new.url is distinct from old.url then
    if not public.has_perm('manage_sites') then raise exception 'no permission: manage_sites'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sites_guard on public.ecosystem_sites;
create trigger sites_guard before update on public.ecosystem_sites
  for each row execute function public.trg_sites_guard();

-- admins: нельзя повысить себя/других до super_admin без прав и убрать последнего супера
create or replace function public.trg_admins_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- SQL Editor / service role (нет пользовательского JWT) — проверки не нужны
  if coalesce(auth.jwt() ->> 'email', '') = '' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.role = 'super_admin' and not public.is_super() then
      raise exception 'only super_admin can create super_admin';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if (new.role is distinct from old.role or new.permissions is distinct from old.permissions) and not public.is_super() then
      raise exception 'only super_admin can change roles and permissions';
    end if;
    if old.role = 'super_admin' and new.role <> 'super_admin'
       and not exists (select 1 from public.admins where role = 'super_admin' and id <> old.id) then
      raise exception 'cannot demote the last super_admin';
    end if;
    return new;
  else
    if old.role = 'super_admin'
       and not exists (select 1 from public.admins where role = 'super_admin' and id <> old.id) then
      raise exception 'cannot delete the last super_admin';
    end if;
    return old;
  end if;
end $$;
drop trigger if exists admins_guard on public.admins;
create trigger admins_guard before insert or update or delete on public.admins
  for each row execute function public.trg_admins_guard();

-- ---------------------------------------------------------------------
-- 5. RLS — сначала сносим ВСЕ старые политики этих таблиц
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('admins','ecosystem_sites','news','site_visits','audit_logs','bot_logs')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.admins          enable row level security;
alter table public.ecosystem_sites enable row level security;
alter table public.news            enable row level security;
alter table public.site_visits     enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.bot_logs        enable row level security;

-- admins: видят все админы; создаёт manage_admins; меняет/удаляет только super_admin
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins for select to authenticated using (public.is_admin_user());
drop policy if exists admins_insert on public.admins;
create policy admins_insert on public.admins for insert to authenticated with check (public.has_perm('manage_admins'));
drop policy if exists admins_update on public.admins;
create policy admins_update on public.admins for update to authenticated using (public.is_super()) with check (public.is_super());
drop policy if exists admins_delete on public.admins;
create policy admins_delete on public.admins for delete to authenticated using (public.is_super());

-- ecosystem_sites: читают все (core), правят по правам (детали — в триггере)
drop policy if exists sites_select on public.ecosystem_sites;
create policy sites_select on public.ecosystem_sites for select to anon, authenticated using (true);
drop policy if exists sites_update on public.ecosystem_sites;
create policy sites_update on public.ecosystem_sites for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
drop policy if exists sites_insert on public.ecosystem_sites;
create policy sites_insert on public.ecosystem_sites for insert to authenticated with check (public.has_perm('manage_sites'));
drop policy if exists sites_delete on public.ecosystem_sites;
create policy sites_delete on public.ecosystem_sites for delete to authenticated using (public.has_perm('manage_sites'));

-- news: публика видит опубликованное; админ с manage_news — всё
drop policy if exists news_select_public on public.news;
create policy news_select_public on public.news for select to anon, authenticated
  using (is_published = true or public.has_perm('manage_news'));
drop policy if exists news_insert on public.news;
create policy news_insert on public.news for insert to authenticated with check (public.has_perm('manage_news'));
drop policy if exists news_update on public.news;
create policy news_update on public.news for update to authenticated using (public.has_perm('manage_news')) with check (public.has_perm('manage_news'));
drop policy if exists news_delete on public.news;
create policy news_delete on public.news for delete to authenticated using (public.has_perm('manage_news'));

-- site_visits: писать может кто угодно (аналитика), читают админы
drop policy if exists visits_insert on public.site_visits;
create policy visits_insert on public.site_visits for insert to anon, authenticated
  with check (site_id is not null and length(site_id) <= 64);
drop policy if exists visits_select on public.site_visits;
create policy visits_select on public.site_visits for select to authenticated using (public.is_admin_user());

-- audit_logs: админ пишет только от своего имени; читает с правом view_logs
drop policy if exists audit_insert on public.audit_logs;
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (public.is_admin_user() and admin_id = (select id from public.current_admin()));
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using (public.has_perm('view_logs'));

-- bot_logs: только супер-админ читает (запись — Edge Function от имени пользователя)
drop policy if exists botlogs_select on public.bot_logs;
create policy botlogs_select on public.bot_logs for select to authenticated using (public.is_super());
create policy botlogs_insert on public.bot_logs for insert to authenticated with check (public.is_admin_user());

-- ---------------------------------------------------------------------
-- 6. ЗАЩИТА access_token: клиент не может его прочитать (только RPC выше)
-- ---------------------------------------------------------------------
revoke all on public.admins from anon, authenticated;
grant select (id, email, name, nickname, role, permissions, created_at) on public.admins to authenticated;
grant insert (email, name, nickname, role, access_token, permissions) on public.admins to authenticated;
grant update (name, nickname, role, permissions) on public.admins to authenticated;
grant delete on public.admins to authenticated;

-- ---------------------------------------------------------------------
-- 7. STORAGE: публичный bucket media
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do update set public = true;

do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (policyname ilike '%media%' or policyname ilike 'amoore%')
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy amoore_media_read   on storage.objects for select to anon, authenticated using (bucket_id = 'media');
drop policy if exists amoore_media_insert on storage.objects;
create policy amoore_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.has_perm('manage_media'));
drop policy if exists amoore_media_delete on storage.objects;
create policy amoore_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.has_perm('manage_media'));

-- ---------------------------------------------------------------------
-- 8. REALTIME (мгновенное обновление баннера/статуса/новостей на сайтах)
-- ---------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.news;            exception when others then null; end;
  begin alter publication supabase_realtime add table public.ecosystem_sites; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- 9. СИД (только если пусто) — сайты и новости из старого news.js
-- ---------------------------------------------------------------------
insert into public.ecosystem_sites (id, name, url) values
  ('landing', 'amoore',        'https://amoore-ru.github.io/'),
  ('studio',  'amoore Studio', 'https://amoore-studio.pages.dev/')
on conflict (id) do nothing;

insert into public.news (title, body, type, display_date, is_published)
select * from (values
  ('amoore Studio - обновилось',
   'В amoore Studio вышло обновление дизайна, также устранены некоторые баги, добавлен чат с аморэ ии',
   'news',  date '2026-11-02', true),
  ('Голосовые, память и карма',
   'Пришлите голосовое, и amoore поймёт и ответит. Появятся долгая память о собеседнике, карма за «спасибо», заметки и триггеры в группах.',
   'soon',  null::date, true),
  ('Обновление',
   'Чистка чата «-смс», защита группы, игры, погода и передача создателя. Исправлены команды в подписи к фото и права сооснователя.',
   'patch', date '2026-10-29', true),
  ('У amoore теперь есть сайт',
   'Здесь мы будем рассказывать о новых возможностях и обновлениях бота.',
   'news',  date '2026-10-30', true)
) as v(title, body, type, display_date, is_published)
where not exists (select 1 from public.news);

-- ---------------------------------------------------------------------
-- 10. ПЕРВЫЙ super_admin (только если таблица admins пуста — раскомментируй):
--   1) Supabase → Authentication → Users → Add user (email + пароль)
--   2) подставь тот же email и свой токен (24+ символов):
-- ---------------------------------------------------------------------
-- insert into public.admins (email, name, nickname, role, access_token)
-- values ('founder@amoore.ru', 'Имя', 'Ник', 'super_admin', 'ДЛИННЫЙ_СЛУЧАЙНЫЙ_ТОКЕН');

-- ####################################################################################
-- ## Раздел 2: из 002_v202_bot_leads.sql
-- ####################################################################################
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

-- ####################################################################################
-- ## Раздел 3: из 003_v04_onboarding_broadcast.sql
-- ####################################################################################
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

-- ####################################################################################
-- ## Раздел 4: из 004_v30_singularity.sql
-- ####################################################################################
-- =====================================================================
-- amoore v3.0 «Singularity» — миграция БД (выполнять в Supabase → SQL Editor)
-- Идемпотентна: повторный запуск безопасен. Порядок: 001 → 002 → 003 → 004 (→ cleanup.sql по желанию).
-- Что делает:
--   1) ускоряет запросы лендинга (частичный индекс только по ОПУБЛИКОВАННЫМ новостям);
--   2) индексы для счётчика новых заявок и выборок дайджеста;
--   3) создаёт очередь digest_queue — «Отправить боту» в админке → бот шлёт дайджест админам;
--   4) включает Realtime для leads (красный счётчик в админке обновляется сам).
-- RLS не отключается и не ослабляется.
-- =====================================================================

-- 1) Новости: лендинг всегда спрашивает is_published = true ORDER BY published_at DESC LIMIT 20.
--    Частичный индекс покрывает ровно этот запрос и не растёт за счёт черновиков.
create index if not exists news_pub_idx on public.news (published_at desc) where is_published;

-- 2) Заявки и события: счётчик «новые заявки» и выборки дайджеста за 7 дней
create index if not exists leads_new_idx       on public.leads (created_at desc) where status = 'new';
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists site_visits_site_idx  on public.site_visits (site_id, created_at desc);

-- 3) Очередь запросов на дайджест
create table if not exists public.digest_queue (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'dev' check (source in ('dev', 'auto', 'bot')),
  period        text,                                   -- для автодайджеста: ISO-неделя, например 2026-W45
  status        text not null default 'pending' check (status in ('pending', 'sent', 'error')),
  requested_by  uuid references public.admins(id) on delete set null,
  requested_at  timestamptz not null default now(),
  processed_at  timestamptz,
  error_text    text not null default ''
);
create index if not exists digest_queue_pending_idx on public.digest_queue (requested_at) where status = 'pending';
-- не больше ОДНОЙ ожидающей заявки одновременно: защита от спама кнопкой
create unique index if not exists digest_one_pending on public.digest_queue ((true)) where status = 'pending';

alter table public.digest_queue enable row level security;
drop policy if exists digest_select on public.digest_queue;
drop policy if exists digest_insert on public.digest_queue;
create policy digest_select on public.digest_queue for select to authenticated using (public.is_admin_user());
create policy digest_insert on public.digest_queue for insert to authenticated
  with check (public.has_perm('view_logs') and source = 'dev' and status = 'pending'
              and requested_by = (select id from public.current_admin()));
-- UPDATE/DELETE политик нет намеренно: статус меняет только бот (ключ service role обходит RLS)

-- 4) Realtime для заявок (RLS при этом продолжает действовать: события видят только админы)
do $$
begin
  begin alter publication supabase_realtime add table public.leads; exception when others then null; end;
end $$;

-- Проверка:
-- select indexname from pg_indexes where schemaname = 'public' and indexname in ('news_pub_idx','leads_new_idx','digest_one_pending');

-- ####################################################################################
-- ## Раздел 5: из 005_v4_nexus.sql
-- ####################################################################################
-- =====================================================================
-- amoore v4.0 «NEXUS» — миграция БД 005_v4_nexus  (Supabase → SQL Editor → Run)
-- Идемпотентна: повторный запуск безопасен. Порядок: 001 → 002 → 003 → 004 → 005.
-- Что делает:
--   1) admins.last_seen_at — «Админы в сети» (обновляется при любом действии админа);
--   2) global_settings — role_labels (названия ролей) и changelog (версии для всех сайтов и бота);
--   3) news.type принимает 'digest' (карточки-дайджесты на лендинге);
--   4) роль moderator получает право view_logs (только чтение и логи);
--   5) RPC для Quick Admin на закрытых сайтах (список админов в сети, пульс по токену).
-- RLS нигде не отключается и не ослабляется.
-- =====================================================================

-- 1) Присутствие админов ------------------------------------------------
alter table public.admins add column if not exists last_seen_at timestamptz;

-- пульс по JWT (вызывает админка раз в минуту и при входе)
create or replace function public.touch_admin_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.admins set last_seen_at = now()
   where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
end $$;

-- пульс по токену (Quick Admin на публичных сайтах, где нет сессии Supabase)
create or replace function public.touch_admin_by_token(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.admins set last_seen_at = now()
   where access_token = p_token and role in ('super_admin','admin');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- список «в сети / офлайн» для Quick Admin (без email и токенов; только по валидному токену)
create or replace function public.quick_admins(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admins where access_token = p_token and role in ('super_admin','admin')) then
    return null;
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'nickname', coalesce(nullif(a.nickname, ''), a.name),
             'role', a.role,
             'online', a.last_seen_at is not null and a.last_seen_at > now() - interval '5 minutes')
           order by a.created_at)
      from public.admins a), '[]'::json);
end $$;

-- любое записанное в журнал действие админа = «он был в сети»
create or replace function public.trg_audit_seen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.admin_id is not null then
    update public.admins set last_seen_at = now() where id = new.admin_id;
  end if;
  return new;
end $$;
drop trigger if exists audit_seen on public.audit_logs;
create trigger audit_seen after insert on public.audit_logs
  for each row execute function public.trg_audit_seen();

grant execute on function public.touch_admin_seen()           to authenticated;
grant execute on function public.touch_admin_by_token(text)   to anon, authenticated;
grant execute on function public.quick_admins(text)           to anon, authenticated;

-- 2) Глобальные настройки ----------------------------------------------
create table if not exists public.global_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.global_settings enable row level security;
drop policy if exists gs_select on public.global_settings;
drop policy if exists gs_insert on public.global_settings;
drop policy if exists gs_update on public.global_settings;
drop policy if exists gs_delete on public.global_settings;
-- читают все (сайты, бот): здесь только публичные названия ролей и история версий
create policy gs_select on public.global_settings for select to anon, authenticated
  using (key in ('role_labels', 'changelog'));
-- пишет только super_admin (в БД это «Основатель»)
create policy gs_insert on public.global_settings for insert to authenticated with check (public.is_super());
create policy gs_update on public.global_settings for update to authenticated using (public.is_super()) with check (public.is_super());
create policy gs_delete on public.global_settings for delete to authenticated using (public.is_super());

-- названия ролей: super_admin = Основатель, admin = Админ, moderator = Модератор
insert into public.global_settings (key, value) values
  ('role_labels', '{"super_admin":"Основатель","admin":"Администратор","moderator":"Модератор"}'::jsonb)
on conflict (key) do nothing;

-- история версий (первая запись = текущая версия на всех сайтах)
insert into public.global_settings (key, value) values
  ('changelog', '{"current": "4.0.0", "versions": [{"version": "4.0.0", "date": "2026-11-08", "title": "NEXUS", "items": ["Единая дизайн-система NEXUS: тот же вид, что на лендинге и в студии.", "Тумблеры в мобильном Safari больше не растягиваются: размеры зафиксированы (46×28, кружок 20×20).", "Новая вкладка «Новости»: модератор читает, админ добавляет, основатель правит, удаляет и публикует дайджесты.", "«Админы в сети»: видно, кто сейчас в админке (last_seen_at).", "Редактирование профилей (имя, никнейм, email, роль) и переименование ролей: Основатель / Админ / Модератор.", "Редактор версий и Changelog в Настройках: версия на всех сайтах и в боте обновляется из базы."]}, {"version": "3.1.2", "date": "2026-11-07", "title": "Hotfix UI & DB", "items": ["Статус бота: запрос обновляет только колонку is_online (раньше уходила лишняя колонка, из-за чего вылетала ошибка про базу).", "Нет «страшных» технических сообщений: при проблемах с сервером — «Ошибка связи с сервером. Попробуйте позже».", "Статус бота больше не висит на «Загрузка…»: нет ответа за 3 секунды — показываем «Офлайн»."]}, {"version": "3.0.0", "date": "2026-11-06", "title": "Singularity", "items": ["Дайджест: сводка за 7 дней (новости, переключения тумблеров, заявки, визиты) — копирование, .txt и отправка админам в Telegram через бота.", "Новый дизайн Deep Glass 3.0: матовое стекло с золотой обводкой, плавные переходы между вкладками.", "Красный счётчик новых заявок с лендинга — на вкладке, на дашборде и на кнопке меню.", "Event System: все действия (заявки, бот, дайджест, новости, тумблеры) пишутся в журнал и попадают в дайджест.", "Окно «Что нового» при первом входе в новую версию и история обновлений по клику на версию."]}, {"version": "0.4.0", "date": "2026-11-05", "title": "Onboarding & Broadcast", "items": ["Мастер первой настройки, рассылка подписчикам бота, глобальный поиск."]}, {"version": "0.3.0", "date": "2026-11-04", "title": "Offline & iOS", "items": ["Уведомление о сети, улучшения для Safari на iPhone."]}, {"version": "2.0.2", "date": "2026-11-02", "title": "Evolve", "items": ["Баннер, демо-чат, блок новостей, заявки с лендинга и статус бота."]}]}'::jsonb)
on conflict (key) do nothing;

do $$
begin
  begin alter publication supabase_realtime add table public.global_settings; exception when others then null; end;
end $$;

-- 3) Новости: тип 'digest' ----------------------------------------------
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
            where c.conrelid = 'public.news'::regclass and c.contype = 'c'
              and pg_get_constraintdef(c.oid) ilike '%type%'
  loop
    execute format('alter table public.news drop constraint %I', r.conname);
  end loop;
  alter table public.news add constraint news_type_check check (type in ('news', 'patch', 'soon', 'digest'));
end $$;

-- 4) Права по умолчанию: moderator = только чтение и логи ---------------
create or replace function public.role_default_perm(p_role text, p_key text)
returns boolean language sql immutable as $$
  select case
    when p_role = 'super_admin' then true
    when p_role = 'admin' then p_key in
      ('toggle_status','toggle_banner','toggle_chat','toggle_news','manage_news','manage_media','view_logs')
    when p_role = 'moderator' then p_key in ('view_logs')
    else false
  end;
$$;

-- Проверка:
-- select key, jsonb_pretty(value) from public.global_settings;
-- select nickname, last_seen_at from public.admins;

-- ####################################################################################
-- ## Раздел 6: из 006_v42_rls_and_settings.sql
-- ####################################################################################
-- =====================================================================
-- amoore v4.2 «NEXUS TOTAL FIX» — миграция 006_v42_rls_and_settings  (Supabase → SQL Editor → Run)
-- Идемпотентна. Порядок: 001 → … → 005 → 006.
-- Что делает:
--   1) RLS для admins: админ может сохранить СВОЙ профиль (имя, никнейм), основатель — любые профили и роли;
--      смена роли/прав по-прежнему только у super_admin (триггер из 001 остаётся).
--   2) global_settings: политики читают role_labels и changelog; запись — только super_admin.
--   3) Таблица changelog_versions (по одной строке на версию, с порядком sort_order) — для Drag & Drop.
--   4) Готовый changelog v1.0.0 → v4.2.0 (новые сверху) в global_settings.
-- RLS нигде не отключается.
-- =====================================================================

-- 1) admins: сохранение профилей и ролей ------------------------------------
alter table public.admins enable row level security;
drop policy if exists admins_update_self on public.admins;
create policy admins_update_self on public.admins for update to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
-- admins_update (только super_admin) из 001 остаётся: основатель правит профили и роли всех.
-- Защита: обычный админ через admins_update_self НЕ может менять роль и права —
-- это блокирует триггер из 001 (role / permissions меняет только is_super()).

-- 2) global_settings: чтение публичных ключей, запись только основателем ------
create table if not exists public.global_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.global_settings enable row level security;
drop policy if exists gs_select on public.global_settings;
drop policy if exists gs_insert on public.global_settings;
drop policy if exists gs_update on public.global_settings;
drop policy if exists gs_delete on public.global_settings;
create policy gs_select on public.global_settings for select to anon, authenticated
  using (key in ('role_labels', 'changelog'));
create policy gs_insert on public.global_settings for insert to authenticated with check (public.is_super());
create policy gs_update on public.global_settings for update to authenticated using (public.is_super()) with check (public.is_super());
create policy gs_delete on public.global_settings for delete to authenticated using (public.is_super());

-- 3) Таблица Changelog (порядок задаётся Drag & Drop) -------------------------
create table if not exists public.changelog_versions (
  version    text primary key,
  title      text not null default '',
  released   date,
  items      jsonb not null default '[]'::jsonb,
  sort_order int  not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.changelog_versions enable row level security;
drop policy if exists clv_select on public.changelog_versions;
drop policy if exists clv_write  on public.changelog_versions;
create policy clv_select on public.changelog_versions for select to anon, authenticated using (true);
create policy clv_write  on public.changelog_versions for all to authenticated
  using (public.is_super()) with check (public.is_super());

-- 4) Готовый changelog (перезаписывает прежний, чтобы поставить версии v1.0.0–v4.2.0) ---
insert into public.global_settings (key, value, updated_at) values
  ('changelog', $cl${"current": "4.2.0", "versions": [{"version": "4.2.0", "date": "2026-11-10", "title": "NEXUS Total Fix", "items": ["Админка: возвращён тёмный Deep Glass без белых пятен, тумблеры жёстко 46×28 (кружок 20×20).", "История обновлений: версии от v1.0.0 до v4.2, новые сверху; в редакторе порядок меняется перетаскиванием (Drag & Drop) и сохраняется в БД.", "Демо-чат на лендинге оживает после повторного включения тумблера.", "Новости на лендинге: вкладки фильтруют строго — «Все» без дайджестов, «Дайджесты», «Обновления», «Патчи», «Планы».", "Бот: отвечает только по-русски; английские шаблонные ответы автоматически перегенерируются.", "Адаптивный мат (Tone of Voice 2.0): бот матерится в ответ только тем, кто сам пишет с матом; остальным — без мата, лишнее заменяется звёздочками.", "Миграция 006: права RLS для профилей и ролей админов, настройки changelog."], "order": 0}, {"version": "4.1.1", "date": "2026-11-10", "title": "Hotfix CSS & Changelog", "items": ["Экстренная починка стилей админки: Deep Glass 3.0, золотые кнопки, размеры тумблеров.", "Готовый changelog и перетаскивание версий в редакторе."], "order": 1}, {"version": "4.1.0", "date": "2026-11-09", "title": "Performance", "items": ["Zero-Bloat: быстрее загрузка сайтов экосистемы, меньше лишнего кода и запросов."], "order": 2}, {"version": "4.0.0", "date": "2026-11-08", "title": "NEXUS", "items": ["Единая дизайн-система NEXUS на amoore-dev, amoore-ru и amoore-studio.", "Новая вкладка «Новости», «Админы в сети», редактирование профилей и названий ролей, редактор changelog.", "Бот: живой характер, резервный ИИ через OpenRouter, поиск в интернете, часы и напоминания."], "order": 3}, {"version": "3.1.2", "date": "2026-11-07", "title": "Hotfix UI & DB", "items": ["Статус бота обновляет только нужную колонку, без технических ошибок на экране.", "Режим «Я на профилактике» для бота."], "order": 4}, {"version": "3.0.0", "date": "2026-11-06", "title": "Singularity", "items": ["Умный дайджест за 7 дней, отправка админам в Telegram.", "Deep Glass 3.0, красный счётчик новых заявок, Event System и журнал действий."], "order": 5}, {"version": "2.0.2", "date": "2026-11-02", "title": "Evolve", "items": ["Баннер, демо-чат, блок новостей, заявки с лендинга, статус бота и heartbeat."], "order": 6}, {"version": "1.0.0", "date": "", "title": "Первый запуск", "items": ["Telegram-бот amoore: общение через ИИ, память фактов, роли, распознавание фото."], "order": 7}]}$cl$::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.changelog_versions (version, title, released, items, sort_order)
select v->>'version', coalesce(v->>'title',''), nullif(v->>'date','')::date, v->'items', (v->>'order')::int
  from jsonb_array_elements($cl$[{"version": "4.2.0", "date": "2026-11-10", "title": "NEXUS Total Fix", "items": ["Админка: возвращён тёмный Deep Glass без белых пятен, тумблеры жёстко 46×28 (кружок 20×20).", "История обновлений: версии от v1.0.0 до v4.2, новые сверху; в редакторе порядок меняется перетаскиванием (Drag & Drop) и сохраняется в БД.", "Демо-чат на лендинге оживает после повторного включения тумблера.", "Новости на лендинге: вкладки фильтруют строго — «Все» без дайджестов, «Дайджесты», «Обновления», «Патчи», «Планы».", "Бот: отвечает только по-русски; английские шаблонные ответы автоматически перегенерируются.", "Адаптивный мат (Tone of Voice 2.0): бот матерится в ответ только тем, кто сам пишет с матом; остальным — без мата, лишнее заменяется звёздочками.", "Миграция 006: права RLS для профилей и ролей админов, настройки changelog."], "order": 0}, {"version": "4.1.1", "date": "2026-11-10", "title": "Hotfix CSS & Changelog", "items": ["Экстренная починка стилей админки: Deep Glass 3.0, золотые кнопки, размеры тумблеров.", "Готовый changelog и перетаскивание версий в редакторе."], "order": 1}, {"version": "4.1.0", "date": "2026-11-09", "title": "Performance", "items": ["Zero-Bloat: быстрее загрузка сайтов экосистемы, меньше лишнего кода и запросов."], "order": 2}, {"version": "4.0.0", "date": "2026-11-08", "title": "NEXUS", "items": ["Единая дизайн-система NEXUS на amoore-dev, amoore-ru и amoore-studio.", "Новая вкладка «Новости», «Админы в сети», редактирование профилей и названий ролей, редактор changelog.", "Бот: живой характер, резервный ИИ через OpenRouter, поиск в интернете, часы и напоминания."], "order": 3}, {"version": "3.1.2", "date": "2026-11-07", "title": "Hotfix UI & DB", "items": ["Статус бота обновляет только нужную колонку, без технических ошибок на экране.", "Режим «Я на профилактике» для бота."], "order": 4}, {"version": "3.0.0", "date": "2026-11-06", "title": "Singularity", "items": ["Умный дайджест за 7 дней, отправка админам в Telegram.", "Deep Glass 3.0, красный счётчик новых заявок, Event System и журнал действий."], "order": 5}, {"version": "2.0.2", "date": "2026-11-02", "title": "Evolve", "items": ["Баннер, демо-чат, блок новостей, заявки с лендинга, статус бота и heartbeat."], "order": 6}, {"version": "1.0.0", "date": "", "title": "Первый запуск", "items": ["Telegram-бот amoore: общение через ИИ, память фактов, роли, распознавание фото."], "order": 7}]$cl$::jsonb) as v
on conflict (version) do update
  set title = excluded.title, released = excluded.released, items = excluded.items,
      sort_order = excluded.sort_order, updated_at = now();

do $$
begin
  begin alter publication supabase_realtime add table public.changelog_versions; exception when others then null; end;
end $$;

-- Проверка:
-- select version, sort_order from public.changelog_versions order by sort_order;
-- select jsonb_pretty(value) from public.global_settings where key = 'changelog';

-- ####################################################################################
-- ## Раздел 7: из 007_v43_changelog.sql
-- ####################################################################################
-- amoore v4.3 «POLISH» — миграция 007_v43_changelog (Supabase → SQL Editor → Run). Идемпотентна.
-- Добавляет запись v4.3.0 в changelog (global_settings + таблица changelog_versions), остальные версии сдвигаются вниз.
do $$
declare v jsonb;
begin
  select value into v from public.global_settings where key = 'changelog';
  if v is null or (v->'versions') @> '[{"version": "4.3.0"}]'::jsonb then return; end if;
  update public.global_settings set updated_at = now(), value = jsonb_build_object(
    'current', '4.3.0',
    'versions', jsonb_build_array(jsonb_build_object(
      'version', '4.3.0', 'date', '2026-11-12', 'title', 'POLISH', 'order', 0,
      'items', $i$["Внедрен единый стандарт интерфейса (шапка сайта).", "Заполнен блок «Экосистема» на Лендинге (добавлены ссылки на все продукты).", "Исправлен баг с вкладками новостей.", "Расширены и почищены Настройки в Админке (добавлен Drag & Drop и смена темы).", "Бот стал умнее: адаптивный мат, обход цензуры, реальный поиск.", "Проведена оптимизация кода и запросов к БД."]$i$::jsonb))
      || coalesce((select jsonb_agg(jsonb_set(x, '{order}', to_jsonb(coalesce((x->>'order')::int, 0) + 1)))
                     from jsonb_array_elements(v->'versions') x), '[]'::jsonb))
  where key = 'changelog';
end $$;

update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '4.3.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('4.3.0', 'POLISH', '2026-11-12', $i$["Внедрен единый стандарт интерфейса (шапка сайта).", "Заполнен блок «Экосистема» на Лендинге (добавлены ссылки на все продукты).", "Исправлен баг с вкладками новостей.", "Расширены и почищены Настройки в Админке (добавлен Drag & Drop и смена темы).", "Бот стал умнее: адаптивный мат, обход цензуры, реальный поиск.", "Проведена оптимизация кода и запросов к БД."]$i$::jsonb, 0)
on conflict (version) do nothing;

-- ####################################################################################
-- ## Раздел 8: из 008_v44_rls_final.sql
-- ####################################################################################
-- amoore v4.4 «BUGFIX» — миграция 008_v44_rls_final (Supabase → SQL Editor → Run). Идемпотентна: можно запускать повторно.
--
-- ЧТО ЧИНИТ
--   «Недостаточно прав (RLS)» при сохранении профиля: клиент обновлял колонку email, а право UPDATE на неё не было выдано
--   (001: grant update (name, nickname, role, permissions)). Теперь email в списке разрешённых колонок;
--   КТО может его менять — по-прежнему решают политики (свой email — нельзя, чужие — только super_admin).
--   Права на global_settings и changelog_versions (Changelog, role_labels) выданы явно + чтение всех ключей админам.
--
-- ОТ ЧЕГО ОТЛИЧАЕТСЯ ТЗ (сознательно)
--   * is_admin_user() НЕ переписывается на «id = auth.uid()»: в amoore админ определяется по email из JWT, а admins.id —
--     собственный uuid. Такая замена закрыла бы доступ ВСЕМ админам. Здесь функция понимает оба способа.
--   * Нет политики «FOR ALL для любого админа» на admins: она позволила бы рядовому модератору удалять админов и править их данные.
--     Правка чужих профилей/ролей и удаление остаются за super_admin (политики 001/006 + триггер admins_guard).
--   * Таблицы changelog в проекте нет — Changelog хранится в global_settings (key='changelog') и changelog_versions.

-- 1) Проверка «это админ»: по email из JWT (как в 001) ИЛИ по id = auth.uid() ------------------------
create or replace function public.is_admin_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a
                 where a.id = auth.uid()
                    or lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
grant execute on function public.is_admin_user() to anon, authenticated;

-- 2) admins: сохранение профиля -------------------------------------------------------------------
alter table public.admins enable row level security;
-- колонка email была вне UPDATE-грантов → любой UPDATE, где в SET есть email, падал с «permission denied»
grant update (name, nickname, email, role, permissions) on public.admins to authenticated;
-- свой профиль (имя, никнейм) — любой админ; роль/права меняет только super_admin (триггер admins_guard из 001)
drop policy if exists admins_update_self on public.admins;
create policy admins_update_self on public.admins for update to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 3) global_settings (Changelog, role_labels): чтение — любой админ, запись — super_admin ------------
alter table public.global_settings enable row level security;
grant select on public.global_settings to anon, authenticated;
grant insert, update, delete on public.global_settings to authenticated;
drop policy if exists gs_select_admin on public.global_settings;
create policy gs_select_admin on public.global_settings for select to authenticated using (public.is_admin_user());
-- (gs_select / gs_insert / gs_update / gs_delete из 006 остаются: публично читаются только role_labels и changelog)

-- 4) changelog_versions: чтение — все, запись — super_admin (Drag & Drop) --------------------------
alter table public.changelog_versions enable row level security;
grant select on public.changelog_versions to anon, authenticated;
grant insert, update, delete on public.changelog_versions to authenticated;
drop policy if exists clv_select on public.changelog_versions;
drop policy if exists clv_write  on public.changelog_versions;
create policy clv_select on public.changelog_versions for select to anon, authenticated using (true);
create policy clv_write  on public.changelog_versions for all to authenticated
  using (public.is_super()) with check (public.is_super());

-- 4b) Если нужно, чтобы Changelog и настройки правили ВСЕ админы, а не только super_admin, — раскомментируйте:
-- drop policy if exists gs_admin_write on public.global_settings;
-- create policy gs_admin_write on public.global_settings for all to authenticated
--   using (public.is_admin_user()) with check (public.is_admin_user());
-- drop policy if exists clv_admin_write on public.changelog_versions;
-- create policy clv_admin_write on public.changelog_versions for all to authenticated
--   using (public.is_admin_user()) with check (public.is_admin_user());

-- 5) Changelog v4.4.0 «BUGFIX» (13.11.2026): global_settings + changelog_versions, остальные версии сдвигаются вниз ----
do $$
declare v jsonb;
begin
  select value into v from public.global_settings where key = 'changelog';
  if v is null or (v->'versions') @> '[{"version": "4.4.0"}]'::jsonb then return; end if;
  update public.global_settings set updated_at = now(), value = jsonb_build_object(
    'current', '4.4.0',
    'versions', jsonb_build_array(jsonb_build_object(
      'version', '4.4.0', 'date', '2026-11-13', 'title', 'BUGFIX', 'order', 0,
      'items', $i$["Исправлено перекрытие блоков и 3D-тряска на мобильных.", "Бургер-меню стало непрозрачным: контент сайта больше не просвечивает.", "В меню добавлены кнопка «Попробовать в Telegram», QR-код и ссылка на панель.", "Удалена лишняя плавающая кнопка Telegram.", "Новости: вкладка «Патчи» убрана, патчи показываются в «Обновления».", "Светлая тема: мягкие рамки и тени у карточек.", "Настроены права RLS в базе: профиль, Changelog и настройки сохраняются."]$i$::jsonb))
      || coalesce((select jsonb_agg(jsonb_set(x, '{order}', to_jsonb(coalesce((x->>'order')::int, 0) + 1)))
                     from jsonb_array_elements(v->'versions') x), '[]'::jsonb))
  where key = 'changelog';
end $$;

update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '4.4.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('4.4.0', 'BUGFIX', '2026-11-13', $i$["Исправлено перекрытие блоков и 3D-тряска на мобильных.", "Бургер-меню стало непрозрачным: контент сайта больше не просвечивает.", "В меню добавлены кнопка «Попробовать в Telegram», QR-код и ссылка на панель.", "Удалена лишняя плавающая кнопка Telegram.", "Новости: вкладка «Патчи» убрана, патчи показываются в «Обновления».", "Светлая тема: мягкие рамки и тени у карточек.", "Настроены права RLS в базе: профиль, Changelog и настройки сохраняются."]$i$::jsonb, 0)
on conflict (version) do nothing;

-- Проверка после запуска:
-- select version, sort_order from public.changelog_versions order by sort_order limit 3;
-- select has_column_privilege('authenticated', 'public.admins', 'email', 'UPDATE');   -- ожидается true

-- ####################################################################################
-- ## Раздел 9: из 009_v50_apex.sql
-- ####################################################################################
-- amoore v5.0 «APEX» — миграция 009_v50_apex (Supabase → SQL Editor → Run). Идемпотентна.
-- Зависит от 001–008 (admins, is_super(), is_admin_user(), leads, audit_logs, site_visits, changelog_versions).
--
-- ВАЖНЫЕ РЕШЕНИЯ
--  * audit_logs и changelog НЕ пересоздаются: audit_logs расширяется (ip, user_agent, user_id, meta),
--    «changelog» в проекте = changelog_versions (+ global_settings) — отдельная таблица не нужна.
--  * Старая таблица admins (токен God Mode) остаётся шлюзом в панель; profiles — единый аккаунт Amoore ID.
--    Роли синхронизируются RPC admin_set_role (см. ниже).
--  * Блокировка после 5 неверных паролей здесь — на уровне БД + клиента. Чистая защита от прямых запросов
--    к GoTrue возможна только через Auth Hook (Supabase Pro) — см. REPORT_v5.0.md.

create extension if not exists pgcrypto with schema extensions;

-- 0) утилиты ------------------------------------------------------------------------------------
create or replace function public.req_ip() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  return nullif(trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', ''), ',', 1)), '');
end $$;

create or replace function public.req_ua() returns text language plpgsql stable as $$
declare h json;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then return null; end;
  return left(h->>'user-agent', 300);
end $$;

-- 0.1) Основатель (v5.2): единственный email, который может быть super_admin. Хранится в закрытой таблице
--      (доступ только у service_role/SQL Editor). При первом запуске записывается email самого раннего super_admin.
--      Сменить вручную:  insert into public.founder (id, email) values (true, 'you@example.com')
--                        on conflict (id) do update set email = excluded.email;
create table if not exists public.founder (
  id    boolean primary key default true check (id),
  email text not null check (email = lower(email))
);
alter table public.founder enable row level security;
revoke all on public.founder from anon, authenticated;
grant all on public.founder to service_role;
create or replace function public.founder_email()
returns text language sql stable security definer set search_path = public as $$
  select (select email from public.founder where id) $$;
revoke all on function public.founder_email() from anon, authenticated;

-- 1) profiles -----------------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text,
  avatar_url  text,
  role        text not null default 'user' check (role in ('user','moderator','admin','super_admin')),
  telegram_id bigint unique,
  is_banned   boolean not null default false,
  ban_reason  text,
  banned_at   timestamptz,
  onboarded   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint profiles_username_fmt check (username is null or username ~ '^[a-z0-9_]{3,24}$')
);
alter table public.profiles add column if not exists display_name text;      -- v5.2: никнейм (отображаемое имя), общий для всех сайтов
alter table public.profiles add column if not exists avatar_color text;      -- v5.2: цвет заглушки аватарки
create unique index if not exists profiles_username_uq on public.profiles (lower(username));

-- «Boss»: super_admin по profiles ИЛИ по старой таблице admins
create or replace function public.is_boss()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin' and not p.is_banned);
$$;
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_banned);
$$;
grant execute on function public.is_boss(), public.is_active_user() to authenticated;

-- автосоздание профиля при регистрации
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select case a.role when 'super_admin' then 'super_admin' when 'moderator' then 'moderator' else 'admin' end
    into r from public.admins a where lower(a.email) = lower(new.email);
  if public.founder_email() is not null and lower(new.email) = public.founder_email() then r := 'super_admin'; end if;
  insert into public.profiles (id, role) values (new.id, coalesce(r, 'user')) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_v50 on auth.users;
create trigger on_auth_user_created_v50 after insert on auth.users
  for each row execute function public.handle_new_user();

-- бэкфилл существующих пользователей
insert into public.profiles (id, role)
select u.id, coalesce(case a.role when 'super_admin' then 'super_admin' when 'moderator' then 'moderator' end,
                      case when a.id is not null then 'admin' end, 'user')
from auth.users u left join public.admins a on lower(a.email) = lower(u.email)
on conflict (id) do nothing;

-- защита чувствительных полей + флаг онбординга
create or replace function public.trg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.onboarded := coalesce(new.username, '') <> '' and (coalesce(new.avatar_url, '') <> '' or coalesce(new.avatar_color, '') <> '');
  if tg_op = 'UPDATE'
     and current_setting('amoore.bypass', true) is distinct from '1'
     and auth.uid() is not null
     and (new.id is distinct from old.id or new.role is distinct from old.role
          or new.is_banned is distinct from old.is_banned or new.ban_reason is distinct from old.ban_reason
          or new.banned_at is distinct from old.banned_at or new.telegram_id is distinct from old.telegram_id
          or new.created_at is distinct from old.created_at) then
    raise exception 'forbidden: protected profile fields';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.trg_profiles_guard();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, avatar_url) on public.profiles to authenticated;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_boss());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() and public.is_active_user())
  with check (id = auth.uid() and public.is_active_user());

-- 2) audit_logs: расширение + RPC log_event -------------------------------------------------------
alter table public.audit_logs add column if not exists user_id    uuid;
alter table public.audit_logs add column if not exists ip         text;
alter table public.audit_logs add column if not exists user_agent text;
alter table public.audit_logs add column if not exists meta       jsonb not null default '{}'::jsonb;
create index if not exists audit_logs_user_idx on public.audit_logs (user_id, created_at desc);

create or replace function public.log_event(p_action text, p_details text default null, p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into public.audit_logs (admin_id, action, details, user_id, ip, user_agent, meta)
  values ((select a.id from public.admins a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))),
          left(p_action, 64), left(p_details, 1000), auth.uid(), public.req_ip(), public.req_ua(), coalesce(p_meta, '{}'::jsonb));
end $$;
grant execute on function public.log_event(text, text, jsonb) to authenticated;

drop policy if exists audit_select_own  on public.audit_logs;
drop policy if exists audit_select_boss on public.audit_logs;
create policy audit_select_own  on public.audit_logs for select to authenticated using (user_id = auth.uid());
create policy audit_select_boss on public.audit_logs for select to authenticated using (public.is_boss());

-- 3) Защита от перебора пароля (5 ошибок → 15 минут) ----------------------------------------------
create table if not exists public.login_attempts (
  id         bigint generated always as identity primary key,
  email      text not null,
  ip         text,
  ok         boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_email_idx on public.login_attempts (lower(email), created_at desc);
alter table public.login_attempts enable row level security;   -- политик нет: доступ только через RPC ниже
revoke all on public.login_attempts from anon, authenticated;

-- сколько секунд осталось до разблокировки (0 = не заблокирован). Ничего не раскрывает о существовании e-mail.
create or replace function public.auth_lock_status(p_email text)
returns int language plpgsql stable security definer set search_path = public as $$
declare since timestamptz; n int; last_fail timestamptz; left_s int;
begin
  select coalesce(max(created_at), 'epoch') into since from public.login_attempts where lower(email) = lower(p_email) and ok;
  select count(*), max(created_at) into n, last_fail from public.login_attempts
   where lower(email) = lower(p_email) and not ok and created_at > greatest(since, now() - interval '15 minutes');
  if n < 5 then return 0; end if;
  left_s := ceil(extract(epoch from (last_fail + interval '15 minutes' - now())))::int;
  return greatest(left_s, 0);
end $$;

create or replace function public.auth_note_failure(p_email text)
returns int language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_email, '')) not between 3 and 254 then return 0; end if;
  insert into public.login_attempts (email, ip, ok) values (lower(p_email), public.req_ip(), false);
  insert into public.audit_logs (action, details, ip, user_agent, meta)
    values ('login_failed', left(lower(p_email), 120), public.req_ip(), public.req_ua(), '{}'::jsonb);
  return public.auth_lock_status(p_email);
end $$;

-- успех фиксируется ТОЛЬКО для вошедшего пользователя (anon не может сбросить счётчик)
create or replace function public.auth_note_success()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into public.login_attempts (email, ip, ok) values (lower(coalesce(auth.jwt() ->> 'email', '')), public.req_ip(), true);
  perform public.log_event('login', null);
end $$;
grant execute on function public.auth_lock_status(text), public.auth_note_failure(text) to anon, authenticated;
grant execute on function public.auth_note_success() to authenticated;

-- 4) Сессии / устройства --------------------------------------------------------------------------
create table if not exists public.user_sessions (
  id           uuid primary key,                 -- = auth.sessions.id (claim session_id в JWT)
  user_id      uuid not null references auth.users(id) on delete cascade,
  user_agent   text,
  ip           text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists user_sessions_user_idx on public.user_sessions (user_id, last_seen_at desc);
alter table public.user_sessions enable row level security;
revoke all on public.user_sessions from anon, authenticated;
grant select on public.user_sessions to authenticated;
drop policy if exists us_select_own on public.user_sessions;
create policy us_select_own on public.user_sessions for select to authenticated using (user_id = auth.uid());

create or replace function public.register_session()
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or sid is null then return; end if;
  insert into public.user_sessions (id, user_id, user_agent, ip) values (sid, auth.uid(), public.req_ua(), public.req_ip())
  on conflict (id) do update set last_seen_at = now(), ip = excluded.ip;
end $$;

create or replace function public.revoke_other_sessions()
returns int language plpgsql security definer set search_path = public, auth as $$
declare sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid; n int;
begin
  if auth.uid() is null or sid is null then raise exception 'auth required'; end if;
  delete from auth.sessions where user_id = auth.uid() and id <> sid;   -- каскадно удаляет refresh-токены
  get diagnostics n = row_count;
  delete from public.user_sessions where user_id = auth.uid() and id <> sid;
  perform public.log_event('sessions_revoked', n::text || ' sessions');
  return n;
end $$;
grant execute on function public.register_session(), public.revoke_other_sessions() to authenticated;

-- 5) SSO (одноразовые токены, 60 секунд; обмен на сессию — Edge Function sso-exchange) -------------
create table if not exists public.sso_tokens (
  token_hash  text primary key,                  -- sha256(token); сам токен в БД не хранится
  user_id     uuid not null references auth.users(id) on delete cascade,
  target_site text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '60 seconds',
  used_at     timestamptz
);
alter table public.sso_tokens enable row level security;   -- политик нет: читает только service_role (Edge Function)
revoke all on public.sso_tokens from anon, authenticated;
grant all on public.sso_tokens to service_role;

create or replace function public.sso_issue(p_target text)
returns text language plpgsql security definer set search_path = public as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if not public.is_active_user() then raise exception 'forbidden'; end if;
  if p_target not in ('admin','studio','landing') then raise exception 'unknown target'; end if;
  insert into public.sso_tokens (token_hash, user_id, target_site)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), auth.uid(), p_target);
  perform public.log_event('sso_issue', p_target);
  return tok;
end $$;
grant execute on function public.sso_issue(text) to authenticated;

-- 6) CRM: заметки и статусы заявок -----------------------------------------------------------------
alter table public.leads add column if not exists assigned_to uuid;
alter table public.leads add column if not exists updated_at  timestamptz not null default now();
-- допустимые статусы: new | in_progress | rejected | done (done оставлен для совместимости с v2.0.2)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.leads'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.leads drop constraint %I', c.conname);
  end loop;
  alter table public.leads add constraint leads_status_chk check (status in ('new','in_progress','rejected','done'));
end $$;

create table if not exists public.leads_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads(id) on delete cascade,
  author_id  uuid not null default auth.uid() references auth.users(id) on delete set null,
  note       text not null check (length(note) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists leads_notes_lead_idx on public.leads_notes (lead_id, created_at desc);
alter table public.leads_notes enable row level security;
grant select, insert, delete on public.leads_notes to authenticated;
drop policy if exists ln_select on public.leads_notes;
drop policy if exists ln_insert on public.leads_notes;
drop policy if exists ln_delete on public.leads_notes;
create policy ln_select on public.leads_notes for select to authenticated using (public.is_admin_user() or public.is_boss());
create policy ln_insert on public.leads_notes for insert to authenticated
  with check ((public.is_admin_user() or public.is_boss()) and author_id = auth.uid());
create policy ln_delete on public.leads_notes for delete to authenticated using (author_id = auth.uid() or public.is_boss());

-- метка «бот уже уведомил»; существующие заявки помечаем как уведомлённые (не спамим историей)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='notified_at') then
    alter table public.leads add column notified_at timestamptz;
    update public.leads set notified_at = now();
  end if;
end $$;

-- 7) notifications ---------------------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'info',
  title      text not null,
  body       text not null default '',
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
drop policy if exists n_select on public.notifications;
drop policy if exists n_update on public.notifications;
create policy n_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy n_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant all on public.notifications to service_role;

-- новая заявка → уведомление всем админам (Telegram-отправка — в боте/Edge Function по Realtime/Webhook)
create or replace function public.trg_lead_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, 'lead', 'Новая заявка', left(coalesce(nullif(new.name, ''), 'Без имени') || ' · ' || coalesce(new.contact, ''), 200), '#leads'
  from public.profiles p where p.role in ('admin', 'super_admin') and not p.is_banned;
  return new;
end $$;
drop trigger if exists leads_notify on public.leads;
create trigger leads_notify after insert on public.leads for each row execute function public.trg_lead_notify();

-- 8) Привязка Telegram: код из бота (/link) → профиль ----------------------------------------------
create table if not exists public.tg_link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  telegram_id bigint not null,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz
);
alter table public.tg_link_codes enable row level security;   -- политик нет: пишет бот (service_role)
revoke all on public.tg_link_codes from anon, authenticated;
grant all on public.tg_link_codes to service_role;
-- v5.2: бот (service_role) обязан иметь доступ к схеме и таблице profiles (поиск админов, привязка Telegram)
grant usage on schema public to service_role;
grant select, update on public.profiles to service_role;
grant select, update on public.leads to service_role;

create or replace function public.link_telegram(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare c public.tg_link_codes;
begin
  if not public.is_active_user() then raise exception 'forbidden'; end if;
  select * into c from public.tg_link_codes where code = p_code and used_at is null and expires_at > now() for update;
  if not found then raise exception 'invalid or expired code'; end if;
  if exists (select 1 from public.profiles where telegram_id = c.telegram_id and id <> auth.uid()) then
    raise exception 'telegram already linked to another account';
  end if;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set telegram_id = c.telegram_id where id = auth.uid();
  update public.tg_link_codes set used_at = now() where code = c.code;
  perform public.log_event('telegram_linked', c.telegram_id::text);
  return c.telegram_id;
end $$;
grant execute on function public.link_telegram(text) to authenticated;

-- 9) God Mode: только Boss ---------------------------------------------------------------------------
create or replace function public.admin_list_people()
returns table (id uuid, email text, username text, avatar_url text, role text, telegram_id bigint,
               is_banned boolean, ban_reason text, created_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_boss() then raise exception 'forbidden'; end if;
  return query select p.id, u.email::text, p.username, p.avatar_url, p.role, p.telegram_id,
                      p.is_banned, p.ban_reason, p.created_at, u.last_sign_in_at
               from public.profiles p join auth.users u on u.id = p.id order by p.created_at desc;
end $$;

create or replace function public.admin_ban_user(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_boss() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'reason required'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'super_admin') then raise exception 'cannot ban super_admin'; end if;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set is_banned = true, ban_reason = left(p_reason, 500), banned_at = now() where id = p_user;
  delete from auth.sessions where user_id = p_user;                  -- мгновенный разлогин везде
  perform public.log_event('ban', p_user::text, jsonb_build_object('reason', left(p_reason, 500)));
end $$;

create or replace function public.admin_unban_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_boss() then raise exception 'forbidden'; end if;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set is_banned = false, ban_reason = null, banned_at = null where id = p_user;
  perform public.log_event('unban', p_user::text);
end $$;

-- роль: user | moderator | admin. super_admin назначается только вручную в SQL.
-- Возвращает access_token (God Mode) при ПЕРВОМ повышении — показывается один раз.
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare em text; tok text; cur text;
begin
  if not public.is_boss() then raise exception 'forbidden'; end if;
  if p_role not in ('user', 'moderator', 'admin') then raise exception 'invalid role'; end if;
  if p_user = auth.uid() then raise exception 'cannot change own role'; end if;
  select role into cur from public.profiles where id = p_user;
  if cur is null then raise exception 'no such user'; end if;
  if cur = 'super_admin' then raise exception 'cannot change super_admin'; end if;
  select email into em from auth.users where id = p_user;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set role = p_role where id = p_user;
  if p_role = 'user' then
    delete from public.admins where lower(email) = lower(em);
  elsif exists (select 1 from public.admins where lower(email) = lower(em)) then
    update public.admins set role = case p_role when 'moderator' then 'moderator' else 'admin' end where lower(email) = lower(em);
  else
    tok := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.admins (email, name, nickname, role, access_token)
    values (em, '', '', case p_role when 'moderator' then 'moderator' else 'admin' end, tok);
  end if;
  perform public.log_event('set_role', p_user::text, jsonb_build_object('from', cur, 'to', p_role));
  return jsonb_build_object('role', p_role, 'access_token', tok);
end $$;
grant execute on function public.admin_list_people(), public.admin_ban_user(uuid, text),
  public.admin_unban_user(uuid), public.admin_set_role(uuid, text) to authenticated;

-- 10) Аналитика: гео + онлайн ------------------------------------------------------------------------
alter table public.site_visits add column if not exists visitor_id   text;
alter table public.site_visits add column if not exists path         text;
alter table public.site_visits add column if not exists country_code text;
alter table public.site_visits add column if not exists country      text;
alter table public.site_visits add column if not exists city         text;
create index if not exists site_visits_geo_idx on public.site_visits (country_code, created_at desc);

create table if not exists public.site_presence (
  site_id      text not null,
  visitor_id   text not null,
  path         text,
  country_code text,
  city         text,
  last_seen    timestamptz not null default now(),
  primary key (site_id, visitor_id)
);
alter table public.site_presence enable row level security;
revoke all on public.site_presence from anon, authenticated;
grant select on public.site_presence to authenticated;
drop policy if exists sp_select on public.site_presence;
create policy sp_select on public.site_presence for select to authenticated using (public.is_admin_user() or public.is_boss());

create or replace function public.presence_ping(p_site text, p_visitor text, p_path text default null,
                                                 p_cc text default null, p_city text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_visitor, '')) not between 8 and 64 or length(coalesce(p_site, '')) not between 1 and 64 then return; end if;
  insert into public.site_presence (site_id, visitor_id, path, country_code, city)
  values (p_site, p_visitor, left(p_path, 200), left(p_cc, 2), left(p_city, 80))
  on conflict (site_id, visitor_id) do update
    set path = excluded.path, country_code = coalesce(excluded.country_code, public.site_presence.country_code),
        city = coalesce(excluded.city, public.site_presence.city), last_seen = now();
end $$;
grant execute on function public.presence_ping(text, text, text, text, text) to anon, authenticated;

create or replace function public.online_now(p_site text default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.site_presence
   where last_seen > now() - interval '60 seconds' and (p_site is null or site_id = p_site)
     and (public.is_admin_user() or public.is_boss());
$$;
grant execute on function public.online_now(text) to authenticated;

-- 11) Storage: аватарки (bucket avatars, папка = uid) --------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp','image/png','image/jpeg'])
on conflict (id) do update set file_size_limit = 2097152, allowed_mime_types = array['image/webp','image/png','image/jpeg'];
drop policy if exists avatars_read   on storage.objects;
drop policy if exists avatars_write  on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;
create policy avatars_read   on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_write  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 12) Уборка мусора (вызывать раз в сутки: pg_cron или бэкап-скрипт) -----------------------------------
create or replace function public.prune_v50() returns void language sql security definer set search_path = public as $$
  delete from public.login_attempts where created_at < now() - interval '30 days';
  delete from public.sso_tokens     where expires_at < now() - interval '1 day';
  delete from public.site_presence  where last_seen  < now() - interval '1 day';
  delete from public.tg_link_codes  where expires_at < now() - interval '1 day';
$$;
revoke all on function public.prune_v50() from public, anon, authenticated;
grant execute on function public.prune_v50() to service_role;

-- 13) Changelog 5.0.0 «APEX» ----------------------------------------------------------------------------
update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '5.0.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('5.0.0', 'APEX', '2026-11-13',
  $i$["Amoore ID: единый профиль, онбординг, Magic Link.", "Безопасность: блокировка после 5 неверных паролей, аудит с IP, список устройств.", "God Mode: бан, роли, управление людьми.", "SSO между админкой, студией и лендингом.", "CRM заявок, заметки, онлайн и география посетителей.", "Привязка Telegram через /link."]$i$::jsonb, 0)
on conflict (version) do nothing;

-- Проверка после запуска:
-- select count(*) from public.profiles;                         -- = числу пользователей auth.users
-- select public.auth_lock_status('test@example.com');            -- 0
-- select has_table_privilege('authenticated','public.sso_tokens','SELECT');  -- false
-- =====================================================================================================
-- 10. v5.1 «MASTER»
-- =====================================================================================================

-- 10.1 profiles: Rewards, рефералы, публичный профиль -------------------------------------------------
alter table public.profiles add column if not exists rewards_balance int  not null default 0;
alter table public.profiles add column if not exists referred_by     uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists bio             text not null default '';
alter table public.profiles add column if not exists is_public       boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_bio_len') then
    alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_rewards_nonneg') then
    alter table public.profiles add constraint profiles_rewards_nonneg check (rewards_balance >= 0);
  end if;
end $$;
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);
create index if not exists profiles_created_at_idx  on public.profiles (created_at desc);

-- защита: баллы и referred_by клиент менять не может (только через RPC / service_role)
create or replace function public.trg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.onboarded := coalesce(new.username, '') <> '' and coalesce(new.avatar_url, '') <> '';
  if tg_op = 'UPDATE'
     and current_setting('amoore.bypass', true) is distinct from '1'
     and auth.uid() is not null
     and (new.id is distinct from old.id or new.role is distinct from old.role
          or new.is_banned is distinct from old.is_banned or new.ban_reason is distinct from old.ban_reason
          or new.banned_at is distinct from old.banned_at or new.telegram_id is distinct from old.telegram_id
          or new.created_at is distinct from old.created_at
          or new.rewards_balance is distinct from old.rewards_balance
          or new.referred_by is distinct from old.referred_by) then
    raise exception 'forbidden: protected profile fields';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.trg_profiles_guard();

-- клиент может менять только username, avatar_url, bio, is_public
grant update (username, avatar_url, bio, is_public, display_name, avatar_color) on public.profiles to authenticated;

-- 10.2 Rewards: журнал и начисление за приглашение ----------------------------------------------------
create table if not exists public.rewards_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      int  not null,
  reason     text not null default 'referral',
  ref_user   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rewards_log_user_idx on public.rewards_log (user_id, created_at desc);
create unique index if not exists rewards_log_referral_uq on public.rewards_log (ref_user) where reason = 'referral';
alter table public.rewards_log enable row level security;
revoke all on public.rewards_log from anon, authenticated;
grant select on public.rewards_log to authenticated;
grant all on public.rewards_log to service_role;
drop policy if exists rl_select on public.rewards_log;
create policy rl_select on public.rewards_log for select to authenticated using (user_id = auth.uid());

-- Вызывается новым пользователем один раз после регистрации по ссылке ?ref=USERNAME.
-- Условия: профиль создан не более 7 дней назад, referred_by ещё пуст, пригласивший существует, не сам себя.
create or replace function public.claim_referral(p_ref text)
returns int language plpgsql security definer set search_path = public as $$
declare me public.profiles; inviter uuid;
begin
  if not public.is_active_user() then raise exception 'forbidden'; end if;
  select * into me from public.profiles where id = auth.uid() for update;
  if me.referred_by is not null then return 0; end if;
  if me.created_at < now() - interval '7 days' then return 0; end if;
  select id into inviter from public.profiles
   where lower(username) = lower(trim(coalesce(p_ref, ''))) and not is_banned and id <> me.id;
  if inviter is null then return 0; end if;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set referred_by = inviter where id = me.id;
  update public.profiles set rewards_balance = rewards_balance + 10 where id = inviter;
  insert into public.rewards_log (user_id, delta, reason, ref_user) values (inviter, 10, 'referral', me.id)
    on conflict do nothing;
  insert into public.notifications (user_id, kind, title, body, link)
    values (inviter, 'reward', 'Amoore Rewards', '+10 баллов: по вашей ссылке зарегистрировался новый пользователь', '#profile');
  return 10;
end $$;
grant execute on function public.claim_referral(text) to authenticated;

-- 10.3 AI Бизнес-ассистент (Telegram Business) --------------------------------------------------------
create table if not exists public.business_automations (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  is_enabled          boolean not null default false,
  company_name        text not null default '' check (char_length(company_name) <= 120),
  working_hours       text not null default '' check (char_length(working_hours) <= 200),
  custom_instructions text not null default '' check (char_length(custom_instructions) <= 2000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists business_automations_enabled_idx on public.business_automations (is_enabled) where is_enabled;
create index if not exists business_automations_created_idx on public.business_automations (created_at desc);
alter table public.business_automations enable row level security;
revoke all on public.business_automations from anon, authenticated;
grant select, insert, update on public.business_automations to authenticated;
grant all on public.business_automations to service_role;
drop policy if exists ba_select on public.business_automations;
drop policy if exists ba_insert on public.business_automations;
drop policy if exists ba_update on public.business_automations;
create policy ba_select on public.business_automations for select to authenticated using (user_id = auth.uid());
create policy ba_insert on public.business_automations for insert to authenticated with check (user_id = auth.uid() and public.is_active_user());
create policy ba_update on public.business_automations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function public.trg_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists ba_touch on public.business_automations;
create trigger ba_touch before update on public.business_automations for each row execute function public.trg_touch_updated_at();

-- 10.4 CRM: теги заявок ---------------------------------------------------------------------------------
alter table public.leads add column if not exists tags text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_tags_chk') then
    alter table public.leads add constraint leads_tags_chk check (tags <@ array['vip','spam','pending']::text[]);
  end if;
end $$;
create index if not exists leads_tags_idx on public.leads using gin (tags);

-- 10.5 Публичные сайты пользователей и публичный профиль -------------------------------------------------
create table if not exists public.user_sites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 80),
  url        text not null check (url ~* '^https://[^\s]{3,300}$'),
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists user_sites_user_idx on public.user_sites (user_id, created_at desc);
create index if not exists user_sites_public_idx on public.user_sites (user_id) where is_public;
alter table public.user_sites enable row level security;
revoke all on public.user_sites from anon, authenticated;
grant select, insert, update, delete on public.user_sites to authenticated;
grant all on public.user_sites to service_role;
drop policy if exists us2_select on public.user_sites;
drop policy if exists us2_insert on public.user_sites;
drop policy if exists us2_update on public.user_sites;
drop policy if exists us2_delete on public.user_sites;
create policy us2_select on public.user_sites for select to authenticated using (user_id = auth.uid());
create policy us2_insert on public.user_sites for insert to authenticated with check (user_id = auth.uid() and public.is_active_user());
create policy us2_update on public.user_sites for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy us2_delete on public.user_sites for delete to authenticated using (user_id = auth.uid());

-- Публичная страница amoore.ru/#u/username: аватарка (фото или цвет), никнейм, био, статус (роль) и публичные сайты. Без email.
create or replace function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username, 'display_name', p.display_name, 'avatar_url', nullif(p.avatar_url, ''), 'avatar_color', p.avatar_color,
    'bio', p.bio, 'role', p.role, 'created_at', p.created_at,
    'sites', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url) order by s.created_at desc)
                         from public.user_sites s where s.user_id = p.id and s.is_public), '[]'::jsonb))
  from public.profiles p
  where lower(p.username) = lower(coalesce(p_username, '')) and p.is_public and not p.is_banned and p.onboarded
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- 10.6 Web Push (PWA) ------------------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.news add column if not exists push_sent_at timestamptz;   -- когда по новости ушёл push (защита от повторов)
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at desc);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
drop policy if exists ps_select on public.push_subscriptions;
drop policy if exists ps_insert on public.push_subscriptions;
drop policy if exists ps_delete on public.push_subscriptions;
create policy ps_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy ps_insert on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy ps_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- 10.7 Индексы на ключевые поля (user_id / created_at / is_published) -------------------------------------
create index if not exists news_is_published_idx on public.news (is_published, published_at desc);
create index if not exists news_created_idx      on public.news (published_at desc);
do $$
declare r record;
begin
  for r in select * from (values
      ('bot_logs','created_at'), ('bot_subscribers','is_active'), ('leads','created_at'), ('leads','status'),
      ('notifications','user_id'), ('user_sessions','user_id'), ('audit_logs','user_id'), ('audit_logs','created_at'),
      ('site_visits','created_at'), ('login_attempts','created_at'), ('leads_notes','created_at'),
      ('changelog_versions','sort_order'), ('tg_link_codes','telegram_id')
  ) as t(tbl, col) loop
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name=r.col) then
      execute format('create index if not exists %I on public.%I (%I)', 'idx_' || r.tbl || '_' || r.col, r.tbl, r.col);
    end if;
  end loop;
end $$;

-- 10.8 Realtime: живые графики и заявки ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','site_visits','audit_logs','site_presence','news','bot_logs','changelog_versions'] loop
    if to_regclass('public.' || t) is not null then
      begin execute format('alter publication supabase_realtime add table public.%I', t);
      exception when others then null; end;
    end if;
  end loop;
end $$;

-- 10.9 Журнал событий: фильтр по типу в админке использует audit_logs.action (индекс есть, см. раздел 4) ----------
-- Типы: login, logout, password_change, profile_update, telegram_linked, ban, unban, role_change ...

-- 10.10 Changelog v5.1 MASTER (26.11.2026) -----------------------------------------------------------------------
do $$
declare v jsonb;
begin
  select value into v from public.global_settings where key = 'changelog';
  if v is null or (v->'versions') @> '[{"version": "5.1.0"}]'::jsonb then return; end if;
  update public.global_settings set updated_at = now(), value = jsonb_build_object(
    'current', '5.1.0',
    'versions', jsonb_build_array(jsonb_build_object(
      'version', '5.1.0', 'date', '2026-11-26', 'title', 'v5.1 MASTER', 'order', 0,
      'items', $i$["Великая чистка БД: единый файл 001_init_database.sql", "Web App Лендинг: вкладки без перезагрузки и хэш-навигация", "AI Бизнес-ассистент для Телеграм Business", "Баллы amoore: реферальные ссылки и баллы", "CRM с тегами, экспорт заявок в CSV", "Push-уведомления (PWA) о новостях", "Публичные профили amoore.ru/u/username"]$i$::jsonb)
    ) || coalesce((select jsonb_agg(jsonb_set(x, '{order}', to_jsonb(coalesce((x->>'order')::int, 0) + 1)))
                     from jsonb_array_elements(v->'versions') x), '[]'::jsonb))
  where key = 'changelog';
end $$;
update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '5.1.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('5.1.0', 'v5.1 MASTER', '2026-11-26',
  $i$["Великая чистка БД: единый файл 001_init_database.sql", "Web App Лендинг: вкладки без перезагрузки и хэш-навигация", "AI Бизнес-ассистент для Телеграм Business", "Баллы amoore: реферальные ссылки и баллы", "CRM с тегами, экспорт заявок в CSV", "Push-уведомления (PWA) о новостях", "Публичные профили amoore.ru/u/username"]$i$::jsonb, 0)
on conflict (version) do nothing;


-- =====================================================================================================
-- РАЗДЕЛ 11 — v5.2 «POLISH & SYNC»
-- =====================================================================================================

-- 11.1 Основатель: единственный email с правом на super_admin -----------------------------------------------
-- При первом запуске в таблицу founder записывается email самого раннего super_admin (из admins или profiles).
-- Если super_admin ещё нет — founder пуст, защита включится сразу после первого вашего вызова:
--   insert into public.founder (id, email) values (true, 'you@example.com') on conflict (id) do update set email = excluded.email;
insert into public.founder (id, email)
select true, lower(e) from (
  select u.email as e from public.profiles p join auth.users u on u.id = p.id
   where p.role = 'super_admin' order by p.created_at asc limit 1
) x where e is not null
on conflict (id) do nothing;
insert into public.founder (id, email)
select true, lower(a.email) from public.admins a where a.role = 'super_admin' order by a.created_at asc limit 1
on conflict (id) do nothing;

-- Только email основателя может стать super_admin (и только он не может быть понижен). Работает для всех, включая консоль.
create or replace function public.trg_founder_guard()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare fe text := public.founder_email(); em text;
begin
  if fe is null then return new; end if;
  if tg_table_name = 'admins' then em := lower(new.email); else select lower(email) into em from auth.users where id = new.id; end if;
  if new.role = 'super_admin' and em is distinct from fe then
    raise exception 'forbidden: only the founder email may be super_admin';
  end if;
  if tg_op = 'UPDATE' and old.role = 'super_admin' and new.role <> 'super_admin' and em = fe then
    raise exception 'forbidden: the founder cannot be demoted';
  end if;
  return new;
end $$;
drop trigger if exists admins_founder_guard on public.admins;
create trigger admins_founder_guard before insert or update of role on public.admins
  for each row execute function public.trg_founder_guard();
drop trigger if exists profiles_founder_guard on public.profiles;
create trigger profiles_founder_guard before insert or update of role on public.profiles
  for each row execute function public.trg_founder_guard();

-- Основатель на всех сайтах: если email основателя уже зарегистрирован — роль super_admin в profiles и admins.
create or replace function public.sync_founder()
returns void language plpgsql security definer set search_path = public, auth as $$
declare fe text := public.founder_email(); uid uuid;
begin
  if fe is null then return; end if;
  select id into uid from auth.users where lower(email) = fe;
  if uid is null then return; end if;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set role = 'super_admin' where id = uid and role <> 'super_admin';
  update public.admins   set role = 'super_admin' where lower(email) = fe and role <> 'super_admin';
end $$;
revoke all on function public.sync_founder() from anon, authenticated;
select public.sync_founder();

-- 11.2 Единый профиль: никнейм (display_name) синхронизируется между profiles (сайты) и admins (админка) ----
create or replace function public.trg_sync_nick_from_profile()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.display_name is distinct from old.display_name and coalesce(new.display_name, '') <> '' then
    update public.admins a set nickname = new.display_name
     where lower(a.email) = (select lower(email) from auth.users where id = new.id) and a.nickname is distinct from new.display_name;
  end if;
  return new;
end $$;
drop trigger if exists profiles_sync_nick on public.profiles;
create trigger profiles_sync_nick after update of display_name on public.profiles
  for each row execute function public.trg_sync_nick_from_profile();

create or replace function public.trg_sync_nick_from_admin()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.nickname is distinct from old.nickname and coalesce(new.nickname, '') <> '' then
    update public.profiles p set display_name = left(new.nickname, 40)
     where p.id = (select id from auth.users where lower(email) = lower(new.email)) and p.display_name is distinct from left(new.nickname, 40);
  end if;
  return new;
end $$;
drop trigger if exists admins_sync_nick on public.admins;
create trigger admins_sync_nick after update of nickname on public.admins
  for each row execute function public.trg_sync_nick_from_admin();

-- бэкфилл: ник админки → профиль (если в профиле ещё пусто)
update public.profiles p set display_name = left(a.nickname, 40)
  from auth.users u join public.admins a on lower(a.email) = lower(u.email)
 where u.id = p.id and coalesce(p.display_name, '') = '' and coalesce(a.nickname, '') <> '';

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len check (display_name is null or char_length(display_name) between 1 and 40);
alter table public.profiles drop constraint if exists profiles_avatar_color_fmt;
alter table public.profiles add constraint profiles_avatar_color_fmt check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$');


-- 11.3 Гео-карта: координаты визита --------------------------------------------------------------------------
alter table public.site_visits add column if not exists lat double precision;
alter table public.site_visits add column if not exists lon double precision;

-- 11.4 Колокольчик на лендинге: новость → уведомление всем активным пользователям ------------------------------
create or replace function public.trg_news_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_published, false) and (tg_op = 'INSERT' or not coalesce(old.is_published, false)) then
    insert into public.notifications (user_id, kind, title, body, link)
    select p.id, 'news', left(coalesce(new.title, 'Новость'), 120), left(coalesce(new.body, ''), 200), '#news'
      from public.profiles p where not p.is_banned limit 5000;
  end if;
  return new;
end $$;
drop trigger if exists news_notify on public.news;
create trigger news_notify after insert or update of is_published on public.news
  for each row execute function public.trg_news_notify();
grant update (read_at) on public.notifications to authenticated;

-- 11.5 Студия → профиль: опубликованный проект попадает в «Мои сайты» (уникально по пользователю и адресу) ----------
create unique index if not exists user_sites_user_url_uq on public.user_sites (user_id, url);

-- 11.6 Changelog v5.2 «POLISH & SYNC» ------------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  select value into v from public.global_settings where key = 'changelog';
  if v is null or (v->'versions') @> '[{"version": "5.2.0"}]'::jsonb then return; end if;
  update public.global_settings set updated_at = now(), value = jsonb_build_object(
    'current', '5.2.0',
    'versions', jsonb_build_array(jsonb_build_object(
      'version', '5.2.0', 'date', '2026-11-27', 'title', 'v5.2 POLISH & SYNC', 'order', 0,
      'items', $i$["Единый профиль amoore ID: ник, аватарка (фото или цвет) и роль одинаковы в админке, студии и на сайте", "Полная русификация интерфейса; amoore пишется строчными", "Админка: вход в стиле Liquid Glass, настройки только «Внешний вид» и «Профиль», Changelog переехал в «Новости → Обновления»", "Удалена Телеграм-рассылка из админки", "Починена привязка Телеграма: код /link создаётся, причина сбоя видна основателю", "Единый UI-кит: вкладки-чипсы, тумблеры и кнопки; поля ввода больше не вылезают за экран на телефоне", "Скелетоны вместо «Загрузка…»; карта посетителей по городам на дашборде", "Защита основателя на уровне базы данных", "Студия: профиль в настройках, проекты в профиле amoore ID, сжатие картинок в WebP", "Колокольчик уведомлений на лендинге"]$i$::jsonb)
    ) || coalesce((select jsonb_agg(jsonb_set(x, '{order}', to_jsonb(coalesce((x->>'order')::int, 0) + 1)))
                     from jsonb_array_elements(v->'versions') x), '[]'::jsonb))
  where key = 'changelog';
end $$;
update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '5.2.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('5.2.0', 'v5.2 POLISH & SYNC', '2026-11-27',
  $i$["Единый профиль amoore ID: ник, аватарка (фото или цвет) и роль одинаковы в админке, студии и на сайте", "Полная русификация интерфейса; amoore пишется строчными", "Админка: вход в стиле Liquid Glass, настройки только «Внешний вид» и «Профиль», Changelog переехал в «Новости → Обновления»", "Удалена Телеграм-рассылка из админки", "Починена привязка Телеграма: код /link создаётся, причина сбоя видна основателю", "Единый UI-кит: вкладки-чипсы, тумблеры и кнопки; поля ввода больше не вылезают за экран на телефоне", "Скелетоны вместо «Загрузка…»; карта посетителей по городам на дашборде", "Защита основателя на уровне базы данных", "Студия: профиль в настройках, проекты в профиле amoore ID, сжатие картинок в WebP", "Колокольчик уведомлений на лендинге"]$i$::jsonb, 0)
on conflict (version) do nothing;

-- Прежние подписи ролей «Админ» → «Администратор»
update public.global_settings set value = jsonb_set(value, '{admin}', '"Администратор"') where key = 'role_labels' and value->>'admin' = 'Админ';

-- Проверка:
-- select version from public.changelog_versions order by sort_order limit 2;     -- 5.2.0, 5.1.0
-- select public.public_profile('username');
