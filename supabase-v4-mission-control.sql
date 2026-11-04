-- ============================================================
-- amoore Dev v4.0 — Mission Control migration
-- Выполнить после schema + rls-rbac
-- ============================================================

-- Хелперы (если ещё нет)
CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.admins WHERE email = (auth.jwt() ->> 'email') LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_admin_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.admins WHERE email = (auth.jwt() ->> 'email') LIMIT 1;
$$;

-- ============================================================
-- 1. NEWS (CMS)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.news (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,          -- text
  type          TEXT NOT NULL DEFAULT 'news'
                  CHECK (type IN ('news', 'patch', 'soon')),
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_published  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_published
  ON public.news (is_published, published_at DESC);

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "News: public read published" ON public.news;
DROP POLICY IF EXISTS "News: admin write" ON public.news;
DROP POLICY IF EXISTS "News: admin update" ON public.news;
DROP POLICY IF EXISTS "News: admin delete" ON public.news;

-- Публичное чтение опубликованных (landing / core.js)
CREATE POLICY "News: public read published"
  ON public.news FOR SELECT
  TO anon, authenticated
  USING (is_published = true OR public.current_admin_role() IN ('super_admin', 'admin'));

CREATE POLICY "News: admin insert"
  ON public.news FOR INSERT
  TO authenticated
  WITH CHECK (public.current_admin_role() IN ('super_admin', 'admin'));

CREATE POLICY "News: admin update"
  ON public.news FOR UPDATE
  TO authenticated
  USING (public.current_admin_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.current_admin_role() IN ('super_admin', 'admin'));

CREATE POLICY "News: admin delete"
  ON public.news FOR DELETE
  TO authenticated
  USING (public.current_admin_role() IN ('super_admin', 'admin'));

-- ============================================================
-- 2. BOT LOGS + STATUS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bot_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message       TEXT NOT NULL,
  admin_id      UUID REFERENCES public.admins(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'sent', -- sent | error
  error_text    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bot_status (
  id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton
  is_online     BOOLEAN NOT NULL DEFAULT false,
  last_heartbeat TIMESTAMPTZ,
  meta          JSONB DEFAULT '{}'::jsonb
);

INSERT INTO public.bot_status (id, is_online, last_heartbeat)
VALUES (1, false, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Bot logs: admin all" ON public.bot_logs;
DROP POLICY IF EXISTS "Bot logs: admin select" ON public.bot_logs;
DROP POLICY IF EXISTS "Bot logs: admin insert" ON public.bot_logs;
DROP POLICY IF EXISTS "Bot status: read auth" ON public.bot_status;
DROP POLICY IF EXISTS "Bot status: update service" ON public.bot_status;

CREATE POLICY "Bot logs: admin select"
  ON public.bot_logs FOR SELECT
  TO authenticated
  USING (public.current_admin_role() IN ('super_admin', 'admin'));

CREATE POLICY "Bot logs: admin insert"
  ON public.bot_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.current_admin_role() IN ('super_admin', 'admin'));

CREATE POLICY "Bot status: read auth"
  ON public.bot_status FOR SELECT
  TO authenticated
  USING (true);

-- Heartbeat может писать service role / edge function
CREATE POLICY "Bot status: update authenticated"
  ON public.bot_status FOR UPDATE
  TO authenticated
  USING (public.current_admin_role() IN ('super_admin', 'admin'))
  WITH CHECK (true);

-- ============================================================
-- 3. SITE VISITS (analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.site_visits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_created
  ON public.site_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_visits_site
  ON public.site_visits (site_id, created_at DESC);

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Visits: anon insert" ON public.site_visits;
DROP POLICY IF EXISTS "Visits: auth select" ON public.site_visits;

-- Анонимный INSERT с сайтов (core.js)
CREATE POLICY "Visits: anon insert"
  ON public.site_visits FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Visits: auth select"
  ON public.site_visits FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- 4. FEATURE FLAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key           TEXT PRIMARY KEY,
  description   TEXT NOT NULL DEFAULT '',
  is_enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.feature_flags (key, description, is_enabled) VALUES
  ('show_demo_chat', 'Показывать демо-чат на лендинге', false),
  ('new_studio_design', 'Новый дизайн Студии', false),
  ('show_news_block', 'Блок новостей на лендинге', true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Flags: public read" ON public.feature_flags;
DROP POLICY IF EXISTS "Flags: super update" ON public.feature_flags;

CREATE POLICY "Flags: public read"
  ON public.feature_flags FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Flags: super update"
  ON public.feature_flags FOR UPDATE
  TO authenticated
  USING (public.current_admin_role() = 'super_admin')
  WITH CHECK (public.current_admin_role() = 'super_admin');

CREATE POLICY "Flags: super insert"
  ON public.feature_flags FOR INSERT
  TO authenticated
  WITH CHECK (public.current_admin_role() = 'super_admin');

-- ============================================================
-- 5. STORAGE bucket public (медиатека)
-- Выполни также в Dashboard → Storage → New bucket: media (public)
-- ============================================================
-- Политики storage.objects (если bucket = media)
-- INSERT/SELECT для authenticated admin+

-- Пример (раскомментируй после создания bucket `media`):
/*
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Media: public read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'media');

CREATE POLICY "Media: admin upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND public.current_admin_role() IN ('super_admin', 'admin')
  );

CREATE POLICY "Media: admin delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND public.current_admin_role() IN ('super_admin', 'admin')
  );
*/
