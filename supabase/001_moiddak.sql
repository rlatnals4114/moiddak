-- 모이딱 MVP 스키마 v1
-- Supabase 대시보드 → SQL Editor 에서 통째로 실행한다. 여러 번 실행해도 기존 데이터는 지워지지 않는다.
-- 원칙: 브라우저는 표를 "읽기"만 한다(RLS 로 같은 모임 사람만). 모든 쓰기는 아래 RPC 함수가
--       로그인 세션(auth.uid())·모임 단계·소속을 같은 트랜잭션 안에서 검사한 뒤 수행한다.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ───────────────────────── 표 ─────────────────────────

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 60),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  host_participant_id uuid,
  timezone text not null default 'Asia/Seoul',
  status text not null default 'schedule_open'
    check (status in ('schedule_open', 'place_open', 'finalized')),
  selected_time_option_id uuid,
  finalized_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_owner_idx on public.meetings (owner_user_id);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  user_id uuid references auth.users(id) on delete set null,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, display_name),
  unique (meeting_id, user_id),
  unique (meeting_id, id)
);
create index if not exists participants_user_idx on public.participants (user_id);

create table if not exists public.time_options (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  sort_order integer not null,
  check (ends_at is null or ends_at > starts_at),
  unique (meeting_id, starts_at),
  unique (meeting_id, id)
);

-- 제출 행이 있으면 "응답 완료". 선택 행이 0개면 "가능한 시간 없음".
create table if not exists public.schedule_submissions (
  meeting_id uuid not null,
  participant_id uuid not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, participant_id),
  foreign key (meeting_id, participant_id) references public.participants(meeting_id, id) on delete cascade
);

create table if not exists public.availability_choices (
  meeting_id uuid not null,
  participant_id uuid not null,
  time_option_id uuid not null,
  primary key (participant_id, time_option_id),
  foreign key (meeting_id, participant_id) references public.schedule_submissions(meeting_id, participant_id) on delete cascade,
  foreign key (meeting_id, time_option_id) references public.time_options(meeting_id, id) on delete cascade
);
create index if not exists availability_meeting_idx on public.availability_choices (meeting_id, time_option_id);

create table if not exists public.place_candidates (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  kind text not null check (kind in ('restaurant', 'cafe')),
  name text not null check (char_length(name) between 1 and 40),
  map_url text check (map_url is null or (char_length(map_url) <= 500 and map_url ~* '^https?://[^[:space:]<>"]+$')),
  created_by_participant_id uuid,
  created_at timestamptz not null default now(),
  unique (meeting_id, kind, name),
  unique (meeting_id, id),
  unique (meeting_id, kind, id),
  foreign key (meeting_id, created_by_participant_id) references public.participants(meeting_id, id) on delete set null (created_by_participant_id)
);

-- 제출 행이 있고 투표 행이 없으면 "선호 없음".
create table if not exists public.place_submissions (
  meeting_id uuid not null,
  participant_id uuid not null,
  kind text not null check (kind in ('restaurant', 'cafe')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, participant_id, kind),
  foreign key (meeting_id, participant_id) references public.participants(meeting_id, id) on delete cascade
);

create table if not exists public.place_votes (
  meeting_id uuid not null,
  participant_id uuid not null,
  kind text not null,
  candidate_id uuid not null,
  primary key (meeting_id, participant_id, kind),
  foreign key (meeting_id, participant_id, kind) references public.place_submissions(meeting_id, participant_id, kind) on delete cascade,
  foreign key (meeting_id, kind, candidate_id) references public.place_candidates(meeting_id, kind, id) on delete cascade
);
create index if not exists place_votes_candidate_idx on public.place_votes (meeting_id, kind, candidate_id);

create table if not exists public.final_places (
  meeting_id uuid not null,
  kind text not null,
  candidate_id uuid not null,
  primary key (meeting_id, kind),
  foreign key (meeting_id, kind, candidate_id) references public.place_candidates(meeting_id, kind, id) on delete cascade
);

-- 모임 → 확정 시간 / 주최자 참가자 (같은 모임 안의 행만 가리키도록 복합 FK)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meetings_selected_time_fk') then
    alter table public.meetings add constraint meetings_selected_time_fk
      foreign key (id, selected_time_option_id) references public.time_options(meeting_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meetings_host_participant_fk') then
    alter table public.meetings add constraint meetings_host_participant_fk
      foreign key (id, host_participant_id) references public.participants(meeting_id, id) deferrable initially deferred;
  end if;
end $$;

-- 초대·관리자 토큰: 해시만 저장. private 스키마는 API 로 노출되지 않는다.
create table if not exists private.participant_invites (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists participant_invites_participant_idx on private.participant_invites (participant_id);

create table if not exists private.admin_tokens (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now()
);

revoke all on all tables in schema private from public, anon, authenticated;

-- ───────────────────────── 읽기 권한 (RLS) ─────────────────────────

create or replace function private.is_member(p_meeting_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.meetings m where m.id = p_meeting_id and m.owner_user_id = (select auth.uid()))
      or exists (select 1 from public.participants p where p.meeting_id = p_meeting_id and p.user_id = (select auth.uid()));
$$;
revoke all on function private.is_member(uuid) from public, anon;
grant execute on function private.is_member(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['meetings', 'participants', 'time_options', 'schedule_submissions',
    'availability_choices', 'place_candidates', 'place_submissions', 'place_votes', 'final_places']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(%s))',
      t || '_member_read', t, case when t = 'meetings' then 'id' else 'meeting_id' end);
  end loop;
end $$;

-- ───────────────────────── 내부 도우미 ─────────────────────────

create or replace function private.new_token()
returns text language sql volatile set search_path = '' as $$
  select encode(extensions.gen_random_bytes(24), 'hex');
$$;

create or replace function private.hash_token(p_token text)
returns bytea language sql immutable set search_path = '' as $$
  select extensions.digest(coalesce(p_token, ''), 'sha256');
$$;

create or replace function private.require_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception '로그인 세션이 없어요. 페이지를 새로고침해 주세요.'; end if;
  return v;
end $$;

revoke all on function private.new_token(), private.hash_token(text), private.require_uid() from public, anon, authenticated;

-- ───────────────────────── 쓰기 RPC ─────────────────────────

-- 모임 생성: 명단·시간 후보·참가자별 초대 토큰·관리자 복구 토큰을 한 번에 만든다.
-- 토큰 원문은 이 응답에서만 돌려주고 DB 에는 해시만 남긴다.
create or replace function public.create_meeting(p_title text, p_names text[], p_host_index integer, p_times jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_names text[];
  v_n integer;
  v_meeting_id uuid;
  v_pid uuid;
  v_host_pid uuid;
  v_token text;
  v_admin text := private.new_token();
  v_invites jsonb := '[]'::jsonb;
  v_t jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_i integer;
begin
  if char_length(v_title) not between 1 and 60 then raise exception '모임 이름은 1~60자로 적어 주세요.'; end if;

  select coalesce(array_agg(btrim(n) order by ord), '{}') into v_names
    from unnest(coalesce(p_names, '{}')) with ordinality as u(n, ord);
  v_n := cardinality(v_names);
  if v_n not between 2 and 12 then raise exception '참가자는 2~12명으로 적어 주세요.'; end if;
  if exists (select 1 from unnest(v_names) n where char_length(n) not between 1 and 20) then
    raise exception '참가자 이름은 1~20자로 적어 주세요.';
  end if;
  if (select count(distinct lower(n)) from unnest(v_names) n) <> v_n then
    raise exception '같은 이름이 두 번 있어요. 이름을 구분해 주세요.';
  end if;
  if p_host_index is not null and p_host_index not between 1 and v_n then
    raise exception '주최자 위치가 올바르지 않아요.';
  end if;

  if jsonb_typeof(p_times) is distinct from 'array' or jsonb_array_length(p_times) not between 1 and 8 then
    raise exception '시간 후보는 1~8개로 정해 주세요.';
  end if;
  if (select count(distinct (e ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_times) e)
     <> jsonb_array_length(p_times) then
    raise exception '같은 시작 시간이 두 번 있어요.';
  end if;

  insert into public.meetings (title, owner_user_id) values (v_title, v_uid) returning id into v_meeting_id;

  for v_i in 1..v_n loop
    insert into public.participants (meeting_id, display_name, sort_order, user_id)
      values (v_meeting_id, v_names[v_i], v_i, case when v_i = p_host_index then v_uid end)
      returning id into v_pid;
    if v_i = p_host_index then
      v_host_pid := v_pid;
    else
      v_token := private.new_token();
      insert into private.participant_invites (meeting_id, participant_id, token_hash, expires_at)
        values (v_meeting_id, v_pid, private.hash_token(v_token), now() + interval '14 days');
      v_invites := v_invites || jsonb_build_object('participant_id', v_pid, 'display_name', v_names[v_i], 'token', v_token);
    end if;
  end loop;
  update public.meetings set host_participant_id = v_host_pid where id = v_meeting_id;

  v_i := 0;
  for v_t in select value from jsonb_array_elements(p_times) loop
    v_i := v_i + 1;
    v_start := nullif(v_t ->> 'starts_at', '')::timestamptz;
    v_end := nullif(v_t ->> 'ends_at', '')::timestamptz;
    if v_start is null then raise exception '시간 후보의 시작 시간을 골라 주세요.'; end if;
    if v_end is not null and v_end <= v_start then raise exception '끝 시간은 시작 시간보다 늦어야 해요.'; end if;
    insert into public.time_options (meeting_id, starts_at, ends_at, sort_order) values (v_meeting_id, v_start, v_end, v_i);
  end loop;

  insert into private.admin_tokens (meeting_id, token_hash) values (v_meeting_id, private.hash_token(v_admin));

  return jsonb_build_object('meeting_id', v_meeting_id, 'admin_token', v_admin, 'invites', v_invites);
end $$;

-- 초대 수락: 토큰을 확인하고 지금 세션을 그 참가자에 묶는다. 같은 토큰은 한 번만 성공한다.
create or replace function public.accept_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_inv private.participant_invites%rowtype;
  v_p public.participants%rowtype;
begin
  select * into v_inv from private.participant_invites where token_hash = private.hash_token(p_token) for update;
  if not found then raise exception '초대 링크가 올바르지 않아요. 링크를 다시 확인해 주세요.'; end if;

  select * into v_p from public.participants where id = v_inv.participant_id for update;
  if v_p.user_id = v_uid then
    return jsonb_build_object('meeting_id', v_inv.meeting_id, 'participant_id', v_p.id);
  end if;
  if v_inv.revoked_at is not null then raise exception '이 초대 링크는 새 링크로 바뀌었어요. 주최자에게 새 링크를 받아 주세요.'; end if;
  if v_inv.consumed_at is not null then raise exception '이미 사용된 초대 링크예요. 본인이 아니라면 주최자에게 새 링크를 받아 주세요.'; end if;
  if v_inv.expires_at < now() then raise exception '초대 링크가 만료됐어요. 주최자에게 새 링크를 받아 주세요.'; end if;
  if v_p.user_id is not null then raise exception '이 참가자는 이미 다른 기기와 연결돼 있어요.'; end if;
  if exists (select 1 from public.participants where meeting_id = v_inv.meeting_id and user_id = v_uid) then
    raise exception '이 기기는 이미 이 모임의 다른 참가자로 연결돼 있어요.';
  end if;

  update public.participants set user_id = v_uid where id = v_p.id;
  update private.participant_invites set consumed_at = now() where id = v_inv.id;
  return jsonb_build_object('meeting_id', v_inv.meeting_id, 'participant_id', v_p.id);
end $$;

-- 관리자 복구: 관리자 링크를 가진 기기를 주최자로 바꾼다(주최자 참가자 연결도 함께 옮긴다).
create or replace function public.claim_admin(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_mid uuid;
  v_m public.meetings%rowtype;
begin
  select meeting_id into v_mid from private.admin_tokens where token_hash = private.hash_token(p_token);
  if v_mid is null then raise exception '관리자 링크가 올바르지 않아요.'; end if;
  select * into v_m from public.meetings where id = v_mid for update;
  if v_m.owner_user_id = v_uid then return v_mid; end if;
  if v_m.host_participant_id is not null then
    if exists (select 1 from public.participants where meeting_id = v_mid and user_id = v_uid and id <> v_m.host_participant_id) then
      raise exception '이 기기는 이미 이 모임의 다른 참가자로 연결돼 있어요.';
    end if;
    update public.participants set user_id = v_uid where id = v_m.host_participant_id;
  end if;
  update public.meetings set owner_user_id = v_uid, updated_at = now() where id = v_mid;
  return v_mid;
end $$;

-- 초대 재발급(주최자만): 이전 링크를 폐기하고 기존 기기 연결도 끊는다. 이미 낸 응답은 그대로 남는다.
create or replace function public.reissue_invite(p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_p public.participants%rowtype;
  v_m public.meetings%rowtype;
  v_token text := private.new_token();
begin
  select * into v_p from public.participants where id = p_participant_id;
  if not found then raise exception '참가자를 찾을 수 없어요.'; end if;
  select * into v_m from public.meetings where id = v_p.meeting_id for update;
  if v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 초대 링크를 만들 수 있어요.'; end if;
  if v_m.host_participant_id = v_p.id then raise exception '주최자 본인은 관리자 복구 링크로 다시 연결해요.'; end if;

  update private.participant_invites set revoked_at = now() where participant_id = v_p.id and revoked_at is null;
  update public.participants set user_id = null where id = v_p.id;
  insert into private.participant_invites (meeting_id, participant_id, token_hash, expires_at)
    values (v_p.meeting_id, v_p.id, private.hash_token(v_token), now() + interval '14 days');
  return jsonb_build_object('participant_id', v_p.id, 'display_name', v_p.display_name, 'token', v_token);
end $$;

-- 일정 응답(본인만, 일정 단계에서만). 제출 행 upsert + 선택 교체를 한 트랜잭션으로.
create or replace function public.submit_schedule(p_meeting_id uuid, p_time_option_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
  v_ids uuid[];
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found then raise exception '모임을 찾을 수 없어요.'; end if;
  select id into v_pid from public.participants where meeting_id = p_meeting_id and user_id = v_uid;
  if v_pid is null then raise exception '이 기기는 이 모임의 참가자로 연결돼 있지 않아요. 개인 초대 링크로 들어와 주세요.'; end if;
  if v_m.status <> 'schedule_open' then raise exception '일정이 이미 확정돼서 응답을 바꿀 수 없어요.'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_time_option_ids, '{}')) x;
  if exists (select 1 from unnest(v_ids) x
             where not exists (select 1 from public.time_options t where t.meeting_id = p_meeting_id and t.id = x)) then
    raise exception '이 모임에 없는 시간 후보가 들어 있어요.';
  end if;

  insert into public.schedule_submissions (meeting_id, participant_id) values (p_meeting_id, v_pid)
    on conflict (meeting_id, participant_id) do update set updated_at = now();
  delete from public.availability_choices where meeting_id = p_meeting_id and participant_id = v_pid;
  insert into public.availability_choices (meeting_id, participant_id, time_option_id)
    select p_meeting_id, v_pid, x from unnest(v_ids) x;
  return jsonb_build_object('participant_id', v_pid, 'selected', cardinality(v_ids));
end $$;

-- 일정 확정(주최자만). 화면이 오래된 상태에서 누르면 version 이 달라 거부된다.
create or replace function public.confirm_schedule(p_meeting_id uuid, p_time_option_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 일정을 확정할 수 있어요.'; end if;
  if v_m.status <> 'schedule_open' then raise exception '일정은 이미 확정됐어요.'; end if;
  if v_m.version <> p_expected_version then raise exception '그사이 모임 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.'; end if;
  if not exists (select 1 from public.time_options where meeting_id = p_meeting_id and id = p_time_option_id) then
    raise exception '이 모임에 없는 시간 후보예요.';
  end if;
  update public.meetings
     set status = 'place_open', selected_time_option_id = p_time_option_id, version = version + 1, updated_at = now()
   where id = p_meeting_id;
  return jsonb_build_object('status', 'place_open');
end $$;

-- 장소 후보 추가(주최자·참가자). 해당 분류의 투표가 시작되면 잠긴다.
create or replace function public.add_place_candidate(p_meeting_id uuid, p_kind text, p_name text, p_map_url text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_url text := nullif(btrim(coalesce(p_map_url, '')), '');
  v_id uuid;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found then raise exception '모임을 찾을 수 없어요.'; end if;
  select id into v_pid from public.participants where meeting_id = p_meeting_id and user_id = v_uid;
  if v_pid is null and v_m.owner_user_id is distinct from v_uid then raise exception '이 모임 사람만 후보를 올릴 수 있어요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정된 모임이에요.'; end if;
  if p_kind not in ('restaurant', 'cafe') then raise exception '분류는 식당 또는 카페만 돼요.'; end if;
  if exists (select 1 from public.place_submissions where meeting_id = p_meeting_id and kind = p_kind) then
    raise exception '이 분류는 투표가 시작돼서 후보를 더 올릴 수 없어요.';
  end if;
  if char_length(v_name) not between 1 and 40 then raise exception '장소 이름은 1~40자로 적어 주세요.'; end if;
  if v_url is not null and (char_length(v_url) > 500 or v_url !~* '^https?://[^[:space:]<>"]+$') then
    raise exception '지도 링크는 http:// 또는 https:// 로 시작하는 주소만 돼요.';
  end if;
  if exists (select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind and name = v_name) then
    raise exception '같은 이름의 후보가 이미 있어요.';
  end if;
  if (select count(*) from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind) >= 10 then
    raise exception '분류마다 후보는 10개까지 올릴 수 있어요.';
  end if;
  insert into public.place_candidates (meeting_id, kind, name, map_url, created_by_participant_id)
    values (p_meeting_id, p_kind, v_name, v_url, v_pid) returning id into v_id;
  return v_id;
end $$;

-- 장소 후보 삭제(주최자 또는 올린 사람). 투표 시작 후에는 잠긴다.
create or replace function public.delete_place_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_c public.place_candidates%rowtype;
  v_m public.meetings%rowtype;
begin
  select * into v_c from public.place_candidates where id = p_candidate_id;
  if not found then raise exception '후보를 찾을 수 없어요.'; end if;
  select * into v_m from public.meetings where id = v_c.meeting_id for update;
  if v_m.owner_user_id is distinct from v_uid and not exists (
    select 1 from public.participants where id = v_c.created_by_participant_id and user_id = v_uid) then
    raise exception '주최자나 후보를 올린 사람만 지울 수 있어요.';
  end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정된 모임이에요.'; end if;
  if exists (select 1 from public.place_submissions where meeting_id = v_c.meeting_id and kind = v_c.kind) then
    raise exception '투표가 시작돼서 후보를 지울 수 없어요.';
  end if;
  delete from public.place_candidates where id = p_candidate_id;
end $$;

-- 장소 선호(본인만, 일정 확정 후~최종 확정 전). p_candidate_id 가 null 이면 "선호 없음".
create or replace function public.submit_place(p_meeting_id uuid, p_kind text, p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found then raise exception '모임을 찾을 수 없어요.'; end if;
  select id into v_pid from public.participants where meeting_id = p_meeting_id and user_id = v_uid;
  if v_pid is null then raise exception '이 기기는 이 모임의 참가자로 연결돼 있지 않아요.'; end if;
  if v_m.status = 'schedule_open' then raise exception '장소 투표는 일정이 확정된 뒤에 열려요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정돼서 투표할 수 없어요.'; end if;
  if p_kind not in ('restaurant', 'cafe') then raise exception '분류는 식당 또는 카페만 돼요.'; end if;
  if not exists (select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind) then
    raise exception '이 분류에는 후보가 없어요.';
  end if;
  if p_candidate_id is not null and not exists (
    select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind and id = p_candidate_id) then
    raise exception '이 모임의 후보가 아니에요.';
  end if;

  insert into public.place_submissions (meeting_id, participant_id, kind) values (p_meeting_id, v_pid, p_kind)
    on conflict (meeting_id, participant_id, kind) do update set updated_at = now();
  delete from public.place_votes where meeting_id = p_meeting_id and participant_id = v_pid and kind = p_kind;
  if p_candidate_id is not null then
    insert into public.place_votes (meeting_id, participant_id, kind, candidate_id)
      values (p_meeting_id, v_pid, p_kind, p_candidate_id);
  end if;
  return jsonb_build_object('participant_id', v_pid, 'kind', p_kind, 'candidate_id', p_candidate_id);
end $$;

-- 최종 확정(주최자만): 식당 필수, 카페 선택. 확정 후 모든 투표·후보 추가가 잠긴다.
create or replace function public.finalize_meeting(p_meeting_id uuid, p_restaurant_id uuid, p_cafe_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 최종 확정할 수 있어요.'; end if;
  if v_m.status = 'schedule_open' then raise exception '일정을 먼저 확정해 주세요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정됐어요.'; end if;
  if v_m.version <> p_expected_version then raise exception '그사이 모임 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.'; end if;
  if p_restaurant_id is null or not exists (
    select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = 'restaurant' and id = p_restaurant_id) then
    raise exception '이 모임의 식당 후보 하나를 골라 주세요.';
  end if;
  if p_cafe_id is not null and not exists (
    select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = 'cafe' and id = p_cafe_id) then
    raise exception '이 모임의 카페 후보가 아니에요.';
  end if;

  insert into public.final_places (meeting_id, kind, candidate_id) values (p_meeting_id, 'restaurant', p_restaurant_id);
  if p_cafe_id is not null then
    insert into public.final_places (meeting_id, kind, candidate_id) values (p_meeting_id, 'cafe', p_cafe_id);
  end if;
  update public.meetings set status = 'finalized', finalized_at = now(), version = version + 1, updated_at = now()
   where id = p_meeting_id;
  return jsonb_build_object('status', 'finalized');
end $$;

-- 초대받지 않은 방문자용 최소 안내(모임 이름만).
create or replace function public.meeting_public_info(p_meeting_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('title', m.title) from public.meetings m where m.id = p_meeting_id;
$$;

-- 함수 실행 권한: 로그인 세션(익명 포함)만.
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_meeting(text, text[], integer, jsonb)',
    'public.accept_invite(text)',
    'public.claim_admin(text)',
    'public.reissue_invite(uuid)',
    'public.submit_schedule(uuid, uuid[])',
    'public.confirm_schedule(uuid, uuid, integer)',
    'public.add_place_candidate(uuid, text, text, text)',
    'public.delete_place_candidate(uuid)',
    'public.submit_place(uuid, text, uuid)',
    'public.finalize_meeting(uuid, uuid, uuid, integer)',
    'public.meeting_public_info(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
