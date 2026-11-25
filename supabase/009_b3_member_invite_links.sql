-- 2026-11-08 사용자 승인으로 실행(SQL Editor). 007 실행 후에만 의미가 있다. 여러 번 실행해도 안전.
-- 모이딱 009 (B3): 연결된 일반 멤버도 '내 이름으로' 공용 초대 링크를 만들고 공유. 관리자는 링크 확인·취소·전체 제한·정원 설정.
--
-- 정책(결정서 3장)
--   · 멤버가 만든 링크: 7일. 관리자가 만든 링크: 30일(지금과 같음). 모임방 정원 50명은 모든 링크 공통(groups.capacity).
--   · 사람마다 살아 있는 링크 1개(새로 만들면 내 이전 링크만 꺼짐). 다른 기기에서는 '새로 만들기'(원문은 저장하지 않음 → 복구처럼 보이지 않게).
--   · 관리자: 누가 만든 링크인지 목록(원문 없음), 개별 취소, 전체 취소, '멤버 링크 만들기 허용' 끄기, 정원 변경.
--   · 관리자가 뺀 사람은 공용 링크로 재가입 불가(유지). 스스로 나간 사람은 재가입 가능 — 서버가 removed_reason 으로 구분.
--     기존에 빠진 행(removed_reason 없음)은 '관리자 제외'로 본다(보수적).
--   · 익명 계정 한계: 다른 브라우저는 새 신원이라 차단을 완전히 막을 수 없음(화면에 안내).
-- 바뀌는 것(추가형): groups 칸 2개, group_members 칸 1개, group_join_links 칸 1개 + 유일 인덱스 교체(모임방당 1개 → 모임방·만든 사람당 1개),
--   함수 추가 6개, 007 함수 3개 교체(create_group_join_link·preview·join). 데이터 삭제 없음.
-- 되돌리기: 새 함수 drop + 007 함수 정의 재실행 + 인덱스 원복 전 'update private.group_join_links set revoked_at = now() where revoked_at is null and kind = ''member'''
--   (원복 인덱스가 모임방당 1개만 허용하므로). 추가한 칸은 남겨 둔다(자동 삭제 안 함).

alter table public.groups add column if not exists allow_member_invite boolean not null default true;
alter table public.groups add column if not exists capacity integer not null default 50 check (capacity between 1 and 200);
alter table public.group_members add column if not exists removed_reason text check (removed_reason is null or removed_reason in ('admin', 'self'));
alter table private.group_join_links add column if not exists kind text not null default 'admin' check (kind in ('admin', 'member'));

drop index if exists private.group_join_links_one_active;
create unique index if not exists group_join_links_one_active_per_creator
  on private.group_join_links (group_id, created_by) where revoked_at is null;

-- 내 링크 만들기(관리자 30일 / 멤버 7일). 내 이전 링크만 꺼진다. 원문은 이 응답에서만.
create or replace function public.create_my_join_link(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype;
  v_admin boolean;
  v_token text := private.new_token();
  v_exp timestamptz;
begin
  v_g := private.lock_group(p_group_id);
  if not private.is_group_member(p_group_id) then raise exception '이 모임방 멤버만 초대 링크를 만들 수 있어요.'; end if;
  if v_g.archived_at is not null then raise exception '종료된 모임방이에요.'; end if;
  v_admin := private.is_group_admin(p_group_id);
  if not v_admin and not v_g.allow_member_invite then raise exception '관리자가 멤버 초대를 꺼 두었어요. 관리자에게 부탁해 주세요.'; end if;
  v_exp := now() + case when v_admin then interval '30 days' else interval '7 days' end;
  update private.group_join_links set revoked_at = now() where group_id = p_group_id and created_by = v_uid and revoked_at is null;
  insert into private.group_join_links (group_id, token_hash, created_by, expires_at, kind)
    values (p_group_id, private.hash_token(v_token), v_uid, v_exp, case when v_admin then 'admin' else 'member' end);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp, 'kind', case when v_admin then 'admin' else 'member' end);
end $$;

create or replace function public.revoke_my_join_link(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid();
begin
  update private.group_join_links set revoked_at = now() where group_id = p_group_id and created_by = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 관리자: 살아 있는 링크 목록(원문·해시 없음, 만든 사람 이름·종류·만료·사용 수)
create or replace function public.list_group_join_links(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 볼 수 있어요.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'kind', l.kind, 'created_at', l.created_at, 'expires_at', l.expires_at, 'use_count', l.use_count,
      'state', case when l.expires_at < now() then 'expired' else 'active' end,
      'created_by_name', (select m.display_name from public.group_members m where m.group_id = l.group_id and m.user_id = l.created_by and m.removed_at is null)
    ) order by l.created_at desc) from private.group_join_links l where l.group_id = p_group_id and l.revoked_at is null), '[]'::jsonb);
end $$;

create or replace function public.revoke_group_join_link_by_id(p_link_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_gid uuid;
begin
  perform private.require_uid();
  select group_id into v_gid from private.group_join_links where id = p_link_id;
  if v_gid is null or not private.is_group_admin(v_gid) then raise exception '관리자만 링크를 취소할 수 있어요.'; end if;
  update private.group_join_links set revoked_at = now() where id = p_link_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 관리자: 멤버 초대 허용·정원 설정(정원은 현재 활성 멤버 수보다 작게 못 줄임)
create or replace function public.set_group_invite_policy(p_group_id uuid, p_allow_member boolean, p_capacity integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_g public.groups%rowtype; v_n integer;
begin
  perform private.require_uid();
  v_g := private.lock_group(p_group_id);
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 바꿀 수 있어요.'; end if;
  select count(*) into v_n from public.group_members where group_id = p_group_id and removed_at is null;
  if p_capacity is null or p_capacity not between greatest(1, v_n) and 200 then raise exception '정원은 지금 멤버 수(%명) 이상, 200명 이하로 정해 주세요.', v_n; end if;
  update public.groups set allow_member_invite = coalesce(p_allow_member, true), capacity = p_capacity, version = version + 1, updated_at = now() where id = p_group_id;
  if p_allow_member is false then
    update private.group_join_links set revoked_at = now() where group_id = p_group_id and kind = 'member' and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 스스로 나가기(마지막 관리자는 불가). 이후 공용 링크로 다시 들어올 수 있다.
create or replace function public.leave_group(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); v_m public.group_members%rowtype;
begin
  perform private.lock_group(p_group_id);
  select * into v_m from public.group_members where group_id = p_group_id and user_id = v_uid and removed_at is null;
  if not found then raise exception '이 모임방 멤버가 아니에요.'; end if;
  if v_m.role = 'admin' and (select count(*) from public.group_members where group_id = p_group_id and role = 'admin' and removed_at is null and user_id is not null) <= 1 then
    raise exception '마지막 관리자는 나갈 수 없어요. 다른 멤버를 관리자로 지정해 주세요.';
  end if;
  update public.group_members set removed_at = now(), removed_reason = 'self' where id = v_m.id;
  update private.group_join_links set revoked_at = now() where group_id = p_group_id and created_by = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 007 교체: 관리자 '새 링크' = 내 링크만 회전(멤버 링크는 그대로). 전체 취소는 revoke_group_join_link(007) 사용.
create or replace function public.create_group_join_link(p_group_id uuid, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 초대 링크를 만들 수 있어요.'; end if;
  return public.create_my_join_link(p_group_id);
end $$;

-- 007 교체: 상태는 '내가 만든 링크' 기준(사람마다 링크가 있을 수 있으므로). 관리자·멤버 모두 자기 링크 상태를 본다.
create or replace function public.group_join_link_status(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare l private.group_join_links%rowtype; g public.groups%rowtype;
begin
  perform private.require_uid();
  if not private.is_group_member(p_group_id) then raise exception '이 모임방 멤버만 볼 수 있어요.'; end if;
  select * into g from public.groups where id = p_group_id;
  select * into l from private.group_join_links where group_id = p_group_id and created_by = auth.uid() and revoked_at is null;
  if not found then
    return jsonb_build_object('state', 'none', 'is_admin', private.is_group_admin(p_group_id), 'allow_member_invite', g.allow_member_invite, 'capacity', g.capacity);
  end if;
  return jsonb_build_object('state', case when l.expires_at < now() then 'expired' else 'active' end, 'kind', l.kind,
    'created_at', l.created_at, 'expires_at', l.expires_at, 'use_count', l.use_count,
    'is_admin', private.is_group_admin(p_group_id), 'allow_member_invite', g.allow_member_invite, 'capacity', g.capacity);
end $$;

-- 007 교체: 정원은 groups.capacity, 멤버 링크는 '허용' 상태·만든 사람이 아직 멤버일 때만 유효
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
  return jsonb_build_object('name', g.name, 'theme', g.theme, 'description', g.description, 'state',
    case when l.revoked_at is not null then 'revoked'
         when l.expires_at < now() then 'expired'
         when g.archived_at is not null then 'archived'
         when l.kind = 'member' and (not g.allow_member_invite
              or not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = l.created_by and m.removed_at is null)) then 'revoked'
         when (select count(*) from public.group_members m where m.group_id = g.id and m.removed_at is null) >= g.capacity then 'full'
         else 'ok' end);
end $$;

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
  if not found then perform private.join_fail(v_uid); return jsonb_build_object('state', 'invalid'); end if;
  g := private.lock_group(l.group_id);
  select m.id into v_mid from public.group_members m where m.group_id = g.id and m.user_id = v_uid and m.removed_at is null;
  if found then return jsonb_build_object('group_id', g.id, 'member_id', v_mid, 'already', true); end if;
  if l.revoked_at is not null then raise exception '이 초대 링크는 취소됐어요. 새 링크를 받아 주세요.'; end if;
  if l.expires_at < now() then raise exception '초대 링크가 만료됐어요. 새 링크를 받아 주세요.'; end if;
  if g.archived_at is not null then raise exception '종료된 모임방이에요.'; end if;
  if l.kind = 'member' and (not g.allow_member_invite
     or not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = l.created_by and m.removed_at is null)) then
    raise exception '이 초대 링크는 더 이상 쓸 수 없어요. 새 링크를 받아 주세요.';
  end if;
  if (select count(*) from public.group_members m where m.group_id = g.id and m.removed_at is null) >= g.capacity then raise exception '모임방 정원이 다 찼어요.'; end if;
  if exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = v_uid and m.removed_at is not null
             and coalesce(m.removed_reason, 'admin') = 'admin') then
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
  select m.id into v_mid from public.group_members m where m.group_id = l.group_id and m.user_id = v_uid and m.removed_at is null;
  if v_mid is not null then return jsonb_build_object('group_id', l.group_id, 'member_id', v_mid, 'already', true); end if;
  raise exception '모임방에 같은 이름이 있어요. 다른 이름으로 적어 주세요.';
end $$;

-- 관리자가 멤버를 뺄 때 '관리자 제외'로 기록되도록 004 remove_group_member 뒤에 트리거로 보강(함수 교체 없이)
create or replace function private.group_members_removed_reason()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.removed_at is not null and old.removed_at is null and new.removed_reason is null then new.removed_reason := 'admin'; end if;
  return new;
end $$;
drop trigger if exists group_members_removed_reason on public.group_members;
create trigger group_members_removed_reason before update of removed_at on public.group_members
  for each row execute function private.group_members_removed_reason();

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_my_join_link(uuid)', 'public.revoke_my_join_link(uuid)', 'public.list_group_join_links(uuid)',
    'public.revoke_group_join_link_by_id(uuid)', 'public.set_group_invite_policy(uuid, boolean, integer)', 'public.leave_group(uuid)',
    'public.create_group_join_link(uuid, integer)', 'public.preview_group_join_link(text)', 'public.join_group_with_link(text, text)',
    'public.group_join_link_status(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function private.group_members_removed_reason() from public, anon, authenticated;

-- 검증(승인 후 tests/b3_member_links.mjs): 멤버 링크 7일·관리자 30일, 멤버 링크로 가입, 허용 끄면 멤버 링크 무효·관리자 링크 유효,
--   정원(capacity) 공통, 관리자 목록에 원문 없음, 개별·전체 취소, 관리자 제외자 재가입 거부·스스로 나간 사람 재가입 허용,
--   빠진 멤버가 만든 링크 무효, 다른 모임방 id 로 우회 불가, 기존 개인 초대·007 테스트 회귀.
