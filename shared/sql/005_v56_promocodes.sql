-- 005_v56_promocodes.sql — amoore v5.6: промокоды и кастомные названия рангов. Идемпотентна, без DROP таблиц с данными.
-- Порядок: 001 → 002 → 003 → 004 → 005.

create table if not exists public.promocodes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  points      int  not null check (points > 0),
  max_uses    int  check (max_uses is null or max_uses > 0),   -- null = без лимита активаций
  uses        int  not null default 0,
  expires_at  timestamptz,                                      -- null = бессрочно
  active      boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists promocodes_code_uq on public.promocodes (upper(code));

create table if not exists public.promocode_activations (
  id          uuid primary key default gen_random_uuid(),
  promo_id    uuid not null references public.promocodes(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  points      int  not null,
  source      text not null default 'site',
  created_at  timestamptz not null default now(),
  unique (promo_id, user_id)                                    -- защита от повторного использования одним юзером
);

alter table public.promocodes            enable row level security;
alter table public.promocode_activations enable row level security;
revoke all on public.promocodes, public.promocode_activations from anon, authenticated;
grant all on public.promocodes, public.promocode_activations to service_role;
drop policy if exists promocodes_service on public.promocodes;
create policy promocodes_service on public.promocodes for all to service_role using (true) with check (true);
drop policy if exists promo_act_service on public.promocode_activations;
create policy promo_act_service on public.promocode_activations for all to service_role using (true) with check (true);

-- внутреннее погашение (общее для сайта и бота)
create or replace function public._promo_apply(p_user uuid, p_code text, p_source text)
returns int language plpgsql security definer set search_path = public as $$
declare pc public.promocodes; pts int;
begin
  select * into pc from public.promocodes where upper(code) = upper(trim(p_code)) for update;
  if not found or not pc.active then raise exception 'Промокод не найден'; end if;
  if pc.expires_at is not null and pc.expires_at < now() then raise exception 'Срок действия промокода истёк'; end if;
  if pc.max_uses is not null and pc.uses >= pc.max_uses then raise exception 'Лимит активаций исчерпан'; end if;
  begin
    insert into public.promocode_activations (promo_id, user_id, points, source) values (pc.id, p_user, pc.points, p_source);
  exception when unique_violation then raise exception 'Вы уже активировали этот промокод'; end;
  update public.promocodes set uses = uses + 1 where id = pc.id;
  update public.profiles set rewards_balance = rewards_balance + pc.points where id = p_user;
  insert into public.rewards_log (user_id, delta, reason) values (p_user, pc.points, 'promocode');
  return pc.points;
end $$;
revoke all on function public._promo_apply(uuid, text, text) from public, anon, authenticated;
grant execute on function public._promo_apply(uuid, text, text) to service_role;

-- сайт: активирует вошедший пользователь
create or replace function public.redeem_promocode(p_code text)
returns int language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  return public._promo_apply(auth.uid(), p_code, 'site');
end $$;
revoke all on function public.redeem_promocode(text) from public, anon;
grant execute on function public.redeem_promocode(text) to authenticated;

-- бот (service_role): по telegram_id привязанного профиля
create or replace function public.redeem_promocode_tg(p_telegram_id bigint, p_code text)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from public.profiles where telegram_id = p_telegram_id limit 1;
  if uid is null then raise exception 'Telegram не привязан к amoore ID (команда /link)'; end if;
  return public._promo_apply(uid, p_code, 'bot');
end $$;
revoke all on function public.redeem_promocode_tg(bigint, text) from public, anon, authenticated;
grant execute on function public.redeem_promocode_tg(bigint, text) to service_role;

-- админка: создание кода. Основатель — любой номинал; остальные админы — до 100.
create or replace function public.admin_create_promocode(p_code text, p_points int, p_max_uses int, p_expires timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare me public.profiles; nid uuid; c text := upper(trim(p_code));
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role not in ('super_admin','admin') then raise exception 'Недостаточно прав'; end if;
  if c !~ '^[A-Z0-9_-]{3,32}$' then raise exception 'Код: 3–32 символа, латиница, цифры, - и _'; end if;
  if p_points is null or p_points < 1 then raise exception 'Номинал должен быть больше нуля'; end if;
  if me.role <> 'super_admin' and p_points > 100 then raise exception 'Админ может создавать коды до 100 баллов'; end if;
  insert into public.promocodes (code, points, max_uses, expires_at, created_by) values (c, p_points, p_max_uses, p_expires, me.id) returning id into nid;
  return nid;
exception when unique_violation then raise exception 'Такой промокод уже существует';
end $$;
revoke all on function public.admin_create_promocode(text, int, int, timestamptz) from public, anon;
grant execute on function public.admin_create_promocode(text, int, int, timestamptz) to authenticated;

create or replace function public.admin_list_promocodes()
returns setof public.promocodes language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('super_admin','admin')) then raise exception 'Недостаточно прав'; end if;
  return query select * from public.promocodes order by created_at desc limit 200;
end $$;
revoke all on function public.admin_list_promocodes() from public, anon;
grant execute on function public.admin_list_promocodes() to authenticated;

create or replace function public.admin_toggle_promocode(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role in ('super_admin','admin')) then raise exception 'Недостаточно прав'; end if;
  update public.promocodes set active = p_active where id = p_id;
end $$;
revoke all on function public.admin_toggle_promocode(uuid, boolean) from public, anon;
grant execute on function public.admin_toggle_promocode(uuid, boolean) to authenticated;

