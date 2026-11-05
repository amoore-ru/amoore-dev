-- amoore Dev v5.0 — granular permissions
-- Выполнить в SQL Editor

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT NULL;

COMMENT ON COLUMN public.admins.permissions IS
  'NULL = defaults by role. Keys: toggle_sites, manage_news, view_logs, manage_admins (boolean)';

-- Пример:
-- UPDATE public.admins SET permissions = '{
--   "toggle_sites": true,
--   "manage_news": true,
--   "view_logs": false,
--   "manage_admins": false
-- }'::jsonb WHERE email = 'mod@example.com';
