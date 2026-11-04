-- ============================================================
-- amoore Dev v2.0 — Supabase Schema (SQL Migration)
-- Выполнить в Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Таблица администраторов
CREATE TABLE IF NOT EXISTS public.admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  nickname      TEXT NOT NULL,
  telegram_id   TEXT,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'moderator')),
  access_token  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Таблица сайтов экосистемы
CREATE TABLE IF NOT EXISTS public.ecosystem_sites (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  overlay_type  TEXT NOT NULL DEFAULT 'maintenance' CHECK (overlay_type IN ('maintenance', 'crash', 'private')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Аудит-логи
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  site_id       TEXT REFERENCES public.ecosystem_sites(id) ON DELETE CASCADE,
  overlay_type  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Индексы
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_admins_email ON public.admins(email);
CREATE INDEX IF NOT EXISTS idx_audit_logs_site ON public.audit_logs(site_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- ============================================================
-- Триггер updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ecosystem_sites_updated ON public.ecosystem_sites;
CREATE TRIGGER trg_ecosystem_sites_updated
  BEFORE UPDATE ON public.ecosystem_sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- admins
DROP POLICY IF EXISTS "Admins: select own or service" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated select" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated insert" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated delete" ON public.admins;

CREATE POLICY "Admins: authenticated select"
  ON public.admins FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins: authenticated insert"
  ON public.admins FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins: authenticated delete"
  ON public.admins FOR DELETE
  TO authenticated
  USING (true);

-- ecosystem_sites
DROP POLICY IF EXISTS "Sites: public read" ON public.ecosystem_sites;
DROP POLICY IF EXISTS "Sites: authenticated update" ON public.ecosystem_sites;

CREATE POLICY "Sites: public read"
  ON public.ecosystem_sites FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Sites: authenticated update"
  ON public.ecosystem_sites FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- audit_logs
DROP POLICY IF EXISTS "Audit: authenticated insert" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit: authenticated select" ON public.audit_logs;

CREATE POLICY "Audit: authenticated insert"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Audit: authenticated select"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- Начальные данные (сайты)
-- ============================================================
INSERT INTO public.ecosystem_sites (id, name, url, status, overlay_type)
VALUES
  ('landing', 'amoore Landing', 'https://amoore-ru.github.io/', 'open', 'maintenance'),
  ('studio',  'amoore Studio',  'https://amoore-studio.vercel.app/', 'open', 'maintenance')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Администратор (UPSERT — работает и при пустой, и при существующей записи)
-- 1. Создайте пользователя в Authentication → Users (тот же email + пароль)
-- 2. Раскомментируйте и подставьте свои значения
-- ============================================================
-- INSERT INTO public.admins (email, name, nickname, telegram_id, role, access_token)
-- VALUES (
--   'founder@amoore.ru',
--   'Основатель',
--   'founder',
--   '123456789',
--   'super_admin',
--   'AMOORE-SECRET-TOKEN-CHANGE-ME'
-- )
-- ON CONFLICT (email) DO UPDATE SET
--   name         = EXCLUDED.name,
--   nickname     = EXCLUDED.nickname,
--   telegram_id  = EXCLUDED.telegram_id,
--   role         = EXCLUDED.role,
--   access_token = EXCLUDED.access_token;

-- ============================================================
-- Примечание
-- ============================================================
-- Пароль хранится в Supabase Auth (auth.users).
-- access_token — дополнительный секрет в таблице admins.
-- При входе: signInWithPassword → проверка email + access_token в admins.
