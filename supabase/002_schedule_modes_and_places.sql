-- 모이딱 002: 일정 방식 2종(A 후보 투표 poll / B 30분 시간표 grid) + 지도 장소 정보
-- 001 을 실행한 DB 에 SQL Editor 로 통째로 실행한다. 여러 번 실행해도 안전하다.
-- 원칙: 표·행을 지우지 않는다. 컬럼·표·함수를 추가하고, 기존 함수는 같은 이름·인자로 동작을 유지한다.
--       기존 모임은 schedule_mode 기본값 'poll'(A 모드)로 그대로 동작한다.

-- ───────────────────────── 모임: 방식·확정 구간 ─────────────────────────

alter table public.meetings add column if not exists schedule_mode text not null default 'poll';
alter table public.meetings add column if not exists slot_minutes integer not null default 30;
-- 확정된 일정 구간(두 방식 공통). A 모드는 확정한 후보의 시각을 복사해 둔다.
alter table public.meetings add column if not exists selected_start timestamptz;
alter table public.meetings add column if not exists selected_end timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meetings_schedule_mode_check') then
    alter table public.meetings add constraint meetings_schedule_mode_check check (schedule_mode in ('poll', 'grid'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meetings_slot_minutes_check') then
    alter table public.meetings add constraint meetings_slot_minutes_check check (slot_minutes = 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'meetings_selected_range_check') then
    alter table public.meetings add constraint meetings_selected_range_check
      check (selected_end is null or selected_start is null or selected_end > selected_start);
  end if;
end $$;

-- 이미 확정된 기존(A) 모임의 확정 시각을 채운다. 비어 있는 칸만 채우고 다른 값은 건드리지 않는다.
update public.meetings m
   set selected_start = t.starts_at, selected_end = t.ends_at
  from public.time_options t
 where t.id = m.selected_time_option_id and m.selected_start is null;

-- ───────────────────────── B 모드: 조사 날짜·30분 칸 ─────────────────────────

-- day 는 모임 시간대(기본 KST) 기준 날짜, 분은 그날 0시부터. 자정을 넘기는 범위는 지원하지 않는다(최대 24:00).
create table if not exists public.schedule_survey_days (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  day date not null,
  start_minute integer not null check (start_minute between 0 and 1410 and start_minute % 30 = 0),
  end_minute integer not null check (end_minute between 30 and 1440 and end_minute % 30 = 0),
  check (end_minute > start_minute and end_minute - start_minute <= 16 * 60),
  primary key (meeting_id, day)
);

-- 참가자가 "가능"으로 고른 30분 칸의 시작 시각(UTC 저장). 제출 행(schedule_submissions)이 있어야 한다.
create table if not exists public.grid_availability (
  meeting_id uuid not null,
  participant_id uuid not null,
  slot_start timestamptz not null,
  primary key (meeting_id, participant_id, slot_start),
  foreign key (meeting_id, participant_id) references public.schedule_submissions(meeting_id, participant_id) on delete cascade
);
create index if not exists grid_availability_slot_idx on public.grid_availability (meeting_id, slot_start);

-- ───────────────────────── 장소: 지도 정보(선택) ─────────────────────────
-- 링크만 있는 기존 후보는 그대로 둔다(좌표 null 허용).

alter table public.place_candidates add column if not exists provider text;
alter table public.place_candidates add column if not exists provider_place_id text;
alter table public.place_candidates add column if not exists address text;
alter table public.place_candidates add column if not exists road_address text;
alter table public.place_candidates add column if not exists category text;
alter table public.place_candidates add column if not exists latitude double precision;
alter table public.place_candidates add column if not exists longitude double precision;
alter table public.place_candidates add column if not exists detail_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'place_candidates_map_fields_check') then
    alter table public.place_candidates add constraint place_candidates_map_fields_check check (
      (provider is null or provider = 'kakao')
      and (provider is null or (provider_place_id is not null and latitude is not null and longitude is not null))
      and (latitude is null or latitude between -90 and 90)
      and (longitude is null or longitude between -180 and 180)
      and (detail_url is null or (char_length(detail_url) <= 500 and detail_url ~* '^https?://[^[:space:]<>"]+$'))
      and char_length(coalesce(address, '')) <= 200
      and char_length(coalesce(road_address, '')) <= 200
      and char_length(coalesce(category, '')) <= 100
      and char_length(coalesce(provider_place_id, '')) <= 50
    );
  end if;
end $$;
-- 같은 지도 장소는 분류마다 한 번만 후보가 된다(표가 한곳에 모이도록).
create unique index if not exists place_candidates_provider_uniq
  on public.place_candidates (meeting_id, kind, provider, provider_place_id) where provider_place_id is not null;

-- ───────────────────────── 새 표 읽기 권한(RLS) ─────────────────────────

do $$
declare t text;
begin
  foreach t in array array['schedule_survey_days', 'grid_availability'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_member(meeting_id))',
      t || '_member_read', t);
  end loop;
end $$;

-- ───────────────────────── 모임 생성 v2 ─────────────────────────
-- p_mode 'poll': p_times = [{starts_at, ends_at}] / 'grid': p_days = [{day:'YYYY-MM-DD', start_minute, end_minute}]
create or replace function public.create_meeting_v2(
  p_title text, p_names text[], p_host_index integer, p_mode text, p_times jsonb, p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_mode text := coalesce(p_mode, 'poll');
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
  v_s integer;
  v_e integer;
  v_i integer;
begin
  if char_length(v_title) not between 1 and 60 then raise exception '모임 이름은 1~60자로 적어 주세요.'; end if;
  if v_mode not in ('poll', 'grid') then raise exception '일정 정하는 방법을 골라 주세요.'; end if;

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

  if v_mode = 'poll' then
    if jsonb_typeof(p_times) is distinct from 'array' or jsonb_array_length(p_times) not between 1 and 8 then
      raise exception '시간 후보는 1~8개로 정해 주세요.';
    end if;
    if (select count(distinct (e ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_times) e)
       <> jsonb_array_length(p_times) then
      raise exception '같은 시작 시간이 두 번 있어요.';
    end if;
  else
    if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) not between 1 and 14 then
      raise exception '조사할 날짜는 1~14일로 골라 주세요.';
    end if;
    if (select count(distinct (e ->> 'day')::date) from jsonb_array_elements(p_days) e) <> jsonb_array_length(p_days) then
      raise exception '같은 날짜가 두 번 있어요.';
    end if;
  end if;

  insert into public.meetings (title, owner_user_id, schedule_mode) values (v_title, v_uid, v_mode) returning id into v_meeting_id;

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

  if v_mode = 'poll' then
    v_i := 0;
    for v_t in select value from jsonb_array_elements(p_times) loop
      v_i := v_i + 1;
      v_start := nullif(v_t ->> 'starts_at', '')::timestamptz;
      v_end := nullif(v_t ->> 'ends_at', '')::timestamptz;
      if v_start is null then raise exception '시간 후보의 시작 시간을 골라 주세요.'; end if;
      if v_end is not null and v_end <= v_start then raise exception '끝 시간은 시작 시간보다 늦어야 해요.'; end if;
      insert into public.time_options (meeting_id, starts_at, ends_at, sort_order) values (v_meeting_id, v_start, v_end, v_i);
    end loop;
  else
    for v_t in select value from jsonb_array_elements(p_days) loop
      v_s := (v_t ->> 'start_minute')::integer;
      v_e := (v_t ->> 'end_minute')::integer;
      if v_s is null or v_e is null or v_s % 30 <> 0 or v_e % 30 <> 0 or v_s < 0 or v_e > 1440 or v_e <= v_s then
        raise exception '조사 시간은 30분 단위로, 끝이 시작보다 늦게 정해 주세요(자정 넘김 불가).';
      end if;
      if v_e - v_s > 16 * 60 then raise exception '하루 조사 범위는 16시간(32칸)까지예요.'; end if;
      insert into public.schedule_survey_days (meeting_id, day, start_minute, end_minute)
        values (v_meeting_id, (v_t ->> 'day')::date, v_s, v_e);
    end loop;
  end if;

  insert into private.admin_tokens (meeting_id, token_hash) values (v_meeting_id, private.hash_token(v_admin));
  return jsonb_build_object('meeting_id', v_meeting_id, 'admin_token', v_admin, 'invites', v_invites);
end $$;

-- 기존 함수는 같은 인자로 계속 동작한다(A 모드로 생성).
create or replace function public.create_meeting(p_title text, p_names text[], p_host_index integer, p_times jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.create_meeting_v2(p_title, p_names, p_host_index, 'poll', p_times, null);
$$;

-- ───────────────────────── A 모드: 제출·확정 (방식 검사 추가) ─────────────────────────

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
  if v_m.schedule_mode <> 'poll' then raise exception '이 모임은 시간표 방식이에요. 화면을 새로고침해 주세요.'; end if;

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

create or replace function public.confirm_schedule(p_meeting_id uuid, p_time_option_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_t public.time_options%rowtype;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 일정을 확정할 수 있어요.'; end if;
  if v_m.status <> 'schedule_open' then raise exception '일정은 이미 확정됐어요.'; end if;
  if v_m.schedule_mode <> 'poll' then raise exception '이 모임은 시간표 방식이에요. 화면을 새로고침해 주세요.'; end if;
  if v_m.version <> p_expected_version then raise exception '그사이 모임 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.'; end if;
  select * into v_t from public.time_options where meeting_id = p_meeting_id and id = p_time_option_id;
  if not found then raise exception '이 모임에 없는 시간 후보예요.'; end if;
  update public.meetings
     set status = 'place_open', selected_time_option_id = v_t.id, selected_start = v_t.starts_at, selected_end = v_t.ends_at,
         version = version + 1, updated_at = now()
   where id = p_meeting_id;
  return jsonb_build_object('status', 'place_open');
end $$;

-- ───────────────────────── B 모드: 제출·확정 ─────────────────────────

-- 칸 시작 시각이 조사 날짜·범위 안이고 30분 칸 경계에 맞는지 검사하는 도우미
create or replace function private.slot_in_survey(p_meeting_id uuid, p_tz text, p_slot integer, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.schedule_survey_days d
    cross join lateral (
      select extract(epoch from (p_start - (d.day::timestamp at time zone p_tz))) / 60 as s,
             extract(epoch from (p_end - (d.day::timestamp at time zone p_tz))) / 60 as e
    ) mm
    where d.meeting_id = p_meeting_id
      and d.day = (p_start at time zone p_tz)::date
      and mm.s >= d.start_minute and mm.e <= d.end_minute
      and mod(mm.s - d.start_minute, p_slot) = 0 and mod(mm.e - d.start_minute, p_slot) = 0
  );
$$;
revoke all on function private.slot_in_survey(uuid, text, integer, timestamptz, timestamptz) from public, anon, authenticated;

-- 가능한 칸 전체를 교체 저장한다. 빈 배열 = "가능한 시간 없음"으로 응답 완료.
create or replace function public.submit_grid(p_meeting_id uuid, p_slots timestamptz[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
  v_slots timestamptz[];
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found then raise exception '모임을 찾을 수 없어요.'; end if;
  select id into v_pid from public.participants where meeting_id = p_meeting_id and user_id = v_uid;
  if v_pid is null then raise exception '이 기기는 이 모임의 참가자로 연결돼 있지 않아요. 개인 초대 링크로 들어와 주세요.'; end if;
  if v_m.status <> 'schedule_open' then raise exception '일정이 이미 확정돼서 응답을 바꿀 수 없어요.'; end if;
  if v_m.schedule_mode <> 'grid' then raise exception '이 모임은 시간 후보 방식이에요. 화면을 새로고침해 주세요.'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_slots from unnest(coalesce(p_slots, '{}')) x;
  if cardinality(v_slots) > 14 * 32 then raise exception '고른 칸이 너무 많아요.'; end if;
  if exists (select 1 from unnest(v_slots) x
             where not private.slot_in_survey(p_meeting_id, v_m.timezone, v_m.slot_minutes, x, x + make_interval(mins => v_m.slot_minutes))) then
    raise exception '조사 범위 밖이거나 30분 칸에 맞지 않는 시간이 있어요.';
  end if;

  insert into public.schedule_submissions (meeting_id, participant_id) values (p_meeting_id, v_pid)
    on conflict (meeting_id, participant_id) do update set updated_at = now();
  delete from public.grid_availability where meeting_id = p_meeting_id and participant_id = v_pid;
  insert into public.grid_availability (meeting_id, participant_id, slot_start)
    select p_meeting_id, v_pid, x from unnest(v_slots) x;
  return jsonb_build_object('participant_id', v_pid, 'selected', cardinality(v_slots));
end $$;

-- 주최자가 같은 날짜 안의 연속 구간을 확정한다.
create or replace function public.confirm_grid(p_meeting_id uuid, p_start timestamptz, p_end timestamptz, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 일정을 확정할 수 있어요.'; end if;
  if v_m.status <> 'schedule_open' then raise exception '일정은 이미 확정됐어요.'; end if;
  if v_m.schedule_mode <> 'grid' then raise exception '이 모임은 시간 후보 방식이에요. 화면을 새로고침해 주세요.'; end if;
  if v_m.version <> p_expected_version then raise exception '그사이 모임 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception '확정할 시작·끝 시간을 골라 주세요.'; end if;
  if not private.slot_in_survey(p_meeting_id, v_m.timezone, v_m.slot_minutes, p_start, p_end) then
    raise exception '조사한 날짜·시간 범위 안에서 30분 단위로 골라 주세요.';
  end if;
  update public.meetings
     set status = 'place_open', selected_start = p_start, selected_end = p_end, version = version + 1, updated_at = now()
   where id = p_meeting_id;
  return jsonb_build_object('status', 'place_open');
end $$;

-- ───────────────────────── 장소 후보 v2 (지도 검색 결과 포함) ─────────────────────────
-- p_place = {provider:'kakao', provider_place_id, address, road_address, category, latitude, longitude, detail_url} 또는 null
create or replace function public.add_place_candidate_v2(p_meeting_id uuid, p_kind text, p_name text, p_map_url text, p_place jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_url text := nullif(btrim(coalesce(p_map_url, '')), '');
  v_provider text := nullif(p_place ->> 'provider', '');
  v_ext_id text := nullif(p_place ->> 'provider_place_id', '');
  v_detail text := nullif(btrim(coalesce(p_place ->> 'detail_url', '')), '');
  v_lat double precision := nullif(p_place ->> 'latitude', '')::double precision;
  v_lng double precision := nullif(p_place ->> 'longitude', '')::double precision;
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
  if v_provider is not null then
    if v_provider <> 'kakao' or v_ext_id is null or v_lat is null or v_lng is null then
      raise exception '지도 검색 결과에서 고른 장소만 위치를 저장할 수 있어요.';
    end if;
    if exists (select 1 from public.place_candidates
               where meeting_id = p_meeting_id and kind = p_kind and provider = v_provider and provider_place_id = v_ext_id) then
      raise exception '이미 후보에 있는 장소예요. 그 후보에 투표해 주세요.';
    end if;
  end if;
  if exists (select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind and name = v_name) then
    raise exception '같은 이름의 후보가 이미 있어요.';
  end if;
  if (select count(*) from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind) >= 10 then
    raise exception '분류마다 후보는 10개까지 올릴 수 있어요.';
  end if;

  insert into public.place_candidates (meeting_id, kind, name, map_url, created_by_participant_id,
      provider, provider_place_id, address, road_address, category, latitude, longitude, detail_url)
    values (p_meeting_id, p_kind, v_name, coalesce(v_url, v_detail), v_pid,
      v_provider, v_ext_id, nullif(p_place ->> 'address', ''), nullif(p_place ->> 'road_address', ''),
      nullif(p_place ->> 'category', ''), v_lat, v_lng, v_detail)
    returning id into v_id;
  return v_id;
end $$;

-- 기존 함수는 같은 인자로 계속 동작한다(링크만 있는 후보).
create or replace function public.add_place_candidate(p_meeting_id uuid, p_kind text, p_name text, p_map_url text)
returns uuid language sql security definer set search_path = '' as $$
  select public.add_place_candidate_v2(p_meeting_id, p_kind, p_name, p_map_url, null);
$$;

-- ───────────────────────── 실행 권한 ─────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_meeting_v2(text, text[], integer, text, jsonb, jsonb)',
    'public.create_meeting(text, text[], integer, jsonb)',
    'public.submit_schedule(uuid, uuid[])',
    'public.confirm_schedule(uuid, uuid, integer)',
    'public.submit_grid(uuid, timestamptz[])',
    'public.confirm_grid(uuid, timestamptz, timestamptz, integer)',
    'public.add_place_candidate_v2(uuid, text, text, text, jsonb)',
    'public.add_place_candidate(uuid, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
