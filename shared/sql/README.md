# amoore — Database & Frontend Setup

## 1. Развернуть базу данных с нуля

1. Откройте проект в **Supabase**.
2. Перейдите в **SQL Editor → New query**.
3. Откройте `database-setup/001_init_database.sql` (или файл из `amoore-db-setup.zip`).
4. Скопируйте весь SQL в редактор и нажмите **Run**.
5. Проверьте результат в **Table Editor**.

> Важно: скрипт использует `CREATE TABLE IF NOT EXISTS` и `CREATE OR REPLACE FUNCTION`, а политики перед созданием удаляются. Однако повторный запуск не является универсально безопасным для любых изменений существующей схемы: проверьте миграцию на тестовом проекте и сделайте резервную копию перед запуском в production. Скрипт не удаляет таблицы и записи.

## 2. Залить фронтенд через GitHub Desktop

1. Скачайте и распакуйте нужный frontend ZIP.
2. Откройте соответствующий репозиторий в **GitHub Desktop**.
3. Замените файлы проекта файлами из распакованной папки (не заменяйте `.git`).
4. В GitHub Desktop проверьте изменения во вкладке **Changes**.
5. Введите Summary, нажмите **Commit to ...**, затем **Push origin**.
6. Дождитесь завершения сборки/деплоя на Cloudflare Pages или GitHub Pages.

## 3. Добавить нового администратора

1. Создайте пользователя в **Supabase → Authentication → Users → Add user** (email + пароль).
2. В SQL Editor добавьте запись в `public.admins` с **тем же email**, именем, nickname, ролью, токеном доступа и permissions. Пример:

```sql
insert into public.admins (email, name, nickname, role, access_token)
values ('admin@example.com', 'Имя', 'Ник', 'moderator', 'ЗАМЕНИТЬ_НА_СЛУЧАЙНЫЙ_ТОКЕН');
```

3. Используйте email, совпадающий с email в Supabase Auth. Выберите роль и права осознанно.
4. Не публикуйте `access_token` и не храните его в репозитории. Для первого `super_admin` запись создавайте через SQL Editor с проверенным токеном.

## Состав схемы и ограничение исходников

Миграция собрана из SQL, найденного в предоставленных архивах. В исходном `shared/sql/001_amoore_schema.sql` определены `admins`, `ecosystem_sites`, `news`, `site_visits`, `audit_logs`, `bot_logs`, функции, триггеры, RLS, Storage bucket `media`, Realtime и начальные данные.

В доступных исходниках **не найдено** определения таблиц `bot_status` и `feature_flags`, а также функции `current_admin_role`. Они не добавлены искусственно: перед production-развёртыванием предоставьте их актуальные определения/миграции и объедините с Golden Schema. Проверьте SQL на тестовом Supabase-проекте.


## Миграции v3.0
| Файл | Назначение |
| --- | --- |
| `004_v30_singularity.sql` | индекс `news_pub_idx` (только опубликованные), индексы заявок/журнала, очередь `digest_queue`, Realtime для `leads` |
| `cleanup.sql` | удаление «битых» записей news/ecosystem_sites; сначала предпросмотр, удалённое копируется в `_cleanup_backup_*` |

Порядок: 001 → 002 → 003 → 004 (→ cleanup.sql). RLS нигде не отключается.


## Миграция v4.0 «NEXUS»
| Файл | Назначение |
| --- | --- |
| `005_v4_nexus.sql` | `admins.last_seen_at` («Админы в сети»), таблица `global_settings` (`role_labels`, `changelog`), тип новости `digest`, право `view_logs` у moderator, RPC `quick_admins` / `touch_admin_seen` / `touch_admin_by_token` |

Порядок: 001 → 002 → 003 → 004 → 005 (→ cleanup.sql). RLS нигде не отключается.
Роли в БД: `super_admin` = «Основатель», `admin` = «Админ», `moderator` = «Модератор» (подписи меняются в админке → Настройки → Названия ролей).

## 006_v42_rls_and_settings.sql (v4.2)
Запускать после 005. Идемпотентна. Даёт: RLS для сохранения профилей/ролей в `admins` (админ — свой профиль, основатель — любые; смену роли и прав по-прежнему блокирует триггер из 001), политики `global_settings`, таблицу `changelog_versions` (порядок `sort_order`) и готовый changelog v1.0.0 → v4.2.0.
