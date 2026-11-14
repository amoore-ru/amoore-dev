-- =====================================================================================================
-- amoore v5.3.0 «SMART AUTH & PRE-RUST» — миграция 002
-- ЖЕЛЕЗНОЕ ПРАВИЛО: 001_init_database.sql заморожен (1786 строк) и не меняется. Всё новое — только здесь.
-- Применять ПОСЛЕ 001. Скрипт идемпотентен: можно запускать повторно, данные не удаляются.
--
--   1) Онбординг: флаг profiles.onboarded считается по username (раньше требовался ещё и avatar_url —
--      из-за этого окно «Добро пожаловать» вылезало при каждой перезагрузке у тех, кто выбрал цвет вместо фото).
--   2) tg_link_codes: надёжная таблица кодов привязки Telegram (код живёт 15 минут).
--   3) claim_telegram_code(input_code): привязывает telegram_id к auth.uid() с защитой от перебора.
--   4) Changelog 5.3.0.
-- =====================================================================================================

-- 1) Онбординг ----------------------------------------------------------------------------------------
-- Копия актуальной версии триггера из 001 (раздел 10.x: защита роли, бана, telegram_id, баллов, referred_by);
-- меняется ТОЛЬКО правило onboarded: достаточно непустого username.
create or replace function public.trg_profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.onboarded := btrim(coalesce(new.username, '')) <> '';
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

-- бэкфилл: у кого username уже есть — онбординг пройден (триггер выше сам выставит onboarded = true)
select set_config('amoore.bypass', '1', true);
update public.profiles set username = username
 where btrim(coalesce(username, '')) <> '' and onboarded is distinct from true;

-- 2) tg_link_codes ------------------------------------------------------------------------------------
-- Таблица уже создана в 001 (код, telegram_id, срок, used_at). Здесь — доводим до «надёжной»: срок 15 минут,
-- отметка времени и пользователя, индексы. Пишет и читает только бот (service_role) и функция ниже.
create table if not exists public.tg_link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  telegram_id bigint not null,
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);
alter table public.tg_link_codes add column if not exists created_at timestamptz not null default now();
alter table public.tg_link_codes add column if not exists used_by    uuid references auth.users(id) on delete set null;
alter table public.tg_link_codes alter column expires_at set default (now() + interval '15 minutes');
create index if not exists tg_link_codes_tid_idx on public.tg_link_codes (telegram_id) where used_at is null;
create index if not exists tg_link_codes_exp_idx on public.tg_link_codes (expires_at);
alter table public.tg_link_codes enable row level security;     -- политик нет: клиенты таблицу не видят
revoke all on public.tg_link_codes from anon, authenticated;
grant all on public.tg_link_codes to service_role;

-- журнал неудачных попыток ввода кода (для защиты от перебора 6 цифр)
create table if not exists public.tg_claim_attempts (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists tg_claim_attempts_user_idx on public.tg_claim_attempts (user_id, created_at desc);
alter table public.tg_claim_attempts enable row level security;
revoke all on public.tg_claim_attempts from anon, authenticated;
grant all on public.tg_claim_attempts to service_role;
grant usage, select on sequence public.tg_claim_attempts_id_seq to service_role;

-- 3) claim_telegram_code ------------------------------------------------------------------------------
-- Возвращает telegram_id при успехе; NULL — код неверный, использован или просрочен (попытка записывается);
-- исключение — нет входа, аккаунт заблокирован, слишком много попыток или Telegram уже привязан к другому аккаунту.
create or replace function public.claim_telegram_code(input_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  uid   uuid := auth.uid();
  clean text := btrim(coalesce(input_code, ''));
  c     public.tg_link_codes;
  fails int;
begin
  if uid is null or not public.is_active_user() then raise exception 'forbidden'; end if;
  delete from public.tg_claim_attempts where created_at < now() - interval '1 day';
  select count(*) into fails from public.tg_claim_attempts where user_id = uid and created_at > now() - interval '15 minutes';
  if fails >= 5 then raise exception 'too many attempts, retry in 15 minutes'; end if;

  if clean !~ '^[0-9]{6}$' then
    insert into public.tg_claim_attempts (user_id) values (uid);
    return null;
  end if;

  select * into c from public.tg_link_codes
   where code = clean and used_at is null and expires_at > now()
   for update;                                              -- срок действия (15 минут) проверяется здесь
  if not found then
    insert into public.tg_claim_attempts (user_id) values (uid);
    return null;
  end if;

  if exists (select 1 from public.profiles where telegram_id = c.telegram_id and id <> uid) then
    raise exception 'telegram already linked to another account';
  end if;

  perform set_config('amoore.bypass', '1', true);           -- telegram_id защищён триггером; меняем только здесь
  update public.profiles set telegram_id = c.telegram_id where id = uid;
  update public.tg_link_codes set used_at = now(), used_by = uid where code = c.code;
  update public.tg_link_codes set used_at = now(), used_by = uid
   where telegram_id = c.telegram_id and used_at is null;   -- остальные живые коды этого Telegram больше не нужны
  delete from public.tg_claim_attempts where user_id = uid;
  perform public.log_event('telegram_linked', c.telegram_id::text);
  return c.telegram_id;
end $$;
revoke all on function public.claim_telegram_code(text) from public, anon;
grant execute on function public.claim_telegram_code(text) to authenticated;

-- обратная совместимость: старые закэшированные клиенты зовут link_telegram(p_code)
create or replace function public.link_telegram(p_code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare r bigint;
begin
  r := public.claim_telegram_code(p_code);
  if r is null then raise exception 'invalid or expired code'; end if;
  return r;
end $$;
grant execute on function public.link_telegram(text) to authenticated;

-- уборка: добавляем таблицы v5.3 в ежедневную чистку
create or replace function public.prune_v53() returns void language sql security definer set search_path = public as $$
  delete from public.tg_link_codes     where expires_at < now() - interval '1 day';
  delete from public.tg_claim_attempts where created_at < now() - interval '1 day';
$$;
revoke all on function public.prune_v53() from public, anon, authenticated;
grant execute on function public.prune_v53() to service_role;

-- 4) Changelog 5.3.0 «SMART AUTH & PRE-RUST» (15.11.2026) -----------------------------------------------
do $$
declare v jsonb;
begin
  select value into v from public.global_settings where key = 'changelog';
  if v is null or (v->'versions') @> '[{"version": "5.3.0"}]'::jsonb then return; end if;
  update public.global_settings set updated_at = now(), value = jsonb_build_object(
    'current', '5.3.0',
    'versions', jsonb_build_array(jsonb_build_object(
      'version', '5.3.0', 'date', '2026-11-15', 'title', 'v5.3 SMART AUTH & PRE-RUST', 'order', 0,
      'items', $i$["Вход по 6-значному коду: Email → «Выслать код» → «Войти»; ссылки из писем убраны, добавлена кнопка «Зарегистрироваться»", "Окно «Добро пожаловать» больше не появляется при каждой перезагрузке, если никнейм уже выбран", "Мобильная вёрстка: вкладки и кнопки переносятся, тумблеры не растягиваются, карточки заявок и новостей без пустот", "Студия: кнопка «Войти» в профиле — вход нужен для синхронизации сайтов и профиля", "Привязка Телеграма: код живёт 15 минут, защита от перебора (claim_telegram_code)", "Бот: несколько ключей ИИ с автопереключением (Groq 1 → Groq 2 → OpenRouter), экономия токенов на запасных ключах, расширенный /status", "Бот разделён на модули; ARCHITECTURE.md и amoore_identity.txt — подготовка к переходу на Rust (v6.0)"]$i$::jsonb
    )) || coalesce((select jsonb_agg(jsonb_set(x, '{order}', to_jsonb(coalesce((x->>'order')::int, 0) + 1)))
                     from jsonb_array_elements(v->'versions') x), '[]'::jsonb))
  where key = 'changelog';
end $$;
update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '5.3.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('5.3.0', 'v5.3 SMART AUTH & PRE-RUST', '2026-11-15',
  $i$["Вход по 6-значному коду: Email → «Выслать код» → «Войти»; ссылки из писем убраны, добавлена кнопка «Зарегистрироваться»", "Окно «Добро пожаловать» больше не появляется при каждой перезагрузке, если никнейм уже выбран", "Мобильная вёрстка: вкладки и кнопки переносятся, тумблеры не растягиваются, карточки заявок и новостей без пустот", "Студия: кнопка «Войти» в профиле — вход нужен для синхронизации сайтов и профиля", "Привязка Телеграма: код живёт 15 минут, защита от перебора (claim_telegram_code)", "Бот: несколько ключей ИИ с автопереключением (Groq 1 → Groq 2 → OpenRouter), экономия токенов на запасных ключах, расширенный /status", "Бот разделён на модули; ARCHITECTURE.md и amoore_identity.txt — подготовка к переходу на Rust (v6.0)"]$i$::jsonb, 0)
on conflict (version) do nothing;

-- Проверка:
-- select username, onboarded from public.profiles where btrim(coalesce(username,'')) <> '' and not onboarded;   -- 0 строк
-- select version from public.changelog_versions order by sort_order limit 2;                                     -- 5.3.0, 5.2.0
-- select public.claim_telegram_code('000000');                                                                   -- NULL (под пользователем)
