-- 2026-11-08 사용자 승인으로 실행(SQL Editor). 여러 번 실행해도 안전(함수 교체만).
-- 모이딱 008 (B4): 모임방 약속 목록 '기본 비공개' — 일반 멤버는 내가 참여자이거나 주최자인 약속만 목록에서 본다.
-- 바뀌는 것: 함수 2개 교체(public.group_overview, public.my_groups). 표·행·RLS 정책 변경 없음, 데이터 삭제 없음.
--
-- 현재(004): group_overview 가 모임방의 모든 약속 제목·상태·날짜를 멤버 전원에게, my_groups 가 '다음 약속' 제목과
--            진행 중 약속 수를 멤버 전원 기준으로 준다. (약속 상세·응답·장소는 이미 RLS 로 참여자·주최자만)
-- 바뀐 뒤:
--   · 일반 멤버: meetings 목록 = 내가 참여자(participants.user_id = 나)이거나 주최자(owner)인 약속만.
--   · 모임방 관리자: 운영을 위해 모임방의 모든 약속 '제목·상태·일시'만(참여자·응답·장소·투표 없음, counts 없음) + admin_view 표시.
--   · my_groups: next(다음 약속)·open_count 를 '나에게 보이는 약속' 기준으로.
--   · 직접 URL·API: meetings·participants·응답 표는 기존 RLS(private.is_member: 주최자 또는 참여자) 그대로 → 미대상 멤버 0행.
--   · 개인 캘린더(my_calendar, 005): 이미 '내가 참여자/주최자인 약속만' → 변경 없음.
-- 되돌리기: 004 의 두 함수 정의를 그대로 다시 실행(데이터 영향 없음).

create or replace function public.group_overview(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
  v_g public.groups%rowtype;
  v_admin boolean;
begin
  if not private.is_group_member(p_group_id) then raise exception '이 모임방 멤버만 볼 수 있어요.'; end if;
  v_admin := private.is_group_admin(p_group_id);
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
          'admin_view', mp.id is null and mt.owner_user_id is distinct from v_uid,   -- 관리자라서 보이는 항목(상세 열람 불가)
          'my_state', case when mp.id is null then null
                           when not exists (select 1 from public.schedule_submissions s where s.participant_id = mp.id) then 'pending'
                           when not exists (select 1 from public.availability_choices c where c.participant_id = mp.id)
                            and not exists (select 1 from public.grid_availability ga where ga.participant_id = mp.id) then 'none'
                           else 'done' end,
          'counts', case when mp.id is null and mt.owner_user_id is distinct from v_uid then null else jsonb_build_object(
              'total', (select count(*) from public.participants x where x.meeting_id = mt.id),
              'done', (select count(*) from public.schedule_submissions s where s.meeting_id = mt.id)) end
        ) as item
        from public.meetings mt
        left join public.participants mp on mp.meeting_id = mt.id and mp.user_id = v_uid
        where mt.group_id = p_group_id
          and (mp.id is not null or mt.owner_user_id = v_uid or v_admin)) r), '[]'::jsonb)
  );
end $$;

create or replace function public.my_groups()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'name', g.name, 'theme', g.theme, 'archived_at', g.archived_at, 'my_role', m.role,
      'members', (select jsonb_agg(jsonb_build_object('id', x.id, 'display_name', x.display_name, 'avatar', x.avatar, 'sort_order', x.sort_order, 'joined', x.user_id is not null) order by x.sort_order)
                    from public.group_members x where x.group_id = g.id and x.removed_at is null),
      'next', (select jsonb_build_object('id', mt.id, 'title', mt.title, 'selected_start', mt.selected_start)
                 from public.meetings mt
                 where mt.group_id = g.id and mt.selected_start > now()
                   and (mt.owner_user_id = m.user_id or exists (select 1 from public.participants p where p.meeting_id = mt.id and p.user_id = m.user_id))
                 order by mt.selected_start limit 1),
      'open_count', (select count(*) from public.meetings mt
                 where mt.group_id = g.id and mt.status <> 'finalized'
                   and (mt.owner_user_id = m.user_id or exists (select 1 from public.participants p where p.meeting_id = mt.id and p.user_id = m.user_id)))
    ) order by g.archived_at nulls first, g.updated_at desc), '[]'::jsonb)
  from public.groups g join public.group_members m on m.group_id = g.id
  where m.user_id = (select auth.uid()) and m.removed_at is null;
$$;

-- 실행 권한은 004 에서 준 그대로(함수 시그니처 동일).

-- 검증(승인 후 tests/b4_visibility.mjs 로): 미대상 일반 멤버 → group_overview·my_groups 에 그 약속 없음, meetings/participants 직접 조회 0행,
--   my_calendar 에 없음 / 참여 대상 멤버 → 보임·응답 가능 / 관리자 → 제목·상태·일시만(admin_view=true, counts=null), 상세 0행.
