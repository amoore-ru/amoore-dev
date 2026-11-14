-- ============================================================================================
-- 004_v55_stability.sql — amoore v5.5 «STABILITY». ТОЧЕЧНАЯ миграция.
--   • НЕ делает DROP TABLE / TRUNCATE / DELETE ни по одной таблице с данными;
--   • НЕ трогает существующие RLS-политики других таблиц;
--   • полностью идемпотентна: можно запускать повторно сколько угодно раз;
--   • 001_init_database.sql запускать заново НЕ нужно (и нельзя).
-- Порядок: 001 → 002 → 003 → 004 (004 безопасна и без 003: всё нужное из 003 по этим таблицам продублировано здесь).
-- Запуск: Supabase → SQL Editor → New query → вставить файл целиком → Run.
-- ============================================================================================

-- 1) tg_link_codes — коды привязки Telegram (/link) ------------------------------------------
-- Структура совпадает с 002 (used_by, created_at, срок 15 минут) — db_bridge.py и RPC claim_telegram_code/link_telegram работают без изменений.
create table if not exists public.tg_link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  telegram_id bigint      not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '15 minutes'),
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null
);
-- если таблица уже была (старая/частичная) — доводим до нужной формы, ничего не удаляя
alter table public.tg_link_codes add column if not exists created_at timestamptz not null default now();
alter table public.tg_link_codes add column if not exists expires_at timestamptz not null default (now() + interval '15 minutes');
alter table public.tg_link_codes add column if not exists used_at    timestamptz;
alter table public.tg_link_codes add column if not exists used_by    uuid references auth.users(id) on delete set null;
alter table public.tg_link_codes alter column expires_at set default (now() + interval '15 minutes');

create index if not exists tg_link_codes_tid_idx on public.tg_link_codes (telegram_id) where used_at is null;
create index if not exists tg_link_codes_exp_idx on public.tg_link_codes (expires_at);

-- доступ: клиенты (anon / authenticated) таблицу НЕ видят; пишет бот под service_role, коды гасит RPC (security definer)
alter table public.tg_link_codes enable row level security;
revoke all on public.tg_link_codes from anon, authenticated;
grant usage on schema public to service_role;
grant all on public.tg_link_codes to service_role;
drop policy if exists tg_link_codes_service on public.tg_link_codes;
create policy tg_link_codes_service on public.tg_link_codes for all to service_role using (true) with check (true);

-- 2) bot_status — пульс бота -------------------------------------------------------------------
-- Колонки на случай старой версии таблицы + гарантированная строка 'main' (бот делает upsert on_conflict=id).
alter table public.bot_status add column if not exists is_online      boolean not null default true;
alter table public.bot_status add column if not exists last_heartbeat timestamptz;
insert into public.bot_status (id) values ('main') on conflict (id) do nothing;
grant select, insert, update on public.bot_status to service_role;
grant select on public.bot_status to anon, authenticated;

-- Честный статус для сайта и админки: «жив» считается НА СЕРВЕРЕ (нет зависимости от часов клиента).
--   is_online — тумблер «бот включён» (админка);  alive — пульс свежее p_max_age_sec (по умолчанию 15 минут: бот пингует раз в 5).
create or replace function public.bot_health(p_max_age_sec int default 900)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_online',      coalesce(s.is_online, true),
    'last_heartbeat', s.last_heartbeat,
    'age_seconds',    case when s.last_heartbeat is null then null else floor(extract(epoch from (now() - s.last_heartbeat)))::int end,
    'alive',          s.last_heartbeat is not null and s.last_heartbeat > now() - make_interval(secs => greatest(p_max_age_sec, 60))
  )
  from (select 1) d left join public.bot_status s on s.id = 'main';
$$;
grant execute on function public.bot_health(int) to anon, authenticated, service_role;

-- 3) bot_logs — поля для интерактивной таблицы логов (Время / Уровень / Пользователь / Событие / Сообщение) --
alter table public.bot_logs add column if not exists level       text;
alter table public.bot_logs add column if not exists event       text;
alter table public.bot_logs add column if not exists tg_user_id  bigint;
alter table public.bot_logs add column if not exists tg_username text;
-- старые строки получают уровень по status (только заполнение пустых значений, данные не теряются)
update public.bot_logs set level = case
    when lower(coalesce(status,'')) in ('error','fail','failed','exception','critical') then 'ERROR'
    when lower(coalesce(status,'')) in ('warn','warning','partial','maintenance')       then 'WARN'
    else 'INFO' end
  where level is null;
create index if not exists bot_logs_created_idx on public.bot_logs (created_at desc);
create index if not exists bot_logs_level_idx   on public.bot_logs (level, created_at desc);
grant insert, select on public.bot_logs to service_role;

-- 4) site_visits — колонки, которые читают аналитика и Edge Function geo (если вдруг их нет) ----------------
alter table public.site_visits add column if not exists visitor_id   text;
alter table public.site_visits add column if not exists path         text;
alter table public.site_visits add column if not exists country_code text;
alter table public.site_visits add column if not exists country      text;
alter table public.site_visits add column if not exists city         text;
alter table public.site_visits add column if not exists lat          double precision;
alter table public.site_visits add column if not exists lon          double precision;
create index if not exists site_visits_created_idx on public.site_visits (created_at desc);

-- 5) Перезагрузка кэша схемы PostgREST (чтобы новые колонки/функции были видны API сразу) ------------------
notify pgrst, 'reload schema';

-- Проверка (должна вернуть 3 строки с true):
--   select to_regclass('public.tg_link_codes') is not null as tg_link_codes,
--          exists (select 1 from public.bot_status where id = 'main') as bot_status_main,
--          to_regprocedure('public.bot_health(integer)') is not null as bot_health;
