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
