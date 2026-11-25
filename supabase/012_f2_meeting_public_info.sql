-- 2026-11-08 사용자 승인으로 실행(SQL Editor). 여러 번 실행해도 안전(함수 교체만).
-- 모이딱 012 (F2): 약속 주소(ID)만 아는 사람에게 약속 제목을 주지 않는다.
--
-- 문제(검수 2026-11-08): public.meeting_public_info(001) 가 로그인한 누구에게나 약속 제목을 준다.
--   → 초대받지 않은 사람·참여 대상이 아닌 모임방 멤버가 약속 주소를 열면 제목이 보인다.
--   → B4 결정 “미대상 멤버는 목록과 **직접 URL 모두**에서 볼 수 없다”와 어긋남.
-- 바뀐 뒤: 그 약속의 참여자·주최자(private.is_member)에게만 제목을 주고, 그 밖에는 null(약속이 있는지도 알리지 않음).
--   · 참여자·주최자는 원래 상세를 볼 수 있으므로 이 함수가 필요 없다(화면은 상세를 먼저 읽고, 못 읽을 때만 이 함수를 부른다).
--   · 개인 초대 링크(?invite=)·참여 링크(#/join-m)·주최자 복구 링크는 이 함수와 무관하게 그대로 동작한다
--     (초대 수락 → 참여자가 된 뒤 상세를 읽음. 참여 링크 미리보기는 010 의 preview_meeting_join_link 가 제목을 준다 — 토큰 소지자만).
-- 바뀌는 것: 함수 1개 교체(시그니처·권한 동일). 표·행·RLS 변경 없음, 데이터 삭제 없음.
-- 화면: 제목이 없으면 “이 약속을 찾을 수 없거나 볼 권한이 없어요 + 받은 초대 링크를 열어 주세요”(이미 배포된 앱도 제목 없음 분기에서 같은 취지로 동작).
-- 되돌리기: 001_moiddak.sql 의 meeting_public_info 정의 재실행.
-- 별도 결정 필요(이번 파일에 포함 안 함): group_public_info(004)도 모임방 ID 를 아는 누구에게나 모임방 이름·테마를 준다.
--   모임방 초대 화면은 007/009 의 preview_group_join_link(토큰 필요)를 쓰므로, 같은 방식으로 막을 수 있다.

create or replace function public.meeting_public_info(p_meeting_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_member(m.id) then jsonb_build_object('title', m.title) end
  from public.meetings m where m.id = p_meeting_id;
$$;

-- 실행 권한은 001 에서 준 그대로(authenticated). 시그니처가 같아 다시 줄 필요 없음.

-- 검증(승인 후): tests/acceptance.mjs A11 · tests/security.mjs S09 기대값을 ‘외부인 → null’ 로 바꾸고,
--   tests/b4_visibility.mjs 에 B4-7(미대상 모임방 멤버·외부인 meeting_public_info → null, 참여자 → 제목) 추가.
