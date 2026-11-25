-- 모이딱 003: 내 정보(프로필)·캐릭터 선택
-- 001·002 를 실행한 DB 에 SQL Editor 로 통째로 실행한다. 여러 번 실행해도 안전하고, 기존 표·행·함수는 바꾸지 않는다(추가만).
--
-- 사용자 식별: 브라우저마다 생기는 Supabase 익명 계정(auth.uid()). 로그인·비밀번호·다른 기기 복구는 없다.
-- 저장 위치:
--   profiles(user_id)        — 사람(익명 계정) 단위: 내 닉네임, 내 캐릭터. 본인만 읽는다.
--   participants.avatar      — 모임 안에서 다른 사람에게 보이는 내 캐릭터. 내 프로필에서 복사한다(기존 RLS 그대로).
-- avatar 형식: {"v":1,"base":"mint|pink|blue|yellow"} — 나중에 hair·skin·face·top·bottom·accessory 키를 더한다.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) between 1 and 20),
  avatar jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
drop policy if exists profiles_own_read on public.profiles;
create policy profiles_own_read on public.profiles for select to authenticated using (user_id = (select auth.uid()));

alter table public.participants add column if not exists avatar jsonb;

-- 허용된 캐릭터 값만 통과시킨다(지금은 base 4종, 이후 파츠 키 확장).
create or replace function private.valid_avatar(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and char_length(p::text) <= 400
     and not exists (select 1 from jsonb_object_keys(p) k
                     where k not in ('v', 'base', 'hair', 'skin', 'face', 'top', 'bottom', 'accessory'))
     and (p ->> 'base') in ('mint', 'pink', 'blue', 'yellow')
     and not exists (select 1 from jsonb_each(p) e where e.key <> 'v' and jsonb_typeof(e.value) <> 'string')
     and not exists (select 1 from jsonb_each_text(p) e where e.key <> 'v' and e.value !~ '^[a-z0-9_]{1,30}$');
$$;

-- 내 프로필 조회(없으면 빈 값). 내가 속한 모임 수도 함께.
create or replace function public.get_my_profile()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_p public.profiles%rowtype;
begin
  select * into v_p from public.profiles where user_id = v_uid;
  return jsonb_build_object(
    'user_id', v_uid,
    'nickname', v_p.nickname,
    'avatar', coalesce(v_p.avatar, '{}'::jsonb),
    'updated_at', v_p.updated_at,
    'is_anonymous', coalesce((auth.jwt() ->> 'is_anonymous')::boolean, true)
  );
end $$;

-- 내 닉네임·캐릭터 저장. 내가 연결된 모든 모임의 참가자 행에도 캐릭터를 복사한다.
create or replace function public.save_my_profile(p_nickname text, p_avatar jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_nick text := nullif(btrim(coalesce(p_nickname, '')), '');
  v_n integer;
begin
  if v_nick is not null and char_length(v_nick) > 20 then raise exception '닉네임은 20자까지예요.'; end if;
  if p_avatar is not null and not private.valid_avatar(p_avatar) then raise exception '고를 수 없는 캐릭터 값이에요.'; end if;

  insert into public.profiles (user_id, nickname, avatar) values (v_uid, v_nick, coalesce(p_avatar, '{}'::jsonb))
  on conflict (user_id) do update
    set nickname = excluded.nickname,
        avatar = case when p_avatar is null then public.profiles.avatar else excluded.avatar end,
        updated_at = now();

  v_n := 0;
  if p_avatar is not null then
    update public.participants set avatar = p_avatar where user_id = v_uid;
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('saved', true, 'meetings_updated', v_n);
end $$;

-- 초대 수락·관리자 복구·새 링크 발급으로 참가자 연결이 바뀌면, 연결된 사람의 프로필 캐릭터를 따라가게 한다.
create or replace function private.sync_participant_avatar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then
    new.avatar := null;
  elsif tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
    select nullif(p.avatar, '{}'::jsonb) into new.avatar from public.profiles p where p.user_id = new.user_id;
  end if;
  return new;
end $$;
drop trigger if exists participants_avatar_sync on public.participants;
create trigger participants_avatar_sync before insert or update of user_id on public.participants
  for each row execute function private.sync_participant_avatar();

revoke all on function private.valid_avatar(jsonb), private.sync_participant_avatar() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.get_my_profile()', 'public.save_my_profile(text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
