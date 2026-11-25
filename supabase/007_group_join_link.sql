-- 2026-11-07 사용자 승인으로 실행(SQL Editor). 기본값: 정원 50명, 링크 30일(최대 90일), 제외된 사람은 공용 링크 재가입 불가.
-- 모이딱 007: 모임방 공용 초대 링크(여러 사람이 쓰는 링크)로 '참여하기'를 눌러 스스로 가입
-- 001~006 을 실행한 DB 에 SQL Editor 로 통째로 실행한다. 여러 번 실행해도 안전하다(추가만, 기존 표·행·함수 변경 없음).
--
-- 설계 원칙
--   · 기존 '멤버별 개인 초대 토큰'(private.group_invites)·약속 개인 초대·주최자 토큰은 그대로. 공용 링크는 별도 표·별도 함수.
--   · 공용 링크로는 '새 멤버 행'만 만든다. 기존 멤버 행에 연결(claim)하지 않는다 — 같은 닉네임이어도 다른 사람일 수 있으므로.
--     기존 멤버 행 연결은 지금처럼 그 멤버의 개인 초대 토큰으로만 된다.
--   · 링크를 열기만 해서는 가입되지 않는다. 미리보기(preview)는 이름·테마·링크 상태만 주고, 가입은 join 함수를 눌러야 한다.
--   · 가입은 한 트랜잭션: 링크 행 잠금 → 모임방 잠금 → 검사 → 멤버 insert. (group_id, user_id) 활성 유일 인덱스(004)로 중복 멤버 불가.
--   · 가입해도 기존·과거 약속 참여자/응답은 생기지 않는다(약속 참여자는 약속 만들 때 고른 멤버만).
--   · 관리자만 링크 발급·회전·폐기·상태 조회. 링크 원문은 발급 응답에서 한 번만 주고 DB 에는 해시만 저장한다.
--   · 속도 제한: 사용자(익명 계정 포함)별 최근 10분 미리보기·가입 실패 횟수로 제한(DB 안에서 검사, 화면 버튼 비활성화에 의존하지 않음).

-- ───────────────────────── 표 ─────────────────────────

create table if not exists private.group_join_links (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count integer not null default 0,
  max_uses integer check (max_uses is null or max_uses between 1 and 200),
  created_at timestamptz not null default now()
);
-- 모임방마다 살아 있는 공용 링크는 하나(회전하면 이전 링크는 폐기)
create unique index if not exists group_join_links_one_active on private.group_join_links (group_id) where revoked_at is null;
revoke all on table private.group_join_links from public, anon, authenticated;

-- 실패 기록(속도 제한용). 토큰 원문·IP·기기 정보는 저장하지 않는다.
create table if not exists private.group_join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists group_join_attempts_user_time on private.group_join_attempts (user_id, created_at desc);
revoke all on table private.group_join_attempts from public, anon, authenticated;

-- 모임방 정원(활성 멤버). 기존 생성 함수 상한(30)보다 넉넉하게.
create or replace function private.group_capacity() returns integer language sql immutable set search_path = '' as $$ select 50 $$;

-- 최근 10분 실패 20회 이상이면 잠시 막는다. 실패 기록은 하루 지나면 지운다(개인정보 최소화).
create or replace function private.join_rate_check(p_uid uuid)
returns void language plpgsql volatile set search_path = '' as $$
begin
  delete from private.group_join_attempts where created_at < now() - interval '1 day';
  if (select count(*) from private.group_join_attempts where user_id = p_uid and not ok and created_at > now() - interval '10 minutes') >= 20 then
    raise exception '시도가 너무 많아요. 10분 뒤에 다시 해 주세요.' using errcode = 'P0429';
  end if;
end $$;
create or replace function private.join_fail(p_uid uuid)
returns void language sql volatile set search_path = '' as $$
  insert into private.group_join_attempts (user_id, ok) values (p_uid, false);
$$;
revoke all on function private.group_capacity(), private.join_rate_check(uuid), private.join_fail(uuid) from public, anon, authenticated;

-- ───────────────────────── 관리자 RPC ─────────────────────────

-- 공용 링크 만들기/회전: 이전 공용 링크는 폐기(이미 가입한 멤버·개인 링크는 그대로). 원문은 이 응답에서만.
create or replace function public.create_group_join_link(p_group_id uuid, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype;
  v_token text := private.new_token();
  v_exp timestamptz;
begin
  v_g := private.lock_group(p_group_id);
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 초대 링크를 만들 수 있어요.'; end if;
  if v_g.archived_at is not null then raise exception '종료된 모임방이에요.'; end if;
  v_exp := now() + make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90));
  update private.group_join_links set revoked_at = now() where group_id = p_group_id and revoked_at is null;
  insert into private.group_join_links (group_id, token_hash, created_by, expires_at) values (p_group_id, private.hash_token(v_token), v_uid, v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public.revoke_group_join_link(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_g public.groups%rowtype;
begin
  perform private.require_uid();
  v_g := private.lock_group(p_group_id);
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 초대 링크를 끌 수 있어요.'; end if;
  update private.group_join_links set revoked_at = now() where group_id = p_group_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 상태(원문 없음): 관리자만
create or replace function public.group_join_link_status(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l private.group_join_links%rowtype;
begin
  perform private.require_uid();
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 볼 수 있어요.'; end if;
  select * into l from private.group_join_links where group_id = p_group_id and revoked_at is null;
  if not found then return jsonb_build_object('state', 'none'); end if;
  return jsonb_build_object('state', case when l.expires_at < now() then 'expired' else 'active' end,
    'created_at', l.created_at, 'expires_at', l.expires_at, 'use_count', l.use_count);
end $$;

-- ───────────────────────── 받는 사람 RPC ─────────────────────────

-- 가입 전 미리보기: 모임방 이름·테마·링크 상태·내가 이미 멤버인지. 멤버 목록·설명·약속·토큰은 주지 않는다.
create or replace function public.preview_group_join_link(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  l private.group_join_links%rowtype;
  g public.groups%rowtype;
begin
  perform private.join_rate_check(v_uid);
  select * into l from private.group_join_links where token_hash = private.hash_token(p_token);
  if not found then perform private.join_fail(v_uid); return jsonb_build_object('state', 'invalid'); end if;
  select * into g from public.groups where id = l.group_id;
  if exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid and m.removed_at is null) then
    return jsonb_build_object('state', 'member', 'group_id', g.id, 'name', g.name, 'theme', g.theme);
  end if;
  return jsonb_build_object('name', g.name, 'theme', g.theme, 'state',
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at < now() then 'expired'
         when g.archived_at is not null then 'archived'
         when (select count(*) from public.group_members m where m.group_id = g.id and m.removed_at is null) >= private.group_capacity() then 'full'
         else 'ok' end);
end $$;

-- 참여하기: 새 멤버 행 1개(이미 멤버면 그대로 반환). 이름은 모임방 안에서 겹치면 다시 받는다.
create or replace function public.join_group_with_link(p_token text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  l private.group_join_links%rowtype;
  g public.groups%rowtype;
  v_mid uuid;
begin
  perform private.join_rate_check(v_uid);
  select * into l from private.group_join_links where token_hash = private.hash_token(p_token) for update;
  -- 잘못된 토큰은 오류로 끝내면 실패 기록까지 되돌려지므로(트랜잭션) 상태로 돌려준다
  if not found then perform private.join_fail(v_uid); return jsonb_build_object('state', 'invalid'); end if;
  g := private.lock_group(l.group_id);              -- 같은 모임방 가입·회전·멤버 변경을 줄 세운다

  select m.id into v_mid from public.group_members m where m.group_id = g.id and m.user_id = v_uid and m.removed_at is null;
  if found then return jsonb_build_object('group_id', g.id, 'member_id', v_mid, 'already', true); end if;

  if l.revoked_at is not null then raise exception '이 초대 링크는 새 링크로 바뀌었어요. 관리자에게 새 링크를 받아 주세요.'; end if;
  if l.expires_at < now() then raise exception '초대 링크가 만료됐어요. 관리자에게 새 링크를 받아 주세요.'; end if;
  if g.archived_at is not null then raise exception '종료된 모임방이에요.'; end if;
  if l.max_uses is not null and l.use_count >= l.max_uses then raise exception '이 링크로 들어올 수 있는 인원이 다 찼어요.'; end if;
  if (select count(*) from public.group_members m where m.group_id = g.id and m.removed_at is null) >= private.group_capacity() then
    raise exception '모임방 정원이 다 찼어요.';
  end if;
  -- 관리자가 제외한 사람은 공용 링크로 스스로 다시 들어올 수 없다(관리자가 다시 추가하고 개인 링크를 보내야 함)
  if exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid and m.removed_at is not null) then
    raise exception '이 모임방에서 빠진 기기예요. 관리자에게 다시 초대해 달라고 해 주세요.';
  end if;
  if char_length(v_name) not between 1 and 20 then raise exception '모임방에서 쓸 이름을 1~20자로 적어 주세요.'; end if;
  if exists (select 1 from public.group_members m where m.group_id = g.id and m.removed_at is null and lower(m.display_name) = lower(v_name)) then
    raise exception '모임방에 같은 이름이 있어요. 다른 이름으로 적어 주세요.';
  end if;

  insert into public.group_members (group_id, display_name, sort_order, role, user_id)
    values (g.id, v_name, coalesce((select max(sort_order) from public.group_members where group_id = g.id), 0) + 1, 'member', v_uid)
    returning id into v_mid;
  update private.group_join_links set use_count = use_count + 1 where id = l.id;
  return jsonb_build_object('group_id', g.id, 'member_id', v_mid, 'already', false);
exception when unique_violation then
  -- 같은 기기의 동시 요청: 다른 요청이 먼저 가입시켰다면 그 멤버를 돌려준다
  select m.id into v_mid from public.group_members m where m.group_id = l.group_id and m.user_id = v_uid and m.removed_at is null;
  if v_mid is not null then return jsonb_build_object('group_id', l.group_id, 'member_id', v_mid, 'already', true); end if;
  raise exception '모임방에 같은 이름이 있어요. 다른 이름으로 적어 주세요.';
end $$;

-- ───────────────────────── 실행 권한 ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_group_join_link(uuid, integer)',
    'public.revoke_group_join_link(uuid)',
    'public.group_join_link_status(uuid)',
    'public.preview_group_join_link(text)',
    'public.join_group_with_link(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 되돌리기(사용자 데이터 삭제 없음): 공용 링크 기능만 끈다. 이미 가입한 멤버 행은 일반 멤버로 그대로 남는다.
--   drop function if exists public.join_group_with_link(text, text), public.preview_group_join_link(text),
--     public.group_join_link_status(uuid), public.revoke_group_join_link(uuid), public.create_group_join_link(uuid, integer);
--   (링크 표는 남겨 두거나, 필요하면 update private.group_join_links set revoked_at = now() where revoked_at is null; 로 모두 폐기)
