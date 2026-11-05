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
create policy admins_select on public.admins for select to authenticated using (public.is_admin_user());
create policy admins_insert on public.admins for insert to authenticated with check (public.has_perm('manage_admins'));
create policy admins_update on public.admins for update to authenticated using (public.is_super()) with check (public.is_super());
create policy admins_delete on public.admins for delete to authenticated using (public.is_super());

-- ecosystem_sites: читают все (core), правят по правам (детали — в триггере)
create policy sites_select on public.ecosystem_sites for select to anon, authenticated using (true);
create policy sites_update on public.ecosystem_sites for update to authenticated
  using (public.is_admin_user()) with check (public.is_admin_user());
create policy sites_insert on public.ecosystem_sites for insert to authenticated with check (public.has_perm('manage_sites'));
create policy sites_delete on public.ecosystem_sites for delete to authenticated using (public.has_perm('manage_sites'));

-- news: публика видит опубликованное; админ с manage_news — всё
create policy news_select_public on public.news for select to anon, authenticated
  using (is_published = true or public.has_perm('manage_news'));
create policy news_insert on public.news for insert to authenticated with check (public.has_perm('manage_news'));
create policy news_update on public.news for update to authenticated using (public.has_perm('manage_news')) with check (public.has_perm('manage_news'));
create policy news_delete on public.news for delete to authenticated using (public.has_perm('manage_news'));

-- site_visits: писать может кто угодно (аналитика), читают админы
create policy visits_insert on public.site_visits for insert to anon, authenticated
  with check (site_id is not null and length(site_id) <= 64);
create policy visits_select on public.site_visits for select to authenticated using (public.is_admin_user());

-- audit_logs: админ пишет только от своего имени; читает с правом view_logs
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (public.is_admin_user() and admin_id = (select id from public.current_admin()));
create policy audit_select on public.audit_logs for select to authenticated using (public.has_perm('view_logs'));

-- bot_logs: только супер-админ читает (запись — Edge Function от имени пользователя)
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
create policy amoore_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.has_perm('manage_media'));
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
