-- 2026-11-08 사용자 승인으로 실행(SQL Editor). 007(속도 제한 함수) 실행 후. 여러 번 실행해도 안전.
-- 모이딱 010 (C2): 일회성 약속 — 이름 미리 입력 없이 만들고, 참여 링크로 각자 '참여하기'.
--
-- 정책(결정서 2장)
--   · 참여 인원 상한 30명 = 실제 참여자(participants 행) 기준. 주최자가 참석하지 않으면 주최자는 참여자 행이 없고 정원에 안 들어간다.
--   · 주최자 권한(meetings.owner_user_id·관리자 복구 토큰)과 참석 대상(participants)은 별개 — 불참 주최자도 관리·확정·링크 회수 가능.
--   · 링크를 열기만 해서는 참여자가 생기지 않는다(미리보기 = 제목·상태만). '참여하기'에서 이름을 받아 행 생성.
--   · 같은 기기 재방문·연타·동시 요청 → 기존 행 반환(participants unique(meeting_id, user_id)), 정원 초과 없음(약속 행 잠금).
--   · 일정이 최종 확정(finalized)된 뒤에는 새로 참여할 수 없다. 링크 회수·만료(기본 14일, 개인 초대와 같음) 후 신규 참여 거부, 기존 참여자 유지.
--   · 참여자 '빼기' 기능은 지금 없음(명단 변경 불가 정책 유지) → 강제 제거 후 재참여 정책은 해당 기능을 만들 때 정한다.
--   · 기존 명단형 약속(create_meeting / create_meeting_v2)·개인 초대 토큰·주최자 복구 링크는 변경 없음. 모임방 공용 링크와 별도 표·별도 토큰.
-- 바뀌는 것(추가형): 새 표 1개(private), meetings 칸 2개, 함수 5개. 데이터 삭제 없음.
-- 되돌리기: 함수 drop(기존 약속·참여자는 그대로 일반 약속으로 동작). 링크 표는 남기거나 모두 revoked 처리.

alter table public.meetings add column if not exists join_mode text not null default 'roster' check (join_mode in ('roster', 'link'));
alter table public.meetings add column if not exists participant_cap integer not null default 30 check (participant_cap between 1 and 30);

create table if not exists private.meeting_join_links (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists meeting_join_links_one_active on private.meeting_join_links (meeting_id) where revoked_at is null;
revoke all on table private.meeting_join_links from public, anon, authenticated;

create or replace function private.issue_meeting_join_link(p_meeting_id uuid)
returns text language plpgsql volatile set search_path = '' as $$
declare v_token text := private.new_token();
begin
  update private.meeting_join_links set revoked_at = now() where meeting_id = p_meeting_id and revoked_at is null;
  insert into private.meeting_join_links (meeting_id, token_hash, expires_at) values (p_meeting_id, private.hash_token(v_token), now() + interval '14 days');
  return v_token;
end $$;
revoke all on function private.issue_meeting_join_link(uuid) from public, anon, authenticated;

-- 링크 참여형 약속 만들기. p_my_name 이 비어 있으면 주최자는 참석하지 않음(관리만).
create or replace function public.create_meeting_open(p_title text, p_my_name text, p_mode text, p_times jsonb, p_days jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_me text := nullif(btrim(coalesce(p_my_name, '')), '');
  v_mode text := coalesce(p_mode, 'poll');
  v_meeting_id uuid;
  v_host_pid uuid;
  v_admin text := private.new_token();
  v_t jsonb; v_start timestamptz; v_end timestamptz; v_s integer; v_e integer; v_i integer;
begin
  if char_length(v_title) not between 1 and 60 then raise exception '약속 이름은 1~60자로 적어 주세요.'; end if;
  if v_mode not in ('poll', 'grid') then raise exception '일정 정하는 방법을 골라 주세요.'; end if;
  if v_me is not null and char_length(v_me) > 20 then raise exception '내 이름은 20자까지예요.'; end if;
  -- 후보 검사는 create_meeting_v2 와 같은 규칙
  if v_mode = 'poll' then
    if jsonb_typeof(p_times) is distinct from 'array' or jsonb_array_length(p_times) not between 1 and 8 then raise exception '시간 후보는 1~8개로 정해 주세요.'; end if;
    if (select count(distinct (e ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_times) e) <> jsonb_array_length(p_times) then raise exception '같은 시작 시간이 두 번 있어요.'; end if;
  else
    if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) not between 1 and 14 then raise exception '조사할 날짜는 1~14일로 골라 주세요.'; end if;
    if (select count(distinct (e ->> 'day')::date) from jsonb_array_elements(p_days) e) <> jsonb_array_length(p_days) then raise exception '같은 날짜가 두 번 있어요.'; end if;
  end if;

  insert into public.meetings (title, owner_user_id, schedule_mode, join_mode) values (v_title, v_uid, v_mode, 'link') returning id into v_meeting_id;
  if v_me is not null then
    insert into public.participants (meeting_id, display_name, sort_order, user_id) values (v_meeting_id, v_me, 1, v_uid) returning id into v_host_pid;
    update public.meetings set host_participant_id = v_host_pid where id = v_meeting_id;
  end if;

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
      v_s := (v_t ->> 'start_minute')::integer; v_e := (v_t ->> 'end_minute')::integer;
      if v_s is null or v_e is null or v_s % 30 <> 0 or v_e % 30 <> 0 or v_s < 0 or v_e > 1440 or v_e <= v_s then
        raise exception '조사 시간은 30분 단위로, 끝이 시작보다 늦게 정해 주세요(자정 넘김 불가).';
      end if;
      if v_e - v_s > 16 * 60 then raise exception '하루 조사 범위는 16시간(32칸)까지예요.'; end if;
      insert into public.schedule_survey_days (meeting_id, day, start_minute, end_minute) values (v_meeting_id, (v_t ->> 'day')::date, v_s, v_e);
    end loop;
  end if;

  insert into private.admin_tokens (meeting_id, token_hash) values (v_meeting_id, private.hash_token(v_admin));
  return jsonb_build_object('meeting_id', v_meeting_id, 'admin_token', v_admin, 'join_token', private.issue_meeting_join_link(v_meeting_id));
end $$;

-- 주최자: 링크 새로 만들기(이전 링크 무효) / 끄기 / 상태(원문 없음)
create or replace function public.rotate_meeting_join_link(p_meeting_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_m public.meetings%rowtype;
begin
  perform private.require_uid();
  select * into v_m from public.meetings where id = p_meeting_id for update;
  if not found or v_m.owner_user_id is distinct from auth.uid() then raise exception '주최자만 참여 링크를 만들 수 있어요.'; end if;
  if v_m.status = 'finalized' then raise exception '최종 확정된 약속이라 새로 참여할 수 없어요.'; end if;
  return jsonb_build_object('token', private.issue_meeting_join_link(p_meeting_id));
end $$;

create or replace function public.revoke_meeting_join_link(p_meeting_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_uid();
  if not exists (select 1 from public.meetings where id = p_meeting_id and owner_user_id = auth.uid()) then raise exception '주최자만 링크를 끌 수 있어요.'; end if;
  update private.meeting_join_links set revoked_at = now() where meeting_id = p_meeting_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- 받는 사람: 미리보기(제목·상태만) — 참여자 이름·후보·응답 없음
create or replace function public.preview_meeting_join_link(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_uid(); l private.meeting_join_links%rowtype; m public.meetings%rowtype;
begin
  perform private.join_rate_check(v_uid);
  select * into l from private.meeting_join_links where token_hash = private.hash_token(p_token);
  if not found then perform private.join_fail(v_uid); return jsonb_build_object('state', 'invalid'); end if;
  select * into m from public.meetings where id = l.meeting_id;
  if exists (select 1 from public.participants p where p.meeting_id = m.id and p.user_id = v_uid) or m.owner_user_id = v_uid then
    return jsonb_build_object('state', 'member', 'meeting_id', m.id, 'title', m.title);
  end if;
  return jsonb_build_object('title', m.title, 'state',
    case when l.revoked_at is not null then 'revoked' when l.expires_at < now() then 'expired'
         when m.status = 'finalized' then 'closed'
         when (select count(*) from public.participants p where p.meeting_id = m.id) >= m.participant_cap then 'full'
         else 'ok' end);
end $$;

create or replace function public.join_meeting_with_link(p_token text, p_display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  l private.meeting_join_links%rowtype; m public.meetings%rowtype; v_pid uuid;
begin
  perform private.join_rate_check(v_uid);
  select * into l from private.meeting_join_links where token_hash = private.hash_token(p_token) for update;
  if not found then perform private.join_fail(v_uid); return jsonb_build_object('state', 'invalid'); end if;
  select * into m from public.meetings where id = l.meeting_id for update;      -- 정원·중복을 약속 단위로 줄 세움
  select p.id into v_pid from public.participants p where p.meeting_id = m.id and p.user_id = v_uid;
  if found then return jsonb_build_object('meeting_id', m.id, 'participant_id', v_pid, 'already', true); end if;
  if l.revoked_at is not null then raise exception '이 참여 링크는 꺼졌어요. 주최자에게 새 링크를 받아 주세요.'; end if;
  if l.expires_at < now() then raise exception '참여 링크가 만료됐어요. 주최자에게 새 링크를 받아 주세요.'; end if;
  if m.status = 'finalized' then raise exception '이미 최종 확정된 약속이라 새로 참여할 수 없어요.'; end if;
  if (select count(*) from public.participants p where p.meeting_id = m.id) >= m.participant_cap then raise exception '참여 인원(최대 %명)이 다 찼어요.', m.participant_cap; end if;
  if char_length(v_name) not between 1 and 20 then raise exception '이름을 1~20자로 적어 주세요.'; end if;
  if exists (select 1 from public.participants p where p.meeting_id = m.id and lower(p.display_name) = lower(v_name)) then
    raise exception '이 약속에 같은 이름이 있어요. 다른 이름으로 적어 주세요.';
  end if;
  insert into public.participants (meeting_id, display_name, sort_order, user_id)
    values (m.id, v_name, coalesce((select max(sort_order) from public.participants where meeting_id = m.id), 0) + 1, v_uid)
    returning id into v_pid;
  update private.meeting_join_links set use_count = use_count + 1 where id = l.id;
  return jsonb_build_object('meeting_id', m.id, 'participant_id', v_pid, 'already', false);
exception when unique_violation then
  select p.id into v_pid from public.participants p where p.meeting_id = l.meeting_id and p.user_id = v_uid;
  if v_pid is not null then return jsonb_build_object('meeting_id', l.meeting_id, 'participant_id', v_pid, 'already', true); end if;
  raise exception '이 약속에 같은 이름이 있어요. 다른 이름으로 적어 주세요.';
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_meeting_open(text, text, text, jsonb, jsonb)', 'public.rotate_meeting_join_link(uuid)', 'public.revoke_meeting_join_link(uuid)',
    'public.preview_meeting_join_link(text)', 'public.join_meeting_with_link(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 확인함(실행 전): 기존 create_meeting_v2 도 주최자 불참(host_participant_id null)을 허용하고, 확정·장소 RPC 의 주최자 판정은 owner_user_id 기준.
-- 검증(tests/c2_meeting_link.mjs): 주최자 불참 생성, 미리보기로 참여자 안 생김, 명시적 참여, 재방문·동시 5회 1행, 30명 상한(31번째 거부),
--   회수·만료 후 거부·기존 참여자 유지, 확정 후 참여 거부, A/B 응답 저장, 다른 약속 id 우회 불가, 기존 명단형 약속·개인 링크 회귀.
