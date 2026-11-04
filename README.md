# amoore Dev (Core)

Изолированная панель управления статусом сайтов экосистемы + скрипт-инжектор заставок.

## Стек

- HTML5 + Vanilla CSS (Liquid Glass, Dark Theme `#070b16`, Manrope)
- Vanilla JS
- Supabase (Auth + PostgreSQL)

---

## 1. Настройка Supabase

1. Создайте проект в [supabase.com](https://supabase.com).
2. Откройте **SQL Editor** и выполните файл `supabase-schema.sql`.
3. В **Authentication → Users** создайте пользователя (email + пароль).
4. В таблице `admins` вставьте запись:

```sql
INSERT INTO public.admins (email, name, nickname, telegram_id, role, access_token)
VALUES (
  'your@email.com',
  'Ваше Имя',
  'nickname',
  'telegram_id_optional',
  'super_admin',
  'ВАШ-СЕКРЕТНЫЙ-ТОКЕН'
);
```

5. Скопируйте **Project URL** и **anon public key** из Settings → API.

---

## 2. Панель amoore Dev

Файлы: `index.html` + `style.css`

В `index.html` замените:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';
```

Откройте `index.html` (или задеплойте на любой статический хостинг).

**Вход:**
- Email + Пароль (из Supabase Auth)
- Токен доступа (из таблицы `admins`)

Сессия хранится **только** в `sessionStorage` — при закрытии вкладки/браузера доступ слетает.

---

## 3. Скрипт-инжектор `amoore-core.js`

Подключайте на каждый сайт экосистемы (landing, studio и т.д.) **перед `</body>`**:

```html
<script>
  window.AMOORE_SITE_ID = 'landing';           // id из таблицы ecosystem_sites
  window.AMOORE_SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
  window.AMOORE_SUPABASE_ANON = 'YOUR_ANON_KEY';
</script>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://ваш-хостинг/amoore-core.js"></script>
```

### Поведение

| Статус сайта | Обычный пользователь | Админ (есть `amoore_dev_auth` в sessionStorage) |
|--------------|----------------------|-------------------------------------------------|
| `open`       | Ничего               | Ничего                                          |
| `closed`     | Полноэкранная заставка (maintenance / crash / private) | Золотая панель «Режим Админа» + кнопка «Открыть» |

Заставки используют изолированные классы `.amoore-lock-screen` и не ломают стили сайта.

---

## 4. Таблицы

| Таблица           | Назначение                                      |
|--------------------|-------------------------------------------------|
| `admins`           | Администраторы + access_token                   |
| `ecosystem_sites`  | Сайты и их статус / тип заставки                |
| `audit_logs`       | Логи действий (открыл / закрыл)                 |

Публичное чтение `ecosystem_sites` разрешено (для инжектора).  
Обновление — только для authenticated.

---

## 5. Файлы

```
amoore-dev/
├── index.html            # Панель (логин + дашборд)
├── style.css             # Liquid Glass Dark Theme
├── amoore-core.js        # Инжектор для сайтов
├── supabase-schema.sql   # Миграция
└── README.md
```

Готово к копированию и запуску.
