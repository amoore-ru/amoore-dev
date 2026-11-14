-- 007_v571_global_polish.sql — amoore v5.7.1 «GLOBAL POLISH». Идемпотентна, без DROP таблиц с данными.
-- Порядок: 001 → 002 → 003 → 004 → 005 → 006 → 007. Выполнить целиком в Supabase → SQL Editor → Run.
--
-- Что внутри:
--   1) КРИТИЧЕСКИЙ ФИКС промокодов. Причина ошибки «Недостаточно прав»: при активации RPC увеличивал profiles.rewards_balance,
--      а триггер profiles_guard запрещает вошедшему пользователю менять баланс («forbidden: protected profile fields»),
--      если не выставлен флаг amoore.bypass. Теперь погашение идёт через activate_promocode (security definer + флаг bypass).
--   2) Потолок номинала 100 баллов для всех, кроме Основателя (super_admin) — проверка в БД (триггер + RPC).
--   3) Редактирование/удаление промокодов из админки.
--   4) «Режим Бога» (только Основатель): начислить/списать баллы, правка никнейма и username, текстовый бейдж ранга.
--   5) Telegram @username: колонка profiles.telegram_username, заполняется при привязке (/link).
--   6) Автогенерация username для старых пользователей, у кого его ещё нет (ссылка /u/username).
--   7) public_profile отдаёт rank_label и telegram_username (последний — только если включено «Показывать Telegram»).

-- ============================== 0. колонки ==============================
alter table public.profiles      add column if not exists telegram_username text;
alter table public.profiles      add column if not exists rank_label        text;
alter table public.tg_link_codes add column if not exists telegram_username text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_rank_label_len') then
    alter table public.profiles add constraint profiles_rank_label_len check (rank_label is null or char_length(rank_label) <= 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_tg_username_fmt') then
    alter table public.profiles add constraint profiles_tg_username_fmt check (telegram_username is null or telegram_username ~ '^[A-Za-z0-9_]{4,32}$');
  end if;
end $$;

-- ============================== 1. промокоды: фикс RLS/guard ==============================
-- Внутреннее погашение (общее для сайта и бота). ГЛАВНОЕ ИСПРАВЛЕНИЕ — флаг amoore.bypass перед начислением.
create or replace function public._promo_apply(p_user uuid, p_code text, p_source text)
returns int language plpgsql security definer set search_path = public as $$
declare pc public.promocodes;
begin
  select * into pc from public.promocodes where upper(code) = upper(trim(p_code)) for update;
  if not found or not pc.active then raise exception 'Промокод не найден'; end if;
  if pc.expires_at is not null and pc.expires_at < now() then raise exception 'Срок действия промокода истёк'; end if;
  if pc.max_uses is not null and pc.uses >= pc.max_uses then raise exception 'Лимит активаций исчерпан'; end if;
  begin
    insert into public.promocode_activations (promo_id, user_id, points, source) values (pc.id, p_user, pc.points, p_source);
  exception when unique_violation then raise exception 'Вы уже активировали этот промокод'; end;
  update public.promocodes set uses = uses + 1 where id = pc.id;
  perform set_config('amoore.bypass', '1', true);                    -- баланс защищён триггером profiles_guard
  update public.profiles set rewards_balance = rewards_balance + pc.points where id = p_user;
  perform set_config('amoore.bypass', '0', true);
  insert into public.rewards_log (user_id, delta, reason) values (p_user, pc.points, 'promocode');
  return pc.points;
end $$;
revoke all on function public._promo_apply(uuid, text, text) from public, anon, authenticated;
grant execute on function public._promo_apply(uuid, text, text) to service_role;

-- Сайт: активирует вошедший пользователь. Возвращает {ok, points, balance}.
create or replace function public.activate_promocode(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pts int; bal int;
begin
  if uid is null then raise exception 'Войдите в аккаунт'; end if;
  if exists (select 1 from public.profiles where id = uid and is_banned) then raise exception 'Аккаунт заблокирован'; end if;
  if char_length(trim(coalesce(p_code, ''))) not between 3 and 32 then raise exception 'Промокод не найден'; end if;
  pts := public._promo_apply(uid, p_code, 'site');
  select rewards_balance into bal from public.profiles where id = uid;
  return jsonb_build_object('ok', true, 'points', pts, 'balance', bal);
end $$;
revoke all on function public.activate_promocode(text) from public, anon;
grant execute on function public.activate_promocode(text) to authenticated;

-- Совместимость: закэшированные клиенты v5.6/v5.7 зовут redeem_promocode (возвращает число баллов).
create or replace function public.redeem_promocode(p_code text)
returns int language plpgsql security definer set search_path = public as $$
begin
  return (public.activate_promocode(p_code) ->> 'points')::int;
end $$;
revoke all on function public.redeem_promocode(text) from public, anon;
grant execute on function public.redeem_promocode(text) to authenticated;

-- ============================== 2. потолок номинала: не Основатель — максимум 100 ==============================
create or replace function public.trg_promocodes_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and new.points > 100
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin') then
    raise exception 'Админ может создавать коды до 100 баллов';
  end if;
  return new;
end $$;
drop trigger if exists promocodes_cap on public.promocodes;
create trigger promocodes_cap before insert or update of points on public.promocodes
  for each row execute function public.trg_promocodes_cap();

-- ============================== 3. промокоды в админке: редактировать / удалить ==============================
create or replace function public.admin_update_promocode(p_id uuid, p_points int, p_max_uses int, p_expires timestamptz, p_active boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; pc public.promocodes;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role not in ('super_admin','admin') then raise exception 'Недостаточно прав'; end if;
  select * into pc from public.promocodes where id = p_id for update;
  if not found then raise exception 'Промокод не найден'; end if;
  if p_points is null or p_points < 1 then raise exception 'Номинал должен быть больше нуля'; end if;
  if me.role <> 'super_admin' and p_points > 100 then raise exception 'Админ может создавать коды до 100 баллов'; end if;
  if p_max_uses is not null and p_max_uses < 1 then raise exception 'Лимит должен быть больше нуля'; end if;
  if p_max_uses is not null and p_max_uses < pc.uses then raise exception 'Лимит не может быть меньше числа уже сделанных активаций (%)', pc.uses; end if;
  update public.promocodes
     set points = p_points, max_uses = p_max_uses, expires_at = p_expires, active = coalesce(p_active, active)
   where id = p_id;
end $$;
revoke all on function public.admin_update_promocode(uuid, int, int, timestamptz, boolean) from public, anon;
grant execute on function public.admin_update_promocode(uuid, int, int, timestamptz, boolean) to authenticated;

create or replace function public.admin_delete_promocode(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('super_admin','admin')) then raise exception 'Недостаточно прав'; end if;
  delete from public.promocodes where id = p_id;      -- журнал активаций удаляется каскадом; уже начисленные баллы остаются у пользователей
end $$;
revoke all on function public.admin_delete_promocode(uuid) from public, anon;
grant execute on function public.admin_delete_promocode(uuid) to authenticated;

-- ============================== 4. «Режим Бога» (только Основатель = super_admin) ==============================
create or replace function public._require_owner()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin' and not is_banned) then
    raise exception 'Недостаточно прав';
  end if;
end $$;
revoke all on function public._require_owner() from public, anon;
grant execute on function public._require_owner() to authenticated;

-- данные профиля для панели (id и баланс в публичном профиле не отдаются, поэтому отдельная функция)
create or replace function public.admin_profile_info(p_username text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform public._require_owner();
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'rewards_balance', p.rewards_balance,
                            'role', p.role, 'rank_label', p.rank_label)
    into r from public.profiles p where lower(p.username) = lower(coalesce(p_username, ''));
  if r is null then raise exception 'Профиль не найден'; end if;
  return r;
end $$;
revoke all on function public.admin_profile_info(text) from public, anon;
grant execute on function public.admin_profile_info(text) to authenticated;

-- начислить (+) / списать (−) баллы; возвращает новый баланс
create or replace function public.admin_adjust_points(p_user uuid, p_delta int, p_reason text default null)
returns int language plpgsql security definer set search_path = public as $$
declare bal int;
begin
  perform public._require_owner();
  if p_delta is null or p_delta = 0 then raise exception 'Укажите сумму, отличную от нуля'; end if;
  if abs(p_delta) > 1000000 then raise exception 'Слишком большая сумма'; end if;
  select rewards_balance into bal from public.profiles where id = p_user for update;
  if not found then raise exception 'Профиль не найден'; end if;
  if bal + p_delta < 0 then raise exception 'Баланс не может стать отрицательным (сейчас %)', bal; end if;
  perform set_config('amoore.bypass', '1', true);
  update public.profiles set rewards_balance = rewards_balance + p_delta where id = p_user returning rewards_balance into bal;
  perform set_config('amoore.bypass', '0', true);
  insert into public.rewards_log (user_id, delta, reason) values (p_user, p_delta, left('admin: ' || coalesce(nullif(trim(p_reason), ''), 'корректировка'), 80));
  insert into public.notifications (user_id, kind, title, body, link)
    values (p_user, 'reward', 'amoore rewards', case when p_delta > 0 then '+' || p_delta || ' баллов от администрации' else p_delta || ' баллов: корректировка от администрации' end, '#profile');
  return bal;
end $$;
revoke all on function public.admin_adjust_points(uuid, int, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, int, text) to authenticated;

-- правка никнейма и username напрямую
create or replace function public.admin_edit_profile(p_user uuid, p_display_name text, p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u text := lower(trim(coalesce(p_username, ''))); d text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  perform public._require_owner();
  if u !~ '^[a-z0-9_]{3,24}$' then raise exception 'Username: 3–24 символа, латиница, цифры и _'; end if;
  if d is not null and char_length(d) > 40 then raise exception 'Никнейм слишком длинный (до 40 символов)'; end if;
  if exists (select 1 from public.profiles where lower(username) = u and id <> p_user) then raise exception 'Этот username уже занят'; end if;
  update public.profiles set username = u, display_name = d where id = p_user;
  if not found then raise exception 'Профиль не найден'; end if;
  return jsonb_build_object('username', u, 'display_name', d);
end $$;
revoke all on function public.admin_edit_profile(uuid, text, text) from public, anon;
grant execute on function public.admin_edit_profile(uuid, text, text) to authenticated;

-- текстовый бейдж ранга («Админ» → «Ангел»); системная роль (profiles.role) и права НЕ меняются. Пустая строка = сбросить
create or replace function public.admin_set_rank_label(p_user uuid, p_label text)
returns text language plpgsql security definer set search_path = public as $$
declare l text := nullif(trim(coalesce(p_label, '')), '');
begin
  perform public._require_owner();
  if l is not null and char_length(l) > 24 then raise exception 'Бейдж ранга: до 24 символов'; end if;
  update public.profiles set rank_label = l where id = p_user;
  if not found then raise exception 'Профиль не найден'; end if;
  return l;
end $$;
revoke all on function public.admin_set_rank_label(uuid, text) from public, anon;
grant execute on function public.admin_set_rank_label(uuid, text) to authenticated;

-- ============================== 5. Telegram @username ==============================
-- При привязке (profiles.telegram_id меняется в claim_telegram_code) подтягиваем username из кода, который выдал бот.
create or replace function public.trg_profiles_tg_username()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.telegram_id is not null and new.telegram_id is distinct from old.telegram_id then
    select c.telegram_username into new.telegram_username
      from public.tg_link_codes c
     where c.telegram_id = new.telegram_id and c.telegram_username is not null
     order by c.created_at desc limit 1;
  elsif new.telegram_id is null then
    new.telegram_username := null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_tg_username on public.profiles;
create trigger profiles_tg_username before update of telegram_id on public.profiles
  for each row execute function public.trg_profiles_tg_username();

-- бот (service_role): обновить username уже привязанного Telegram (например, человек сменил его)
create or replace function public.bot_sync_tg_username(p_telegram_id bigint, p_username text)
returns void language plpgsql security definer set search_path = public as $$
declare u text := nullif(trim(coalesce(p_username, '')), '');
begin
  if u is not null and u !~ '^[A-Za-z0-9_]{4,32}$' then u := null; end if;
  update public.profiles set telegram_username = u where telegram_id = p_telegram_id and telegram_username is distinct from u;
end $$;
revoke all on function public.bot_sync_tg_username(bigint, text) from public, anon, authenticated;
grant execute on function public.bot_sync_tg_username(bigint, text) to service_role;

-- ============================== 6. автогенерация username (ссылка /u/username) ==============================
create or replace function public.gen_username(p_base text)
returns text language plpgsql security definer set search_path = public as $$
declare b text := lower(regexp_replace(coalesce(p_base, ''), '[^a-zA-Z0-9_]', '', 'g')); cand text; i int := 0;
begin
  if char_length(b) < 3 then b := 'user' || b; end if;
  b := left(b, 18); cand := b;
  while exists (select 1 from public.profiles where lower(username) = cand) loop
    i := i + 1;
    cand := left(b, 18) || substr(md5(random()::text || clock_timestamp()::text || i::text), 1, 5);
    exit when i > 30;
  end loop;
  return cand;
end $$;
revoke all on function public.gen_username(text) from public, anon, authenticated;
grant execute on function public.gen_username(text) to service_role;

-- старым пользователям без username выдаём его один раз (по локальной части почты)
do $$
declare r record;
begin
  perform set_config('amoore.bypass', '1', true);
  for r in
    select p.id, coalesce(nullif(split_part(u.email, '@', 1), ''), p.display_name, 'user') as base
      from public.profiles p join auth.users u on u.id = p.id
     where coalesce(btrim(p.username), '') = ''
  loop
    update public.profiles set username = public.gen_username(r.base) where id = r.id;
  end loop;
  perform set_config('amoore.bypass', '0', true);
end $$;

-- ============================== 7. публичный профиль: rank_label + telegram_username ==============================
create or replace function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username, 'display_name', p.display_name, 'avatar_url', nullif(p.avatar_url, ''), 'avatar_color', p.avatar_color,
    'banner_url', nullif(p.banner_url, ''),
    'bio', p.bio, 'role', p.role, 'rank_label', p.rank_label, 'created_at', p.created_at,
    'points', case when p.show_points then p.rewards_balance else null end,
    'telegram_username', case when p.show_telegram and p.telegram_username is not null then p.telegram_username else null end,
    'followers', (select count(*) from public.follows f where f.followee_id = p.id),
    'is_following', exists (select 1 from public.follows f where f.followee_id = p.id and f.follower_id = auth.uid()),
    'is_me', p.id = auth.uid(),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url) order by s.created_at desc)
                         from public.user_sites s where s.user_id = p.id and s.is_public), '[]'::jsonb))
  from public.profiles p
  where lower(p.username) = lower(coalesce(p_username, '')) and p.is_public and not p.is_banned and p.onboarded
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- проверка после выполнения (необязательно):
--   select proname from pg_proc where proname in ('activate_promocode','admin_adjust_points','admin_edit_profile','admin_set_rank_label','admin_update_promocode','admin_delete_promocode');
--   select count(*) from public.profiles where coalesce(username,'') = '';   -- ожидается 0
