-- 모이딱 006: 장소 유형 6종 · 집결지 · 여러 방문지(순서·시간) · 장소 먼저 정하기 · 식당 필수 해제
-- 001~005 를 실행한 DB 에 SQL Editor 로 실행한다. 여러 번 실행해도 안전하다.
-- 기존 행은 지우거나 바꾸지 않는다. 장소 분류 제약은 '넓히기만' 한다(기존 restaurant·cafe 행은 그대로 통과).
-- 기존 함수(add_place_candidate(_v2), submit_place, finalize_meeting, final_places)는 그대로 두어 옛 화면·옛 약속과 호환한다.
--
-- 분류: meeting_point 집결지 · restaurant 식당 · cafe 카페 · activity 놀거리 · attraction 관광지 · etc 기타

-- ───────────────────────── 분류 확장 ─────────────────────────
do $$
begin
  alter table public.place_candidates drop constraint if exists place_candidates_kind_check;
  alter table public.place_candidates add constraint place_candidates_kind_check
    check (kind in ('meeting_point', 'restaurant', 'cafe', 'activity', 'attraction', 'etc'));
  alter table public.place_submissions drop constraint if exists place_submissions_kind_check;
  alter table public.place_submissions add constraint place_submissions_kind_check
    check (kind in ('meeting_point', 'restaurant', 'cafe', 'activity', 'attraction', 'etc'));
end $$;

create or replace function private.valid_place_kind(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p in ('meeting_point', 'restaurant', 'cafe', 'activity', 'attraction', 'etc');
$$;

-- ───────────────────────── 방문 일정(최종 장소 순서) ─────────────────────────
alter table public.meetings add column if not exists place_skipped boolean not null default false;

create table if not exists public.itinerary_stops (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  sort_order integer not null check (sort_order between 1 and 10),
  kind text not null check (kind in ('meeting_point', 'restaurant', 'cafe', 'activity', 'attraction', 'etc')),
  candidate_id uuid,
  name text not null check (char_length(name) between 1 and 40),
  address text check (address is null or char_length(address) <= 200),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  map_url text check (map_url is null or (char_length(map_url) <= 500 and map_url ~* '^https?://[^[:space:]<>"]+$')),
  planned_time timestamptz,
  note text check (note is null or char_length(note) <= 100),
  created_at timestamptz not null default now(),
  unique (meeting_id, sort_order),
  foreign key (meeting_id, candidate_id) references public.place_candidates(meeting_id, id) on delete set null (candidate_id)
);

alter table public.itinerary_stops enable row level security;
revoke all on table public.itinerary_stops from anon, authenticated;
grant select on table public.itinerary_stops to authenticated;
drop policy if exists itinerary_stops_member_read on public.itinerary_stops;
create policy itinerary_stops_member_read on public.itinerary_stops for select to authenticated using (private.is_member(meeting_id));

-- ───────────────────────── RPC ─────────────────────────

-- 장소 후보 추가 v3: 6개 분류. 같은 분류의 투표가 시작되면 그 분류만 잠긴다(기존 규칙과 같음).
create or replace function public.add_place_candidate_v3(p_meeting_id uuid, p_kind text, p_name text, p_map_url text, p_place jsonb)
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
  if v_pid is null and v_m.owner_user_id is distinct from v_uid then raise exception '이 약속 참여자만 후보를 올릴 수 있어요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정된 약속이에요.'; end if;
  if not private.valid_place_kind(p_kind) then raise exception '장소 분류를 다시 골라 주세요.'; end if;
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

-- 장소 선호 v2: 일정 확정 전에도 투표할 수 있다(장소부터 정하는 모임). 최종 확정 후에는 잠긴다.
create or replace function public.submit_place_v2(p_meeting_id uuid, p_kind text, p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found then raise exception '모임을 찾을 수 없어요.'; end if;
  select id into v_pid from public.participants where meeting_id = p_meeting_id and user_id = v_uid;
  if v_pid is null then raise exception '이 기기는 이 약속의 참여자로 연결돼 있지 않아요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정돼서 투표할 수 없어요.'; end if;
  if not private.valid_place_kind(p_kind) then raise exception '장소 분류를 다시 골라 주세요.'; end if;
  if not exists (select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind) then
    raise exception '이 분류에는 후보가 없어요.';
  end if;
  if p_candidate_id is not null and not exists (
    select 1 from public.place_candidates where meeting_id = p_meeting_id and kind = p_kind and id = p_candidate_id) then
    raise exception '이 약속의 후보가 아니에요.';
  end if;
  insert into public.place_submissions (meeting_id, participant_id, kind) values (p_meeting_id, v_pid, p_kind)
    on conflict (meeting_id, participant_id, kind) do update set updated_at = now();
  delete from public.place_votes where meeting_id = p_meeting_id and participant_id = v_pid and kind = p_kind;
  if p_candidate_id is not null then
    insert into public.place_votes (meeting_id, participant_id, kind, candidate_id) values (p_meeting_id, v_pid, p_kind, p_candidate_id);
  end if;
  return jsonb_build_object('participant_id', v_pid, 'kind', p_kind, 'candidate_id', p_candidate_id);
end $$;

-- 방문 일정 저장(주최자): 0~10곳, 순서·예정 시간·메모. 후보에서 고르거나(정보 복사) 직접 입력(집결지 등).
-- p_skip = true 이면 "장소 없이 진행"(방문지 없음).
create or replace function public.set_itinerary(p_meeting_id uuid, p_stops jsonb, p_skip boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_s jsonb;
  v_i integer := 0;
  v_c public.place_candidates%rowtype;
  v_kind text;
  v_name text;
  v_url text;
  v_note text;
  v_time timestamptz;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 방문 일정을 정할 수 있어요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정된 약속이에요.'; end if;
  if jsonb_typeof(coalesce(p_stops, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_stops, '[]'::jsonb)) > 10 then
    raise exception '방문 장소는 10곳까지예요.';
  end if;
  if coalesce(p_skip, false) and jsonb_array_length(coalesce(p_stops, '[]'::jsonb)) > 0 then
    raise exception '‘장소 없이 진행’을 고르면 방문 장소를 비워 주세요.';
  end if;

  delete from public.itinerary_stops where meeting_id = p_meeting_id;
  for v_s in select value from jsonb_array_elements(coalesce(p_stops, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_time := nullif(v_s ->> 'planned_time', '')::timestamptz;
    v_note := nullif(btrim(coalesce(v_s ->> 'note', '')), '');
    if nullif(v_s ->> 'candidate_id', '') is not null then
      select * into v_c from public.place_candidates where meeting_id = p_meeting_id and id = (v_s ->> 'candidate_id')::uuid;
      if not found then raise exception '이 약속의 장소 후보가 아니에요.'; end if;
      insert into public.itinerary_stops (meeting_id, sort_order, kind, candidate_id, name, address, latitude, longitude, map_url, planned_time, note)
        values (p_meeting_id, v_i, v_c.kind, v_c.id, v_c.name, coalesce(v_c.road_address, v_c.address), v_c.latitude, v_c.longitude,
                coalesce(v_c.detail_url, v_c.map_url), v_time, v_note);
    else
      v_kind := coalesce(nullif(v_s ->> 'kind', ''), 'meeting_point');
      v_name := btrim(coalesce(v_s ->> 'name', ''));
      v_url := nullif(btrim(coalesce(v_s ->> 'map_url', '')), '');
      if not private.valid_place_kind(v_kind) then raise exception '장소 분류를 다시 골라 주세요.'; end if;
      if char_length(v_name) not between 1 and 40 then raise exception '장소 이름은 1~40자로 적어 주세요.'; end if;
      if v_url is not null and (char_length(v_url) > 500 or v_url !~* '^https?://[^[:space:]<>"]+$') then
        raise exception '지도 링크는 http:// 또는 https:// 로 시작하는 주소만 돼요.';
      end if;
      insert into public.itinerary_stops (meeting_id, sort_order, kind, name, address, map_url, planned_time, note)
        values (p_meeting_id, v_i, v_kind, v_name, nullif(btrim(coalesce(v_s ->> 'address', '')), ''), v_url, v_time, v_note);
    end if;
  end loop;
  update public.meetings set place_skipped = coalesce(p_skip, false), updated_at = now() where id = p_meeting_id;
  return jsonb_build_object('stops', v_i, 'skipped', coalesce(p_skip, false));
end $$;

-- 최종 확정 v2(주최자): 일정 확정만 필수. 장소는 0곳이어도 된다(식당 필수 해제).
create or replace function public.finalize_meeting_v2(p_meeting_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
begin
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from v_uid then raise exception '주최자만 최종 확정할 수 있어요.'; end if;
  if v_m.status = 'finalized' then raise exception '이미 최종 확정됐어요.'; end if;
  if v_m.selected_start is null then raise exception '일정을 먼저 확정해 주세요. 장소는 없어도 돼요.'; end if;
  if v_m.version <> p_expected_version then raise exception '그사이 약속 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.'; end if;
  update public.meetings set status = 'finalized', finalized_at = now(), version = version + 1, updated_at = now() where id = p_meeting_id;
  return jsonb_build_object('status', 'finalized', 'stops', (select count(*) from public.itinerary_stops where meeting_id = p_meeting_id));
end $$;

revoke all on function private.valid_place_kind(text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.add_place_candidate_v3(uuid, text, text, text, jsonb)',
    'public.submit_place_v2(uuid, text, uuid)',
    'public.set_itinerary(uuid, jsonb, boolean)',
    'public.finalize_meeting_v2(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
