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
  ('role_labels', '{"super_admin":"Основатель","admin":"Админ","moderator":"Модератор"}'::jsonb)
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
