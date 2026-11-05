# amoore Dev v5.0

## Миграции SQL (по порядку)
1. `supabase-schema.sql`
2. `supabase-rls-rbac.sql`
3. `supabase-v4-mission-control.sql` (news, flags, visits, media)
4. **`supabase-v5-permissions.sql`** — колонка `admins.permissions` (JSONB)

## Конфиг
В `app.js`:
```js
const SUPABASE_URL  = 'https://xxx.supabase.co';
const SUPABASE_ANON = 'eyJ...';
```

## Роли и permissions
Ключи JSONB: `toggle_sites`, `manage_news`, `view_logs`, `manage_admins`  
`null` = дефолт роли (super/admin/moderator).  
Super admin → модалка «Права» у каждого пользователя.

## Вкладки
Дашборд (сайты + новости) · Медиа · Настройки · Команда · Логи  
Удалены: Контент, Бот.

## Лендинг
`amoore-core.js` тянет published news в `#news-list` / `[data-amoore-news]`.
