-- 2026-11-08 사용자 승인으로 실행(SQL Editor). 여러 번 실행해도 안전.
-- 모이딱 011 (B1): 확정된 약속의 참석 확인(RSVP) — 일정 투표와 완전히 별개.
--
-- 정책(결정서 B1·8장)
--   · 4상태: 참석(yes) / 불참(no) / 미정(maybe) / 미응답(행 없음). 미정과 미응답은 절대 합치지 않는다.
--   · 묻는 시점: 날짜·시간이 확정된 뒤(meetings.selected_start 있음). 장소가 미정·생략이어도 가능.
--   · 일정 투표에서 '가능'을 골랐다고 자동 참석 처리하지 않는다(기존 데이터 이관 없음 → 모두 미응답에서 시작).
--   · 응답 대상: 그 약속의 참여자(participants)만, 본인 것만 저장. 주최자가 불참(참여자 아님)이면 RSVP 대상 아님.
--   · 회차(schedule_round): 장소만 바뀌면 그대로(응답 유지), 확정 날짜·시간이 바뀌면 +1 → 새 회차는 전원 미응답, 이전 회차 응답은 이력으로 남음.
--     (지금은 확정 후 날짜를 바꾸는 기능이 없음. B2 재조율이 생기면 이 트리거가 자동으로 회차를 올린다.)
--   · 읽기: 같은 약속의 참여자·주최자(기존 private.is_member). 다른 사람에게는 노출 안 됨.
-- 바뀌는 것(추가형): meetings 칸 1개, 새 표 1개(RLS 읽기 전용), 트리거 1개, 함수 1개. 데이터 삭제 없음.
-- 되돌리기: 함수·트리거 drop(표는 남겨 둠, 화면은 RSVP 영역을 숨김).

alter table public.meetings add column if not exists schedule_round integer not null default 1;

create table if not exists public.meeting_rsvps (
  meeting_id uuid not null,
  participant_id uuid not null,
  round integer not null,
  status text not null check (status in ('yes', 'no', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (participant_id, round),
  foreign key (meeting_id, participant_id) references public.participants (meeting_id, id) on delete cascade
);
create index if not exists meeting_rsvps_meeting_round on public.meeting_rsvps (meeting_id, round);
alter table public.meeting_rsvps enable row level security;
revoke all on table public.meeting_rsvps from anon, authenticated;
grant select on table public.meeting_rsvps to authenticated;
drop policy if exists meeting_rsvps_member_read on public.meeting_rsvps;
create policy meeting_rsvps_member_read on public.meeting_rsvps for select to authenticated using (private.is_member(meeting_id));

-- 확정 날짜·시간이 바뀌면 회차 +1(처음 확정은 1회차 그대로)
create or replace function private.meetings_bump_round()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.selected_start is not null
     and (new.selected_start is distinct from old.selected_start or new.selected_end is distinct from old.selected_end) then
    new.schedule_round := old.schedule_round + 1;
  end if;
  return new;
end $$;
drop trigger if exists meetings_bump_round on public.meetings;
create trigger meetings_bump_round before update of selected_start, selected_end on public.meetings
  for each row execute function private.meetings_bump_round();
revoke all on function private.meetings_bump_round() from public, anon, authenticated;

-- 내 참석 여부 저장/지우기(p_status null = 미응답으로 되돌리기)
create or replace function public.set_my_rsvp(p_meeting_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_m public.meetings%rowtype;
  v_pid uuid;
begin
  select * into v_m from public.meetings where id = p_meeting_id for share;
  if not found then raise exception '약속을 찾을 수 없어요.'; end if;
  if v_m.selected_start is null then raise exception '날짜·시간이 확정된 뒤에 참석 여부를 알려 줄 수 있어요.'; end if;
  select id into v_pid from public.participants where meeting_id = p_meeting_id and user_id = v_uid;
  if v_pid is null then raise exception '이 약속에 초대된 사람만 참석 여부를 알려 줄 수 있어요.'; end if;
  if p_status is null then
    delete from public.meeting_rsvps where participant_id = v_pid and round = v_m.schedule_round;
  elsif p_status not in ('yes', 'no', 'maybe') then
    raise exception '참석·불참·미정 중에서 골라 주세요.';
  else
    insert into public.meeting_rsvps (meeting_id, participant_id, round, status) values (p_meeting_id, v_pid, v_m.schedule_round, p_status)
      on conflict (participant_id, round) do update set status = excluded.status, updated_at = now();
  end if;
  return jsonb_build_object('round', v_m.schedule_round, 'status', p_status);
end $$;
revoke all on function public.set_my_rsvp(uuid, text) from public, anon;
grant execute on function public.set_my_rsvp(uuid, text) to authenticated;

-- 화면: meetings.schedule_round 와 같은 round 의 행만 '현재 참석 여부'로 센다. 행 없는 참여자 = 미응답.
-- 검증(tests/b1_rsvp.mjs): 4명 초대·1명 투표·0명 RSVP → 미응답 4, 4상태 저장·변경·미응답으로 되돌리기, 남의 RSVP 저장 불가(본인 행만),
--   확정 전 거부, 비참여자 거부, 직접 insert/update 거부(RLS), 다른 약속 참여자에게 0행, 장소 변경 후 유지, selected_start 변경 시 회차 +1·새 회차 미응답.
