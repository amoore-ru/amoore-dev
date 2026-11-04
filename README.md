# amoore Dev v4.0 — Mission Control

## Быстрый старт

1. SQL Editor по порядку:
   - `supabase-schema.sql`
   - `supabase-rls-rbac.sql`
   - `supabase-v4-mission-control.sql`
2. Storage → New bucket **`media`** (Public)
3. Раскомментируй storage policies в конце `supabase-v4-mission-control.sql`
4. Edge Function:
   ```bash
   supabase functions deploy send-telegram
   supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
   ```
5. В `app.js` и на сайтах (core.js config):
   ```js
   const SUPABASE_URL  = 'https://xxx.supabase.co';
   const SUPABASE_ANON = 'eyJ...';
   ```

## Вкладки и роли

| Вкладка | super_admin | admin | moderator |
|---------|-------------|-------|-----------|
| Дашборд | ✅ | ✅ | ✅ (без тумблеров) |
| Контент | ✅ | ✅ | — |
| Бот | ✅ | ✅ | — |
| Медиа | ✅ | ✅ | — |
| Настройки (flags) | ✅ | — | — |
| Команда | ✅ | — | — |
| Логи | ✅ | ✅ | — |

## amoore-core.js на сайтах

```html
<script>
  window.AMOORE_SITE_ID = 'landing';
  window.AMOORE_SUPABASE_URL = 'https://xxx.supabase.co';
  window.AMOORE_SUPABASE_ANON = 'eyJ...';
  window.AMOORE_NEWS_SELECTOR = '#news-list'; // опционально
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/amoore-core.js"></script>
```

Делает: статус/заставки, God Mode, визиты, feature-flag классы `flag-*`, рендер новостей.
