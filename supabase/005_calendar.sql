-- 모이딱 005: 통합 캘린더(내 약속만)
-- 001~004 를 실행한 DB 에 SQL Editor 로 실행한다. 함수 1개만 추가하며 표·행·기존 함수는 바꾸지 않는다.
--
-- my_calendar(p_from, p_to): 호출한 사람이 '참여자'이거나 '주최자'인 약속만 돌려준다.
--   · 다른 사람의 이름·응답·장소는 넣지 않는다(내 응답 상태와 내가 고른 후보만).
--   · 특정 사용자의 캘린더를 조회하는 인자는 없다 — 항상 auth.uid() 본인 것만.
-- 항목: id, title, group(id·name·theme), status, mode, selected_start/end, i_host, i_participate,
--       my_state('pending' 미응답 | 'done' 응답 | 'none' 가능 시간 없음 | null 참여 안 함),
--       candidates: 확정 전 후보 [{start, end, mine}] — A: 시간 후보(내가 가능으로 고른 것 mine=true)
--                   B: 조사 날짜의 범위(mine=false) + 내가 고른 칸을 이은 구간(mine=true)

create or replace function public.my_calendar(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception '조회 기간을 다시 정해 주세요(최대 400일).';
  end if;
  return coalesce((
    select jsonb_agg(item order by sort_key)
    from (
      select
        coalesce(mt.selected_start, cand.first_start, mt.created_at) as sort_key,
        jsonb_build_object(
          'id', mt.id,
          'title', mt.title,
          'group', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name, 'theme', g.theme) end,
          'status', mt.status,
          'mode', mt.schedule_mode,
          'selected_start', mt.selected_start,
          'selected_end', mt.selected_end,
          'i_host', mt.owner_user_id = v_uid,
          'i_participate', p.id is not null,
          'my_state', case
              when p.id is null then null
              when s.participant_id is null then 'pending'
              when mt.schedule_mode = 'grid' and not exists (select 1 from public.grid_availability ga where ga.participant_id = p.id) then 'none'
              when mt.schedule_mode = 'poll' and not exists (select 1 from public.availability_choices ac where ac.participant_id = p.id) then 'none'
              else 'done' end,
          'candidates', case when mt.selected_start is not null then '[]'::jsonb else cand.list end
        ) as item
      from public.meetings mt
      left join public.participants p on p.meeting_id = mt.id and p.user_id = v_uid
      left join public.schedule_submissions s on s.participant_id = p.id
      -- 모임방 이름은 내가 그 모임방의 현재 멤버일 때만 보여 준다(빠진 모임방 이름 노출 방지)
      left join public.groups g on g.id = mt.group_id and exists (
        select 1 from public.group_members gm where gm.group_id = g.id and gm.user_id = v_uid and gm.removed_at is null)
      cross join lateral (
        select min(c.st) as first_start,
               coalesce(jsonb_agg(jsonb_build_object('start', c.st, 'end', c.en, 'mine', c.mine) order by c.st, c.mine), '[]'::jsonb) as list
        from (
          -- A 모드 시간 후보
          select t.starts_at as st, coalesce(t.ends_at, t.starts_at + interval '1 hour') as en,
                 exists (select 1 from public.availability_choices ac where ac.participant_id = p.id and ac.time_option_id = t.id) as mine
            from public.time_options t
           where t.meeting_id = mt.id and mt.schedule_mode = 'poll'
          union all
          -- B 모드 조사 날짜 범위
          select (d.day::timestamp at time zone mt.timezone) + make_interval(mins => d.start_minute),
                 (d.day::timestamp at time zone mt.timezone) + make_interval(mins => d.end_minute), false
            from public.schedule_survey_days d
           where d.meeting_id = mt.id and mt.schedule_mode = 'grid'
          union all
          -- B 모드 내가 고른 칸을 이어 붙인 구간
          select min(x.slot_start), max(x.slot_start) + make_interval(mins => mt.slot_minutes), true
            from (select ga.slot_start,
                         ga.slot_start - make_interval(mins => mt.slot_minutes * (row_number() over (order by ga.slot_start))::integer) as grp
                    from public.grid_availability ga where ga.participant_id = p.id and mt.schedule_mode = 'grid') x
           group by x.grp
        ) c
        where c.en > p_from and c.st < p_to
      ) cand
      where (p.id is not null or mt.owner_user_id = v_uid)
        and (
          (mt.selected_start is not null and coalesce(mt.selected_end, mt.selected_start + interval '1 hour') > p_from and mt.selected_start < p_to)
          or (mt.selected_start is null and jsonb_array_length(cand.list) > 0)
        )
    ) r
  ), '[]'::jsonb);
end $$;

revoke all on function public.my_calendar(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_calendar(timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
