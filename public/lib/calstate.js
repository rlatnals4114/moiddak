// 캘린더 항목 상태(순수 함수, my_calendar 결과 한 건 기준). 화면: screens/CalendarPage.js · 홈.
// - 일정 상태: 'fixed' 확정(selected_start 있음) · 'cand' 미확정 후보
// - 행동 상태 needsMe: 내가 참여자이고, 일정 응답을 아직 안 했고, 지금도 응답할 수 있을 때만(조율 중 + 끝나지 않은 후보가 남음)
//   → 이미 응답했거나 조율이 끝났거나 후보가 모두 지난 약속에는 '응답 필요'를 붙이지 않는다.
export const scheduleState = (it) => (it.selected_start ? 'fixed' : 'cand');

// opts.now 는 테스트용. (배열 filter 에 바로 넘겨도 되도록 두 번째 인자는 객체만 받는다)
export function needsMe(it, opts) {
  const now = opts && typeof opts === 'object' && opts.now ? opts.now : Date.now();
  if (!it.i_participate || it.my_state !== 'pending' || it.status !== 'schedule_open') return false;
  const c = it.candidates || [];
  if (!c.length) return true; // 후보 시각을 알 수 없는 방식(시간표 등)은 조율 중이면 응답 가능
  return c.some((x) => Date.parse(x.end || x.start) > now);
}
