-- =====================================================================
-- amoore v3.0 — cleanup.sql: удаление «битых» записей из news и ecosystem_sites
-- Безопасный порядок:
--   ШАГ 1. Выполните блок «ПРЕДПРОСМОТР» — он ничего не меняет и показывает, что будет затронуто.
--   ШАГ 2. Выполните блок «ЧИСТКА». Удалённое сначала копируется в таблицы _cleanup_backup_* —
--          при ошибке строки можно вернуть: insert into public.news select * from public._cleanup_backup_news;
-- Что считается «битым»:
--   news            — пустой заголовок (или только пробелы);
--   ecosystem_sites — ID не в формате латиницы ^[a-z0-9][a-z0-9_-]{1,31}$ (или пустой/слишком длинный).
-- Чинятся без удаления: неизвестный type новости → 'news'; пустое название сайта → его ID.
-- =====================================================================

-- ---------- ШАГ 1. ПРЕДПРОСМОТР (ничего не меняет) ----------
select 'news: пустой заголовок' as problem, count(*) as rows
  from public.news where btrim(coalesce(title, '')) = ''
union all
select 'news: неизвестный type (будет исправлен)', count(*)
  from public.news where type is null or type not in ('news', 'patch', 'soon')
union all
select 'ecosystem_sites: неверный ID', count(*)
  from public.ecosystem_sites where id is null or id !~ '^[a-z0-9][a-z0-9_-]{1,31}$'
union all
select 'ecosystem_sites: пустое название (будет исправлено)', count(*)
  from public.ecosystem_sites where btrim(coalesce(name, '')) = '';

-- ---------- ШАГ 2. ЧИСТКА ----------
begin;

create table if not exists public._cleanup_backup_news  (like public.news including defaults);
create table if not exists public._cleanup_backup_sites (like public.ecosystem_sites including defaults);
-- служебные копии недоступны через API
alter table public._cleanup_backup_news  enable row level security;
alter table public._cleanup_backup_sites enable row level security;

-- news: резервная копия и удаление записей без заголовка
insert into public._cleanup_backup_news
  select * from public.news where btrim(coalesce(title, '')) = '';
delete from public.news where btrim(coalesce(title, '')) = '';

-- news: чиним неизвестные типы
update public.news set type = 'news' where type is null or type not in ('news', 'patch', 'soon');

-- ecosystem_sites: резервная копия и удаление сайтов с неверным ID (история действий таких сайтов удалится каскадом)
insert into public._cleanup_backup_sites
  select * from public.ecosystem_sites where id is null or id !~ '^[a-z0-9][a-z0-9_-]{1,31}$';
delete from public.ecosystem_sites where id is null or id !~ '^[a-z0-9][a-z0-9_-]{1,31}$';

-- ecosystem_sites: пустое название → ID
update public.ecosystem_sites set name = id where btrim(coalesce(name, '')) = '';

commit;

-- Итог:
select (select count(*) from public.news)            as news_left,
       (select count(*) from public.ecosystem_sites) as sites_left,
       (select count(*) from public._cleanup_backup_news)  as news_backed_up,
       (select count(*) from public._cleanup_backup_sites) as sites_backed_up;
