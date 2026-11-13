# amoore — база данных (v5.1 MASTER)

## Единый источник правды
Вся схема лежит в **одном файле — `001_init_database.sql`**. Миграций 002–010 больше нет.

1. Supabase → **SQL Editor → New query**.
2. Вставьте содержимое `001_init_database.sql` и нажмите **Run**.
3. Скрипт идемпотентен (`CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`): его можно запускать повторно на существующей базе, данные не удаляются.

Что внутри: таблицы (admins, profiles, business_automations, changelog_versions, leads, news, audit_logs, user_sessions, push_subscriptions, user_sites, rewards_log …), функции и триггеры, RLS-политики, Storage-бакеты `media` и `avatars`, индексы (user_id / created_at / is_published), Realtime-публикации и сид-данные (глобальные настройки, changelog до v5.1.0).

Разделы 1–9 — прежняя схема v1.0–v5.0 в порядке применения; раздел 10 — новое в v5.1.

## Дополнительно
`cleanup.sql` — разовая уборка «битых» записей news/ecosystem_sites (сначала предпросмотр, удалённое копируется в `_cleanup_backup_*`). Не входит в основную схему.

## Первый администратор
Создайте пользователя в Supabase → Authentication, затем:
```sql
insert into public.admins (email, name, nickname, role, access_token)
values ('admin@example.com', 'Имя', 'Ник', 'super_admin', 'ЗАМЕНИТЬ_НА_СЛУЧАЙНЫЙ_ТОКЕН');
```
Токен не храните в репозитории.
