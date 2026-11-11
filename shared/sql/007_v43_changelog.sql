-- amoore v4.3 «POLISH» — миграция 007_v43_changelog (Supabase → SQL Editor → Run). Идемпотентна.
-- Добавляет запись v4.3.0 в changelog (global_settings + таблица changelog_versions), остальные версии сдвигаются вниз.
do $$
declare v jsonb;
begin
  select value into v from public.global_settings where key = 'changelog';
  if v is null or (v->'versions') @> '[{"version": "4.3.0"}]'::jsonb then return; end if;
  update public.global_settings set updated_at = now(), value = jsonb_build_object(
    'current', '4.3.0',
    'versions', jsonb_build_array(jsonb_build_object(
      'version', '4.3.0', 'date', '2026-11-12', 'title', 'POLISH', 'order', 0,
      'items', $i$["Внедрен единый стандарт интерфейса (шапка сайта).", "Заполнен блок «Экосистема» на Лендинге (добавлены ссылки на все продукты).", "Исправлен баг с вкладками новостей.", "Расширены и почищены Настройки в Админке (добавлен Drag & Drop и смена темы).", "Бот стал умнее: адаптивный мат, обход цензуры, реальный поиск.", "Проведена оптимизация кода и запросов к БД."]$i$::jsonb))
      || coalesce((select jsonb_agg(jsonb_set(x, '{order}', to_jsonb(coalesce((x->>'order')::int, 0) + 1)))
                     from jsonb_array_elements(v->'versions') x), '[]'::jsonb))
  where key = 'changelog';
end $$;

update public.changelog_versions set sort_order = sort_order + 1
 where not exists (select 1 from public.changelog_versions where version = '4.3.0');
insert into public.changelog_versions (version, title, released, items, sort_order)
values ('4.3.0', 'POLISH', '2026-11-12', $i$["Внедрен единый стандарт интерфейса (шапка сайта).", "Заполнен блок «Экосистема» на Лендинге (добавлены ссылки на все продукты).", "Исправлен баг с вкладками новостей.", "Расширены и почищены Настройки в Админке (добавлен Drag & Drop и смена темы).", "Бот стал умнее: адаптивный мат, обход цензуры, реальный поиск.", "Проведена оптимизация кода и запросов к БД."]$i$::jsonb, 0)
on conflict (version) do nothing;
