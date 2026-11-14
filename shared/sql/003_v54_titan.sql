-- ============================================================================================
-- 003_v54_titan.sql — amoore v5.4 «TITAN». Идемпотентна: безопасно запускать повторно.
-- 001_init_database.sql заморожен; всё новое — только здесь. Запускать после 002_v53_updates.sql.
-- ============================================================================================

-- 1) tg_link_codes (/link в Telegram): таблица + RLS ---------------------------------------------
create table if not exists public.tg_link_codes (
  code        text primary key check (code ~ '^[0-9]{6}$'),
  telegram_id bigint not null,
  expires_at  timestamptz not null default now() + interval '10 minutes',
  used_at     timestamptz
);
alter table public.tg_link_codes add column if not exists used_at timestamptz;
alter table public.tg_link_codes add column if not exists expires_at timestamptz not null default now() + interval '10 minutes';
create index if not exists tg_link_codes_tg_idx on public.tg_link_codes (telegram_id, expires_at);
alter table public.tg_link_codes enable row level security;
-- клиентам (anon/authenticated) прямого доступа нет: код выдаёт бот (service_role), гасит его RPC link_telegram (security definer)
revoke all on public.tg_link_codes from anon, authenticated;
drop policy if exists tg_link_codes_service on public.tg_link_codes;
create policy tg_link_codes_service on public.tg_link_codes for all to service_role using (true) with check (true);
grant usage on schema public to service_role;
grant all on public.tg_link_codes to service_role;

-- 2) Пульс бота: строка main гарантирована, бот (service_role) может делать upsert ---------------
insert into public.bot_status (id) values ('main') on conflict (id) do nothing;
grant select, insert, update on public.bot_status to service_role;

-- 3) «Онлайн»: окно 90 секунд (пинг приходит раз в 25 с, запас на сон вкладки/мобильную сеть) ------
create or replace function public.online_now(p_site text default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.site_presence
   where last_seen > now() - interval '90 seconds' and (p_site is null or site_id = p_site)
     and (public.is_admin_user() or public.is_boss());
$$;
grant execute on function public.online_now(text) to authenticated;

-- 4) Подписи ролей по-русски: founder / moder / user → Основатель / Модератор / Пользователь -------
update public.global_settings set value = coalesce((
  select jsonb_object_agg(t.k, case lower(trim(t.v))
      when 'founder' then 'Основатель' when 'super_admin' then 'Основатель'
      when 'moder' then 'Модератор' when 'moderator' then 'Модератор'
      when 'admin' then 'Администратор' when 'user' then 'Пользователь' else t.v end)
  from jsonb_each_text(value) as t(k, v)), value)
where key = 'role_labels' and jsonb_typeof(value) = 'object';
update public.global_settings set value = value || jsonb_build_object('user', 'Пользователь')
where key = 'role_labels' and jsonb_typeof(value) = 'object' and not (value ? 'user');

-- 5) Лидерборд: Топ-10 по баллам (публично, только открытые профили) ---------------------------------
create or replace function public.leaderboard_top10()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by (r->>'points')::int desc, r->>'username'), '[]'::jsonb) from (
    select jsonb_build_object('username', p.username, 'display_name', p.display_name, 'avatar_url', nullif(p.avatar_url, ''),
                              'avatar_color', p.avatar_color, 'points', p.rewards_balance) as r
      from public.profiles p
     where p.is_public and not p.is_banned and p.onboarded and p.username is not null and p.rewards_balance > 0
     order by p.rewards_balance desc, p.username limit 10) x
$$;
grant execute on function public.leaderboard_top10() to anon, authenticated;

-- 6) «Завершить все сессии» (включая текущую) --------------------------------------------------------
create or replace function public.revoke_all_sessions()
returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  delete from auth.sessions where user_id = auth.uid();      -- каскадно удаляет refresh-токены
  get diagnostics n = row_count;
  delete from public.user_sessions where user_id = auth.uid();
  perform public.log_event('sessions_revoked_all', n::text || ' sessions');
  return n;
end $$;
grant execute on function public.revoke_all_sessions() to authenticated;

-- 7) Заявки (CRM): значения статуса ограничены, теги — массив ---------------------------------------
alter table public.leads add column if not exists status text not null default 'new';
alter table public.leads add column if not exists tags text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_status_chk') then
    alter table public.leads add constraint leads_status_chk check (status in ('new', 'in_progress', 'rejected', 'done')) not valid;
  end if;
end $$;

-- 8) Changelog: запись v5.4.0 «TITAN» (если ещё нет) — чип версии и бот подхватят её из БД ----------------
update public.global_settings set value = jsonb_set(jsonb_set(value, '{current}', '"5.4.0"'),
  '{versions}', jsonb_build_array(jsonb_build_object('version', '5.4.0', 'date', '2026-11-14', 'title', 'TITAN', 'order', -1,
    'items', '["Мобильная вёрстка: плашки ролей по-русски, вкладки профиля с горизонтальным скроллом, компактные формы «Команда», карточки «Люди» сеткой, фильтр логов без вылезаний.", "Вход: в админке только Email, Пароль и Токен; на лендинге — Email, код из письма и «Зарегистрироваться».", "Бот: пульс раз в 5 минут (upsert с проверкой), «онлайн» считается корректно, ключи GROQ_1/2, OpenRouter и Google AI, /status с пульсом.", "Безопасность: «Завершить все сессии», переподключение Telegram-вебхука из админки.", "Социалка: лидерборд Топ-10 и публичное портфолио amoore.ru/u/имя.", "Changelog 2.0: вкладки «Обновления» и «Эры», старые версии сверху.", "Подготовка к Rust: бот разбит на ai_logic, db_bridge, tg_handlers; добавлены ARCHITECTURE.md и amoore_identity.txt."]'::jsonb)) || (value->'versions'))
where key = 'changelog' and jsonb_typeof(value->'versions') = 'array'
  and not exists (select 1 from jsonb_array_elements(value->'versions') e where e->>'version' = '5.4.0');
