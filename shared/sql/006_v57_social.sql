-- 006_v57_social.sql — amoore v5.7 «SOCIAL»: обложка, приватность, подписки, поиск людей, тег заявок «Проблема с доступом».
-- Идемпотентна, без DROP таблиц с данными. Порядок: 001 → … → 005 → 006.

alter table public.profiles add column if not exists banner_url    text;
alter table public.profiles add column if not exists show_telegram boolean not null default false;
alter table public.profiles add column if not exists show_points   boolean not null default false;
alter table public.leads    add column if not exists tags text[] not null default '{}';

-- клиент может менять только свои безопасные поля (роль/бан/баланс закрыты триггером и грантами)
grant update (banner_url, show_telegram, show_points) on public.profiles to authenticated;

-- обложки: та же корзина avatars, папка = uid (политики корзины уже заданы в 001)

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;
grant all on public.follows to service_role;
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select to authenticated using (follower_id = auth.uid());
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- публичная страница: баллы и Telegram — только если владелец разрешил
create or replace function public.public_profile(p_username text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'username', p.username, 'display_name', p.display_name, 'avatar_url', nullif(p.avatar_url, ''), 'avatar_color', p.avatar_color,
    'banner_url', nullif(p.banner_url, ''),
    'bio', p.bio, 'role', p.role, 'created_at', p.created_at,
    'points', case when p.show_points then p.rewards_balance else null end,
    'telegram_id', case when p.show_telegram and p.telegram_id is not null then p.telegram_id else null end,
    'followers', (select count(*) from public.follows f where f.followee_id = p.id),
    'is_following', exists (select 1 from public.follows f where f.followee_id = p.id and f.follower_id = auth.uid()),
    'is_me', p.id = auth.uid(),
    'sites', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url) order by s.created_at desc)
                         from public.user_sites s where s.user_id = p.id and s.is_public), '[]'::jsonb))
  from public.profiles p
  where lower(p.username) = lower(coalesce(p_username, '')) and p.is_public and not p.is_banned and p.onboarded
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

-- поиск людей (только открытые профили)
create or replace function public.search_profiles(p_q text)
returns table (username text, display_name text, avatar_url text, avatar_color text)
language sql stable security definer set search_path = public as $$
  select p.username, p.display_name, nullif(p.avatar_url, ''), p.avatar_color
  from public.profiles p
  where length(trim(coalesce(p_q, ''))) >= 2 and p.is_public and not p.is_banned and p.onboarded and p.username is not null
    and (p.username ilike replace(replace(trim(p_q), '%', ''), '_', '\_') || '%' or p.display_name ilike '%' || replace(replace(trim(p_q), '%', ''), '_', '\_') || '%')
  order by (lower(p.username) = lower(trim(p_q))) desc, p.username limit 12
$$;
grant execute on function public.search_profiles(text) to anon, authenticated;

create or replace function public.follow_user(p_username text, p_follow boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
  select id into t from public.profiles where lower(username) = lower(p_username) and is_public and not is_banned;
  if t is null then raise exception 'Профиль не найден'; end if;
  if t = auth.uid() then raise exception 'Нельзя подписаться на себя'; end if;
  if p_follow then insert into public.follows (follower_id, followee_id) values (auth.uid(), t) on conflict do nothing;
  else delete from public.follows where follower_id = auth.uid() and followee_id = t; end if;
end $$;
revoke all on function public.follow_user(text, boolean) from public, anon;
grant execute on function public.follow_user(text, boolean) to authenticated;

create or replace function public.my_following()
returns table (username text, display_name text, avatar_url text, avatar_color text)
language sql stable security definer set search_path = public as $$
  select p.username, p.display_name, nullif(p.avatar_url, ''), p.avatar_color
  from public.follows f join public.profiles p on p.id = f.followee_id
  where f.follower_id = auth.uid() and p.is_public and not p.is_banned order by f.created_at desc
$$;
revoke all on function public.my_following() from public, anon;
grant execute on function public.my_following() to authenticated;
