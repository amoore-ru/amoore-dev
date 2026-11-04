# amoore Dev v2.0

Панель управления статусом сайтов + команда + логи + инжектор заставок.

## Стек

HTML5 · Vanilla CSS (Liquid Glass, Dark `#070b16`, Manrope) · Vanilla JS · Supabase

---

## 1. Supabase

1. SQL Editor → выполнить `supabase-schema.sql`
2. Authentication → Users → создать пользователя (email + пароль)
3. Раскомментировать и выполнить UPSERT админа:

```sql
INSERT INTO public.admins (email, name, nickname, telegram_id, role, access_token)
VALUES (
  'your@email.com',
  'Ваше Имя',
  'nickname',
  NULL,
  'super_admin',
  'ВАШ-СЕКРЕТНЫЙ-ТОКЕН'
)
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  nickname = EXCLUDED.nickname,
  role = EXCLUDED.role,
  access_token = EXCLUDED.access_token;
```

4. Settings → API → скопировать URL и anon key

---

## 2. Панель

В `index.html` заменить:

```js
const SUPABASE_URL  = 'https://....supabase.co';
const SUPABASE_ANON = 'eyJ...';
```

Вкладки:
- **Дашборд** — статистика + карточки сайтов (Landing / Studio)
- **Команда** — добавление админов, генерация токена, удаление (super_admin)
- **Логи** — audit_logs с ником, действием, сайтом, временем

Сессия только в `sessionStorage`.

---

## 3. Инжектор `amoore-core.js`

```html
<script>
  window.AMOORE_SITE_ID = 'landing'; // или 'studio'
  window.AMOORE_SUPABASE_URL = 'https://....supabase.co';
  window.AMOORE_SUPABASE_ANON = 'eyJ...';
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="/path/to/amoore-core.js"></script>
```

### God Mode

| Способ | Как |
|--------|-----|
| sessionStorage | после входа в панель токен уже там |
| URL | `?god=ВАШ_ТОКЕН` → сохраняется и страница перезагружается |

God Bar: `position: relative` + `body.prepend` — сдвигает контент, не перекрывает шапку.

---

## Файлы

```
amoore-dev/
├── index.html
├── style.css
├── amoore-core.js
├── supabase-schema.sql
└── README.md
```
