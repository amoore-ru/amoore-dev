-- 008_v580_aurum_merge.sql — v5.8.0 «AURUM MERGE». Идемпотентна, без DROP таблиц с данными.
-- Применять в Supabase SQL Editor после 007_v571_global_polish.sql.
-- ВНИМАНИЕ: файл НЕ прогонялся на реальном Postgres — сначала примените на копии/ветке проекта.

-- 1) Права по умолчанию для 5 ролей: super_admin (Основатель), cofounder, admin (Администратор), vip, moderator.
create or replace function public.role_default_perm(p_role text, p_key text)
returns boolean language sql immutable as $$
  select case
    when p_role = 'super_admin' then true
    when p_role = 'cofounder' then p_key in
      ('toggle_status','toggle_banner','toggle_chat','toggle_news','manage_news','manage_media','manage_sites','view_logs','download_backup')
    when p_role = 'admin' then p_key in
      ('toggle_status','toggle_banner','toggle_chat','toggle_news','manage_news','manage_media','view_logs')
    when p_role = 'vip' then p_key in ('view_logs')
    when p_role = 'moderator' then p_key in ('view_logs')
    else false
  end;
$$;

-- 2) profiles.role: разрешить новые значения (NOT VALID — существующие строки не перепроверяются, миграция не упадёт на старых данных)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
  alter table public.profiles add constraint profiles_role_check
    check (role in ('user','moderator','vip','admin','cofounder','super_admin')) not valid;
exception when undefined_table or undefined_column then null;
end $$;

-- 3) Changelog в global_settings: записи 5.8.0, 6.0.0 (скоро) и исправленные даты 5.1.0–5.3.0; остальные версии не трогаются
do $$
declare new_items jsonb := $json$[{"version": "6.0.0", "title": "VITESITE", "soon": true, "items": ["Бот amoore на Rust: быстрее отклик и меньше потребление памяти.", "Единое ядро для лендинга, Студии и админки."]}, {"version": "5.8.0", "date": "2026-11-15", "title": "AURUM MERGE", "items": ["Changelog: аккордеон — на экране только главные версии, подверсии спрятаны под «▼ Подверсии (N)». Главные идут от новых к старым, подверсии внутри — от старых к новым. Бейджи NEW и «Скоро», вкладка «Эры» — таймлайн карточек.", "Дизайн AURUM: чёрный, графит и белый с тонкой золотой окантовкой, тёмно-фиолетовые кнопки с мягким свечением, минималистичные карточки без лишних теней.", "Тумблеры: включён — зелёный с галочкой, выключен — красно-графитовый с крестиком. Три темы: светлая, тёмная и системная.", "Лендинг и профиль: bento-плитки amoore AI / studio / ecosystem / ID с золотой окантовкой, широкая обложка и аватар слева с наложением, «Режим Бога» в стиле Deep Glass, нижняя панель не перекрывает контент.", "Админка: 5 ролей (Основатель, Сооснователь, Администратор, VIP, Модератор), лупа и колокольчик с Realtime-уведомлениями в шапке, бургер-меню до 1360 px.", "Исправлено: падение ядра лендинга на старте, неверная версия в чипе, «undefined баллов» в «Режиме Бога», статус бота при нестандартном ответе bot_health, пропадающий блок «Названия ролей» во вкладке «Команда»."]}, {"version": "5.3.0", "date": "2026-11-10", "title": "SMART AUTH & PRE-RUST", "items": ["Вход по 6-значному коду: Email → «Выслать код» → «Войти»; ссылки из писем убраны, добавлена кнопка «Зарегистрироваться»", "Окно «Добро пожаловать» больше не появляется при каждой перезагрузке, если никнейм уже выбран", "Мобильная вёрстка: вкладки и кнопки переносятся, тумблеры не растягиваются, карточки заявок и новостей без пустот", "Студия: кнопка «Войти» в профиле — вход нужен для синхронизации сайтов и профиля", "Привязка Телеграма: код живёт 15 минут, защита от перебора (claim_telegram_code)", "Бот: несколько ключей ИИ с автопереключением (Groq 1 → Groq 2 → OpenRouter), экономия токенов на запасных ключах, расширенный /status", "Бот разделён на модули; ARCHITECTURE.md и amoore_identity.txt — подготовка к переходу на Rust (v6.0)"]}, {"version": "5.2.0", "date": "2026-11-07", "title": "POLISH & SYNC", "items": ["Единый профиль amoore id: ник, аватарка (фото или цвет) и роль одинаковы в админке, студии и на сайте", "Полная русификация интерфейса; amoore пишется строчными", "Админка: вход в стиле Liquid Glass, настройки только «Внешний вид» и «Профиль», Changelog переехал в «Новости → Обновления»", "Удалена Телеграм-рассылка из админки", "Починена привязка Телеграма: код /link создаётся, причина сбоя видна основателю", "Единый UI-кит: вкладки-чипсы, тумблеры и кнопки; поля ввода больше не вылезают за экран на телефоне", "Скелетоны вместо «Загрузка…»; карта посетителей по городам на дашборде", "Защита основателя на уровне базы данных", "Студия: профиль в настройках, проекты в профиле amoore id, сжатие картинок в WebP", "Колокольчик уведомлений на лендинге"]}, {"version": "5.1.0", "date": "2026-11-05", "title": "MASTER", "items": ["Великая чистка БД: единый файл 001_init_database.sql", "Web App Лендинг: вкладки без перезагрузки и хэш-навигация", "AI Бизнес-ассистент для Телеграм Business", "Баллы amoore: реферальные ссылки и баллы", "CRM с тегами, экспорт заявок в CSV", "Push-уведомления (PWA) о новостях", "Публичные профили amoore.ru/u/username"]}]$json$::jsonb;
begin
  if not exists (select 1 from public.global_settings where key = 'changelog') then
    insert into public.global_settings (key, value) values ('changelog', jsonb_build_object('current', '5.8.0', 'versions', new_items));
  else
    update public.global_settings
       set value = jsonb_set(jsonb_set(coalesce(value, '{}'::jsonb), '{current}', '"5.8.0"'), '{versions}',
             new_items || coalesce((select jsonb_agg(e) from jsonb_array_elements(case when jsonb_typeof(value->'versions') = 'array' then value->'versions' else '[]'::jsonb end) e
                                     where e->>'version' not in ('5.8.0','6.0.0','5.1.0','5.2.0','5.3.0')), '[]'::jsonb))
     where key = 'changelog';
  end if;
end $$;


-- 4) Исправление дат 5.0.0–5.3.0 в уже применённых БД (v5.8.0, правка дат): 5.0.0=01.11, 5.1.0=05.11, 5.2.0=07.11, 5.3.0=10.11 (2026)
do $$
begin
  update public.changelog_versions
     set released = case version when '5.0.0' then date '2026-11-01' when '5.1.0' then date '2026-11-05'
                                 when '5.2.0' then date '2026-11-07' when '5.3.0' then date '2026-11-10' end
   where version in ('5.0.0','5.1.0','5.2.0','5.3.0');
exception when undefined_table or undefined_column then null;
end $$;

update public.global_settings
   set value = jsonb_set(value, '{versions}', (
     select jsonb_agg(
              case e->>'version'
                when '5.0.0' then jsonb_set(e, '{date}', '"2026-11-01"')
                when '5.1.0' then jsonb_set(e, '{date}', '"2026-11-05"')
                when '5.2.0' then jsonb_set(e, '{date}', '"2026-11-07"')
                when '5.3.0' then jsonb_set(e, '{date}', '"2026-11-10"')
                else e end
              order by ord)
       from jsonb_array_elements(value->'versions') with ordinality as t(e, ord)))
 where key = 'changelog' and jsonb_typeof(value->'versions') = 'array' and jsonb_array_length(value->'versions') > 0;   -- пустой массив дал бы NULL от jsonb_agg
