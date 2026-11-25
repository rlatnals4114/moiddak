-- 모이딱 004: 지속형 모임방(groups)·멤버(group_members)
-- 001~003 을 실행한 DB 에 SQL Editor 로 통째로 실행한다. 여러 번 실행해도 안전하다.
-- 원칙: 기존 표·행·함수·권한(private.is_member 포함)은 바꾸지 않는다. 표·칸·함수·트리거를 추가만 한다.
--   · 모임방 멤버(group_members) ≠ 약속 참여자(participants). 약속을 만들 때 고른 멤버만 참여자가 된다.
--   · 모임방 초대를 한 번 수락하면, 그 멤버가 포함된 약속의 참여자 행에도 자동으로 연결된다.
--   · 약속 상세(응답·장소)는 지금처럼 그 약속의 참여자·주최자만 읽는다. 모임방 멤버는 목록 정보(제목·상태·날짜)만.
--   · 기존 약속은 meetings.group_id = null(일회성 약속)로 그대로 동작한다.

-- ───────────────────────── 표 ─────────────────────────

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  description text check (description is null or char_length(description) <= 200),
  theme text not null default 'picnic' check (theme in ('picnic', 'beach', 'cafe', 'night')),
  created_by uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  user_id uuid references auth.users(id) on delete set null,
  role text not null default 'member' check (role in ('admin', 'member')),
  sort_order integer not null,
  avatar jsonb,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, id)
);
create unique index if not exists group_members_name_active
  on public.group_members (group_id, lower(display_name)) where removed_at is null;
create unique index if not exists group_members_user_active
  on public.group_members (group_id, user_id) where removed_at is null and user_id is not null;
create index if not exists group_members_user_idx on public.group_members (user_id);

create table if not exists private.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists group_invites_member_idx on private.group_invites (member_id);
revoke all on table private.group_invites from public, anon, authenticated;

-- 약속 ↔ 모임방, 참여자 ↔ 멤버 연결(둘 다 비어 있으면 기존 일회성 약속)
alter table public.meetings add column if not exists group_id uuid references public.groups(id) on delete set null;
create index if not exists meetings_group_idx on public.meetings (group_id);
alter table public.participants add column if not exists group_member_id uuid references public.group_members(id) on delete set null;
create index if not exists participants_group_member_idx on public.participants (group_member_id);

-- ───────────────────────── 읽기 권한 ─────────────────────────

create or replace function private.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m
                 where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.removed_at is null);
$$;
create or replace function private.is_group_admin(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m
                 where m.group_id = p_group_id and m.user_id = (select auth.uid()) and m.removed_at is null and m.role = 'admin');
$$;
revoke all on function private.is_group_member(uuid), private.is_group_admin(uuid) from public, anon;
grant execute on function private.is_group_member(uuid), private.is_group_admin(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['groups', 'group_members'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_group_member(%s))',
      t || '_member_read', t, case when t = 'groups' then 'id' else 'group_id' end);
  end loop;
end $$;

-- ───────────────────────── 트리거 ─────────────────────────

-- 멤버 연결이 바뀌면 프로필 캐릭터를 따라가게 하고, 그 멤버가 포함된 약속의 빈 참여자 자리도 연결한다.
create or replace function private.group_member_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then
    new.avatar := null;
  elsif tg_op = 'INSERT' or new.user_id is distinct from old.user_id then
    select nullif(p.avatar, '{}'::jsonb) into new.avatar from public.profiles p where p.user_id = new.user_id;
  end if;
  return new;
end $$;

create or replace function private.group_member_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is not null and new.removed_at is null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id) then
    update public.participants p set user_id = new.user_id
     where p.group_member_id = new.id and p.user_id is null
       and not exists (select 1 from public.participants q where q.meeting_id = p.meeting_id and q.user_id = new.user_id);
    -- 이렇게 연결된 참여자의 약속 초대 링크는 더 필요 없으므로 폐기
    update private.participant_invites i set revoked_at = now()
      from public.participants p
     where i.participant_id = p.id and p.group_member_id = new.id and p.user_id = new.user_id and i.revoked_at is null and i.consumed_at is null;
  end if;
  return null;
end $$;

drop trigger if exists group_members_before on public.group_members;
create trigger group_members_before before insert or update of user_id on public.group_members
  for each row execute function private.group_member_before();
drop trigger if exists group_members_after on public.group_members;
create trigger group_members_after after insert or update of user_id on public.group_members
  for each row execute function private.group_member_after();

-- 프로필 캐릭터를 바꾸면 내가 속한 모임방 멤버 행에도 반영(약속 참여자 행은 save_my_profile 이 이미 반영)
create or replace function private.profile_to_group_members()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.group_members set avatar = nullif(new.avatar, '{}'::jsonb) where user_id = new.user_id;
  return null;
end $$;
drop trigger if exists profiles_to_group_members on public.profiles;
create trigger profiles_to_group_members after insert or update of avatar on public.profiles
  for each row execute function private.profile_to_group_members();

revoke all on function private.group_member_before(), private.group_member_after(), private.profile_to_group_members()
  from public, anon, authenticated;

-- ───────────────────────── 내부 도우미 ─────────────────────────

-- 이름 목록 검증(1~30명, 1~20자, 중복 없음) 후 정리된 배열을 돌려준다
create or replace function private.clean_names(p_names text[], p_min integer, p_max integer)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v text[];
begin
  select coalesce(array_agg(btrim(n) order by ord), '{}') into v from unnest(coalesce(p_names, '{}')) with ordinality u(n, ord);
  if cardinality(v) not between p_min and p_max then raise exception '멤버는 %~%명으로 적어 주세요.', p_min, p_max; end if;
  if exists (select 1 from unnest(v) n where char_length(n) not between 1 and 20) then raise exception '이름은 1~20자로 적어 주세요.'; end if;
  if (select count(distinct lower(n)) from unnest(v) n) <> cardinality(v) then raise exception '같은 이름이 두 번 있어요.'; end if;
  return v;
end $$;

-- 멤버 초대 토큰 발급(원문 반환, 해시만 저장)
create or replace function private.issue_group_invite(p_group_id uuid, p_member_id uuid)
returns text language plpgsql volatile set search_path = '' as $$
declare v_token text := private.new_token();
begin
  update private.group_invites set revoked_at = now() where member_id = p_member_id and revoked_at is null and consumed_at is null;
  insert into private.group_invites (group_id, member_id, token_hash, expires_at)
    values (p_group_id, p_member_id, private.hash_token(v_token), now() + interval '30 days');
  return v_token;
end $$;

-- 활성 멤버 행 잠금 조회(없으면 오류)
create or replace function private.lock_group(p_group_id uuid)
returns public.groups language plpgsql volatile set search_path = '' as $$
declare v public.groups%rowtype;
begin
  select * into v from public.groups where id = p_group_id for update;
  if not found then raise exception '모임방을 찾을 수 없어요.'; end if;
  return v;
end $$;

revoke all on function private.clean_names(text[], integer, integer), private.issue_group_invite(uuid, uuid), private.lock_group(uuid)
  from public, anon, authenticated;

-- ───────────────────────── 모임방 RPC ─────────────────────────

-- 모임방 만들기: 만든 사람은 관리자 멤버. 나머지 멤버의 초대 토큰 원문은 이 응답에서만 준다.
create or replace function public.create_group(p_name text, p_description text, p_theme text, p_names text[], p_my_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_names text[] := private.clean_names(p_names, 1, 30);
  v_gid uuid;
  v_mid uuid;
  v_invites jsonb := '[]'::jsonb;
  v_i integer;
begin
  if char_length(v_name) not between 1 and 40 then raise exception '모임방 이름은 1~40자로 적어 주세요.'; end if;
  if v_desc is not null and char_length(v_desc) > 200 then raise exception '설명은 200자까지예요.'; end if;
  if coalesce(p_theme, 'picnic') not in ('picnic', 'beach', 'cafe', 'night') then raise exception '배경 테마를 다시 골라 주세요.'; end if;
  if p_my_index is null or p_my_index not between 1 and cardinality(v_names) then raise exception '명단에서 ‘나’를 골라 주세요.'; end if;

  insert into public.groups (name, description, theme, created_by) values (v_name, v_desc, coalesce(p_theme, 'picnic'), v_uid) returning id into v_gid;
  for v_i in 1..cardinality(v_names) loop
    insert into public.group_members (group_id, display_name, sort_order, role, user_id)
      values (v_gid, v_names[v_i], v_i, case when v_i = p_my_index then 'admin' else 'member' end, case when v_i = p_my_index then v_uid end)
      returning id into v_mid;
    if v_i <> p_my_index then
      v_invites := v_invites || jsonb_build_object('member_id', v_mid, 'display_name', v_names[v_i], 'token', private.issue_group_invite(v_gid, v_mid));
    end if;
  end loop;
  return jsonb_build_object('group_id', v_gid, 'invites', v_invites);
end $$;

-- 모임방 초대 수락(같은 토큰은 한 번만 성공)
create or replace function public.accept_group_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_inv private.group_invites%rowtype;
  v_m public.group_members%rowtype;
begin
  select * into v_inv from private.group_invites where token_hash = private.hash_token(p_token) for update;
  if not found then raise exception '모임방 초대 링크가 올바르지 않아요.'; end if;
  select * into v_m from public.group_members where id = v_inv.member_id for update;
  if v_m.user_id = v_uid and v_m.removed_at is null then
    return jsonb_build_object('group_id', v_inv.group_id, 'member_id', v_m.id);
  end if;
  if v_m.removed_at is not null then raise exception '모임방에서 빠진 멤버의 링크예요.'; end if;
  if v_inv.revoked_at is not null then raise exception '이 초대 링크는 새 링크로 바뀌었어요. 관리자에게 새 링크를 받아 주세요.'; end if;
  if v_inv.consumed_at is not null then raise exception '이미 사용된 초대 링크예요. 본인이 아니라면 관리자에게 새 링크를 받아 주세요.'; end if;
  if v_inv.expires_at < now() then raise exception '초대 링크가 만료됐어요. 관리자에게 새 링크를 받아 주세요.'; end if;
  if v_m.user_id is not null then raise exception '이 멤버는 이미 다른 기기와 연결돼 있어요.'; end if;
  if exists (select 1 from public.group_members where group_id = v_inv.group_id and user_id = v_uid and removed_at is null) then
    raise exception '이 기기는 이미 이 모임방의 다른 멤버로 연결돼 있어요.';
  end if;
  update public.group_members set user_id = v_uid where id = v_m.id;
  update private.group_invites set consumed_at = now() where id = v_inv.id;
  return jsonb_build_object('group_id', v_inv.group_id, 'member_id', v_m.id);
end $$;

-- 새 초대 링크(관리자): 이전 링크 폐기 + 기존 기기 연결 해제(그 멤버의 약속 참여자 연결도 함께 해제, 응답은 보존)
create or replace function public.reissue_group_invite(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.group_members%rowtype;
  v_g public.groups%rowtype;
begin
  select * into v_m from public.group_members where id = p_member_id;
  if not found or v_m.removed_at is not null then raise exception '멤버를 찾을 수 없어요.'; end if;
  v_g := private.lock_group(v_m.group_id);
  if not private.is_group_admin(v_m.group_id) then raise exception '관리자만 초대 링크를 만들 수 있어요.'; end if;
  if v_m.user_id = v_uid then raise exception '내 연결은 여기서 바꿀 수 없어요.'; end if;
  if v_m.user_id is not null then
    update public.participants set user_id = null where group_member_id = v_m.id and user_id = v_m.user_id;
    update public.group_members set user_id = null, role = 'member' where id = v_m.id;
  end if;
  return jsonb_build_object('member_id', v_m.id, 'display_name', v_m.display_name, 'token', private.issue_group_invite(v_m.group_id, v_m.id));
end $$;

-- 모임방 정보 수정(관리자)
create or replace function public.update_group(p_group_id uuid, p_name text, p_description text, p_theme text, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype := private.lock_group(p_group_id);
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 바꿀 수 있어요.'; end if;
  if v_g.version <> p_expected_version then raise exception '그사이 모임방 정보가 바뀌었어요. 새로고침 후 다시 시도해 주세요.'; end if;
  if char_length(v_name) not between 1 and 40 then raise exception '모임방 이름은 1~40자로 적어 주세요.'; end if;
  if v_desc is not null and char_length(v_desc) > 200 then raise exception '설명은 200자까지예요.'; end if;
  if p_theme not in ('picnic', 'beach', 'cafe', 'night') then raise exception '배경 테마를 다시 골라 주세요.'; end if;
  update public.groups set name = v_name, description = v_desc, theme = p_theme, version = version + 1, updated_at = now() where id = p_group_id;
  return jsonb_build_object('version', v_g.version + 1);
end $$;

-- 멤버 추가(관리자) → 새 멤버의 초대 토큰
create or replace function public.add_group_members(p_group_id uuid, p_names text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype := private.lock_group(p_group_id);
  v_names text[] := private.clean_names(p_names, 1, 30);
  v_next integer;
  v_mid uuid;
  v_invites jsonb := '[]'::jsonb;
  v_n text;
begin
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 멤버를 추가할 수 있어요.'; end if;
  if (select count(*) from public.group_members where group_id = p_group_id and removed_at is null) + cardinality(v_names) > 30 then
    raise exception '모임방 멤버는 30명까지예요.';
  end if;
  if exists (select 1 from public.group_members m, unnest(v_names) n
             where m.group_id = p_group_id and m.removed_at is null and lower(m.display_name) = lower(n)) then
    raise exception '이미 있는 이름이에요. 다른 이름으로 적어 주세요.';
  end if;
  select coalesce(max(sort_order), 0) into v_next from public.group_members where group_id = p_group_id;
  foreach v_n in array v_names loop
    v_next := v_next + 1;
    insert into public.group_members (group_id, display_name, sort_order) values (p_group_id, v_n, v_next) returning id into v_mid;
    v_invites := v_invites || jsonb_build_object('member_id', v_mid, 'display_name', v_n, 'token', private.issue_group_invite(p_group_id, v_mid));
  end loop;
  return jsonb_build_object('invites', v_invites);
end $$;

-- 멤버 제외(관리자) 또는 나가기(본인). 기록 보존(소프트 삭제), 마지막 관리자는 제외할 수 없다.
create or replace function public.remove_group_member(p_member_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.group_members%rowtype;
  v_g public.groups%rowtype;
begin
  select * into v_m from public.group_members where id = p_member_id;
  if not found or v_m.removed_at is not null then raise exception '멤버를 찾을 수 없어요.'; end if;
  v_g := private.lock_group(v_m.group_id);
  if not (private.is_group_admin(v_m.group_id) or v_m.user_id = v_uid) then raise exception '관리자만 다른 멤버를 뺄 수 있어요.'; end if;
  if v_m.role = 'admin' and (select count(*) from public.group_members
      where group_id = v_m.group_id and role = 'admin' and removed_at is null) <= 1 then
    raise exception '마지막 관리자는 빠질 수 없어요. 다른 멤버를 관리자로 지정한 뒤 다시 시도해 주세요.';
  end if;
  update public.group_members set removed_at = now(), role = 'member' where id = v_m.id;
  update private.group_invites set revoked_at = now() where member_id = v_m.id and revoked_at is null;
  return jsonb_build_object('removed', v_m.id);
end $$;

-- 역할 변경(관리자). 관리자는 연결된 멤버만, 관리자 0명은 불가.
create or replace function public.set_group_member_role(p_member_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.group_members%rowtype;
  v_g public.groups%rowtype;
begin
  select * into v_m from public.group_members where id = p_member_id;
  if not found or v_m.removed_at is not null then raise exception '멤버를 찾을 수 없어요.'; end if;
  v_g := private.lock_group(v_m.group_id);
  if not private.is_group_admin(v_m.group_id) then raise exception '관리자만 역할을 바꿀 수 있어요.'; end if;
  if p_role not in ('admin', 'member') then raise exception '역할을 다시 골라 주세요.'; end if;
  if p_role = 'admin' and v_m.user_id is null then raise exception '모임방에 연결된 멤버만 관리자가 될 수 있어요.'; end if;
  if p_role = 'member' and v_m.role = 'admin' and (select count(*) from public.group_members
      where group_id = v_m.group_id and role = 'admin' and removed_at is null) <= 1 then
    raise exception '관리자가 최소 1명은 있어야 해요.';
  end if;
  update public.group_members set role = p_role where id = v_m.id;
  return jsonb_build_object('member_id', v_m.id, 'role', p_role);
end $$;

-- 모임방 종료/다시 열기(관리자). 데이터는 지우지 않는다.
create or replace function public.archive_group(p_group_id uuid, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype := private.lock_group(p_group_id);
begin
  if not private.is_group_admin(p_group_id) then raise exception '관리자만 모임방을 종료할 수 있어요.'; end if;
  update public.groups set archived_at = case when p_archived then now() end, version = version + 1, updated_at = now() where id = p_group_id;
  return jsonb_build_object('archived', p_archived);
end $$;

-- 모임방에서 새 약속: 고른 멤버만 참여자. 연결된 멤버는 바로 연결, 미연결 멤버만 약속 초대 토큰.
-- 일정 검증·생성은 기존 create_meeting_v2 를 그대로 사용한다.
create or replace function public.create_group_meeting(p_group_id uuid, p_title text, p_member_ids uuid[], p_mode text, p_times jsonb, p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype := private.lock_group(p_group_id);
  v_me public.group_members%rowtype;
  v_ids uuid[];
  v_names text[];
  v_host integer;
  v_res jsonb;
  v_mid uuid;
begin
  if v_g.archived_at is not null then raise exception '종료된 모임방이에요. 관리자가 다시 열어야 새 약속을 만들 수 있어요.'; end if;
  select * into v_me from public.group_members where group_id = p_group_id and user_id = v_uid and removed_at is null;
  if not found then raise exception '이 모임방 멤버만 약속을 만들 수 있어요.'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_member_ids, '{}')) x;
  if cardinality(v_ids) < 2 then raise exception '약속에 참여할 멤버를 2명 이상 골라 주세요.'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (
      select 1 from public.group_members m where m.id = x and m.group_id = p_group_id and m.removed_at is null)) then
    raise exception '이 모임방 멤버가 아닌 사람이 들어 있어요.';
  end if;
  select array_agg(m.display_name order by m.sort_order) into v_names from public.group_members m where m.id = any (v_ids);
  select i into v_host from (select m.id, row_number() over (order by m.sort_order) i from public.group_members m where m.id = any (v_ids)) s
   where s.id = v_me.id;

  v_res := public.create_meeting_v2(p_title, v_names, v_host, p_mode, p_times, p_days);
  v_mid := (v_res ->> 'meeting_id')::uuid;
  update public.meetings set group_id = p_group_id where id = v_mid;
  update public.participants p set group_member_id = m.id
    from public.group_members m
   where p.meeting_id = v_mid and m.group_id = p_group_id and m.removed_at is null and lower(m.display_name) = lower(p.display_name);
  -- 이미 모임방에 연결된 멤버는 약속에도 바로 연결(초대 링크 불필요)
  update public.participants p set user_id = m.user_id
    from public.group_members m
   where p.meeting_id = v_mid and p.group_member_id = m.id and p.user_id is null and m.user_id is not null;
  update private.participant_invites i set revoked_at = now()
    from public.participants p
   where i.participant_id = p.id and p.meeting_id = v_mid and p.user_id is not null and i.revoked_at is null;

  return jsonb_build_object(
    'meeting_id', v_mid,
    'admin_token', v_res -> 'admin_token',
    'invites', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_res -> 'invites') e
                         join public.participants p on p.id = (e ->> 'participant_id')::uuid
                        where p.user_id is null), '[]'::jsonb)
  );
end $$;

-- 모임방 화면 요약(멤버만). 참여하지 않은 약속은 제목·상태·날짜만 준다(응답·장소·참여자 이름 없음).
create or replace function public.group_overview(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype;
begin
  if not private.is_group_member(p_group_id) then raise exception '이 모임방 멤버만 볼 수 있어요.'; end if;
  select * into v_g from public.groups where id = p_group_id;
  return jsonb_build_object(
    'group', to_jsonb(v_g) - 'created_by',
    'me', (select jsonb_build_object('member_id', m.id, 'role', m.role, 'display_name', m.display_name)
             from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid and m.removed_at is null),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'display_name', m.display_name, 'role', m.role,
                  'joined', m.user_id is not null, 'is_me', m.user_id = v_uid, 'avatar', m.avatar, 'sort_order', m.sort_order) order by m.sort_order)
                from public.group_members m where m.group_id = p_group_id and m.removed_at is null), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(item order by item ->> 'created_at' desc) from (
        select jsonb_build_object(
          'id', mt.id, 'title', mt.title, 'status', mt.status, 'schedule_mode', mt.schedule_mode,
          'selected_start', mt.selected_start, 'selected_end', mt.selected_end, 'finalized_at', mt.finalized_at, 'created_at', mt.created_at,
          'i_participate', mp.id is not null,
          'i_host', mt.owner_user_id = v_uid,
          'my_state', case when mp.id is null then null
                           when not exists (select 1 from public.schedule_submissions s where s.participant_id = mp.id) then 'pending'
                           else 'done' end,
          'counts', case when mp.id is null and mt.owner_user_id is distinct from v_uid then null else jsonb_build_object(
              'total', (select count(*) from public.participants x where x.meeting_id = mt.id),
              'done', (select count(*) from public.schedule_submissions s where s.meeting_id = mt.id)) end
        ) as item
        from public.meetings mt
        left join public.participants mp on mp.meeting_id = mt.id and mp.user_id = v_uid
        where mt.group_id = p_group_id) r), '[]'::jsonb)
  );
end $$;

-- 내 모임방 목록(홈·모임방 탭용)
create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'theme', g.theme, 'archived_at', g.archived_at, 'my_role', m.role,
      'members', (select jsonb_agg(jsonb_build_object('id', x.id, 'display_name', x.display_name, 'avatar', x.avatar, 'sort_order', x.sort_order, 'joined', x.user_id is not null) order by x.sort_order)
                    from public.group_members x where x.group_id = g.id and x.removed_at is null),
      'next', (select jsonb_build_object('id', mt.id, 'title', mt.title, 'selected_start', mt.selected_start)
                 from public.meetings mt where mt.group_id = g.id and mt.selected_start > now() order by mt.selected_start limit 1),
      'open_count', (select count(*) from public.meetings mt where mt.group_id = g.id and mt.status <> 'finalized')
    ) order by g.archived_at nulls first, g.updated_at desc), '[]'::jsonb)
  from public.groups g join public.group_members m on m.group_id = g.id
  where m.user_id = (select auth.uid()) and m.removed_at is null;
$$;

-- 초대받지 않은 방문자용 최소 안내(모임방 이름만)
create or replace function public.group_public_info(p_group_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', g.name, 'theme', g.theme) from public.groups g where g.id = p_group_id;
$$;

-- ───────────────────────── 실행 권한 ─────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_group(text, text, text, text[], integer)',
    'public.accept_group_invite(text)',
    'public.reissue_group_invite(uuid)',
    'public.update_group(uuid, text, text, text, integer)',
    'public.add_group_members(uuid, text[])',
    'public.remove_group_member(uuid)',
    'public.set_group_member_role(uuid, text)',
    'public.archive_group(uuid, boolean)',
    'public.create_group_meeting(uuid, text, uuid[], text, jsonb, jsonb)',
    'public.group_overview(uuid)',
    'public.my_groups()',
    'public.group_public_info(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
