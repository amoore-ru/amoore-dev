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
