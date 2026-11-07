-- =====================================================================
-- amoore v3.0 «Singularity» — миграция БД (выполнять в Supabase → SQL Editor)
-- Идемпотентна: повторный запуск безопасен. Порядок: 001 → 002 → 003 → 004 (→ cleanup.sql по желанию).
-- Что делает:
--   1) ускоряет запросы лендинга (частичный индекс только по ОПУБЛИКОВАННЫМ новостям);
--   2) индексы для счётчика новых заявок и выборок дайджеста;
--   3) создаёт очередь digest_queue — «Отправить боту» в админке → бот шлёт дайджест админам;
--   4) включает Realtime для leads (красный счётчик в админке обновляется сам).
-- RLS не отключается и не ослабляется.
-- =====================================================================

-- 1) Новости: лендинг всегда спрашивает is_published = true ORDER BY published_at DESC LIMIT 20.
--    Частичный индекс покрывает ровно этот запрос и не растёт за счёт черновиков.
create index if not exists news_pub_idx on public.news (published_at desc) where is_published;

-- 2) Заявки и события: счётчик «новые заявки» и выборки дайджеста за 7 дней
create index if not exists leads_new_idx       on public.leads (created_at desc) where status = 'new';
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists site_visits_site_idx  on public.site_visits (site_id, created_at desc);

-- 3) Очередь запросов на дайджест
create table if not exists public.digest_queue (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'dev' check (source in ('dev', 'auto', 'bot')),
  period        text,                                   -- для автодайджеста: ISO-неделя, например 2026-W45
  status        text not null default 'pending' check (status in ('pending', 'sent', 'error')),
  requested_by  uuid references public.admins(id) on delete set null,
  requested_at  timestamptz not null default now(),
  processed_at  timestamptz,
  error_text    text not null default ''
);
create index if not exists digest_queue_pending_idx on public.digest_queue (requested_at) where status = 'pending';
-- не больше ОДНОЙ ожидающей заявки одновременно: защита от спама кнопкой
create unique index if not exists digest_one_pending on public.digest_queue ((true)) where status = 'pending';

alter table public.digest_queue enable row level security;
drop policy if exists digest_select on public.digest_queue;
drop policy if exists digest_insert on public.digest_queue;
create policy digest_select on public.digest_queue for select to authenticated using (public.is_admin_user());
create policy digest_insert on public.digest_queue for insert to authenticated
  with check (public.has_perm('view_logs') and source = 'dev' and status = 'pending'
              and requested_by = (select id from public.current_admin()));
-- UPDATE/DELETE политик нет намеренно: статус меняет только бот (ключ service role обходит RLS)

-- 4) Realtime для заявок (RLS при этом продолжает действовать: события видят только админы)
do $$
begin
  begin alter publication supabase_realtime add table public.leads; exception when others then null; end;
end $$;

-- Проверка:
-- select indexname from pg_indexes where schemaname = 'public' and indexname in ('news_pub_idx','leads_new_idx','digest_one_pending');
