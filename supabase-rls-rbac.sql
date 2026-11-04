-- ============================================================
-- amoore Dev — RBAC Migration (роли + RLS)
-- Выполнить в Supabase → SQL Editor ПОСЛЕ основной schema
-- ============================================================

-- 1. Расширяем CHECK для роли: + moderator
ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE public.admins
  ADD CONSTRAINT admins_role_check
  CHECK (role IN ('super_admin', 'admin', 'moderator'));

-- 2. Хелпер: роль текущего пользователя (по email из JWT)
CREATE OR REPLACE FUNCTION public.current_admin_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.admins
  WHERE email = (auth.jwt() ->> 'email')
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.admins
  WHERE email = (auth.jwt() ->> 'email')
  LIMIT 1;
$$;

-- ============================================================
-- 3. Пересоздаём политики admins
-- ============================================================
DROP POLICY IF EXISTS "Admins: select own or service" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated select" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated insert" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated delete" ON public.admins;
DROP POLICY IF EXISTS "Admins: authenticated update" ON public.admins;
DROP POLICY IF EXISTS "Admins: select by role" ON public.admins;
DROP POLICY IF EXISTS "Admins: insert super only" ON public.admins;
DROP POLICY IF EXISTS "Admins: update super only" ON public.admins;
DROP POLICY IF EXISTS "Admins: delete super only" ON public.admins;

-- Читать список админов: super_admin и admin (для логов/команды)
-- moderator тоже может SELECT себя при логине (нужен для verify)
CREATE POLICY "Admins: select authenticated"
  ON public.admins FOR SELECT
  TO authenticated
  USING (true);

-- INSERT только super_admin
CREATE POLICY "Admins: insert super only"
  ON public.admins FOR INSERT
  TO authenticated
  WITH CHECK (public.current_admin_role() = 'super_admin');

-- UPDATE (смена роли и т.д.) только super_admin
CREATE POLICY "Admins: update super only"
  ON public.admins FOR UPDATE
  TO authenticated
  USING (public.current_admin_role() = 'super_admin')
  WITH CHECK (public.current_admin_role() = 'super_admin');

-- DELETE только super_admin, нельзя удалить себя
CREATE POLICY "Admins: delete super only"
  ON public.admins FOR DELETE
  TO authenticated
  USING (
    public.current_admin_role() = 'super_admin'
    AND id <> public.current_admin_id()
  );

-- ============================================================
-- 4. ecosystem_sites
-- ============================================================
DROP POLICY IF EXISTS "Sites: public read" ON public.ecosystem_sites;
DROP POLICY IF EXISTS "Sites: authenticated update" ON public.ecosystem_sites;
DROP POLICY IF EXISTS "Sites: update admin+" ON public.ecosystem_sites;

CREATE POLICY "Sites: public read"
  ON public.ecosystem_sites FOR SELECT
  TO anon, authenticated
  USING (true);

-- UPDATE статуса: только super_admin и admin (не moderator)
CREATE POLICY "Sites: update admin+"
  ON public.ecosystem_sites FOR UPDATE
  TO authenticated
  USING (public.current_admin_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.current_admin_role() IN ('super_admin', 'admin'));

-- ============================================================
-- 5. audit_logs
-- ============================================================
DROP POLICY IF EXISTS "Audit: authenticated insert" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit: authenticated select" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit: insert admin+" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit: select admin+" ON public.audit_logs;

-- Писать логи: super_admin и admin (при open/close)
CREATE POLICY "Audit: insert admin+"
  ON public.audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.current_admin_role() IN ('super_admin', 'admin'));

-- Читать логи: super_admin и admin (не moderator)
CREATE POLICY "Audit: select admin+"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.current_admin_role() IN ('super_admin', 'admin'));

-- ============================================================
-- Готово. Проверка:
-- SELECT public.current_admin_role();  -- после логина
-- ============================================================
