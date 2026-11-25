// 집계·추천 규칙 단위 테스트: node tests/schedule.test.mjs
import assert from 'node:assert/strict';
import { buildGrid, recommend, derive, dayTone, progressSteps, participantStatus, segmentState, placeState, rsvpSummary } from '../public/lib/schedule.js';
import { kstISO, fmtRange, fmtRangeLong, toRanges, dayKey } from '../public/lib/time.js';
import { friendly } from '../public/lib/errors.js';

const P = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: `p${i}`, display_name: n, user_id: null, sort_order: i }));
const day = '2026-11-14';
const at = (pid, h, m) => ({ participant_id: pid, slot_start: kstISO(day, h * 60 + m) });
const survey = [{ day, start_minute: 17 * 60, end_minute: 21 * 60 }];
let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };

t('A 18:00·18:30, B 18:30·19:00 → 1시간 공통 구간 없음, 30분 교집합은 18:30', () => {
  const g = buildGrid(survey, [at('p0', 18, 0), at('p0', 18, 30), at('p1', 18, 30), at('p1', 19, 0)], P);
  assert.equal(recommend(g, 2).filter((w) => w.ids.length === 2).length, 0);
  const one = recommend(g, 1);
  assert.equal(one[0].ids.length, 2);
  assert.equal(one[0].startMinute, 18 * 60 + 30);
});

t('칸 개수와 칸별 가능 인원', () => {
  const g = buildGrid(survey, [at('p0', 18, 0), at('p1', 18, 0), at('p2', 18, 0)], P);
  assert.equal(g[0].slots.length, 8);
  assert.equal(g[0].slots.find((s) => s.minute === 1080).people.length, 3);
});

t('추천: 2시간(4칸) 모두 가능한 사람 기준, 많은 순', () => {
  const rows = [];
  for (const [h, m] of [[18, 0], [18, 30], [19, 0], [19, 30]]) { rows.push(at('p0', h, m), at('p1', h, m)); }
  rows.push(at('p2', 18, 0), at('p2', 18, 30), at('p2', 19, 0)); // C 는 19:30 불가 → 2시간 교집합에서 빠짐
  const r = recommend(buildGrid(survey, rows, P), 4);
  assert.equal(r[0].ids.length, 2);
  assert.equal(r[0].startMinute, 18 * 60);
  assert.equal(r[0].endMinute, 20 * 60);
});

t('미응답·가능 없음 구분(derive)', () => {
  const v = derive({
    meeting: { owner_user_id: 'u0', schedule_mode: 'grid' }, participants: P, times: [], choices: [],
    scheduleSubs: [{ participant_id: 'p0' }, { participant_id: 'p1' }], surveyDays: survey, gridRows: [at('p0', 18, 0)],
    candidates: [], placeSubs: [], votes: [], finals: [],
  }, 'u0');
  assert.deepEqual(v.schedDone.map((p) => p.display_name), ['A', 'B']);
  assert.deepEqual(v.schedNone.map((p) => p.display_name), ['B']);
  assert.equal(v.schedPending.length, 3);
});

t('시간 표기: KST, 24:00 끝', () => {
  assert.equal(fmtRange(kstISO(day, 18 * 60), kstISO(day, 20 * 60)), '11/14(토) 18:00~20:00');
  assert.equal(fmtRange(kstISO(day, 23 * 60), kstISO(day, 24 * 60)), '11/14(토) 23:00~24:00');
  assert.equal(dayKey(kstISO(day, 30)), day);
  assert.deepEqual(toRanges([1080, 1110, 1200]), [{ start: 1080, end: 1140 }, { start: 1200, end: 1230 }]);
});

t('네트워크·세션 오류 안내 문장, DB 한국어 안내는 그대로', () => {
  assert.match(friendly('TypeError: Failed to fetch'), /인터넷 연결/);
  assert.match(friendly('TypeError: Load failed'), /인터넷 연결/); // Safari·카카오톡(iOS)
  assert.match(friendly('JWT expired'), /새로고침/);
  assert.equal(friendly('일정이 이미 확정돼서 응답을 바꿀 수 없어요.'), '일정이 이미 확정돼서 응답을 바꿀 수 없어요.');
});

t('달력 날짜 상태: 응답자 기준, 미응답만 있으면 pending', () => {
  assert.equal(dayTone(3, 3), 'all');
  assert.equal(dayTone(2, 3), 'some');
  assert.equal(dayTone(0, 3), 'none');
  assert.equal(dayTone(0, 0), 'pending');
});

t('스텝퍼: 순서 강요 없음, 장소 4상태(확정·생략·조율 중·미정) 구분 — 생략은 완료 체크가 아님, null 로 생략 추정 안 함', () => {
  const base = { meeting: { status: 'schedule_open' }, selectedStart: null, stops: [], placeSkipped: false, legacyFinals: [], kinds: [{ cands: [] }], schedDone: [1], N: 3 };
  const st = (v) => progressSteps(v).map((x) => x.state).join(',');
  const note = (v) => progressSteps(v)[1].note;
  assert.equal(st(base), 'now,wait,wait');
  assert.equal(st({ ...base, kinds: [{ cands: [1] }] }), 'now,now,wait');
  assert.equal(note({ ...base, kinds: [{ cands: [1] }] }), '조율 중');
  assert.equal(st({ ...base, stops: [{}] }), 'now,done,wait');                         // 장소가 일정보다 먼저 확정돼도 됨
  assert.equal(st({ ...base, selectedStart: 'x' }), 'done,wait,now');
  assert.equal(st({ ...base, selectedStart: 'x', placeSkipped: true }), 'done,skip,now');  // 명시적 생략
  assert.equal(note({ ...base, selectedStart: 'x', placeSkipped: true }), '생략');
  const finNoPlace = { ...base, meeting: { status: 'finalized' }, selectedStart: 'x' };
  assert.equal(st(finNoPlace), 'done,wait,done');                                      // 장소 값 없음 ≠ 생략
  assert.equal(note(finNoPlace), '미정');
  assert.equal(placeState(finNoPlace), 'undecided');
  assert.equal(placeState({ ...finNoPlace, kinds: [{ cands: [1] }] }), 'undecided');   // 확정 후 남은 후보는 조율 중이 아님
  assert.equal(segmentState('done', 'skip'), 'skip');
  assert.equal(segmentState('skip', 'done'), 'done');
  assert.equal(segmentState('wait', 'done'), 'wait'); // 장소 미정 → 약속 확정 선은 회색
});

t('참여자 상태: 초대·응답·확정 시간 선택·역할을 따로(A 모드), 미응답은 pick 없음(불참 아님)', () => {
  const Q = P.slice(0, 4).map((p, i) => ({ ...p, user_id: i < 3 ? `u${i}` : null }));
  const v = derive({
    meeting: { owner_user_id: 'u0', schedule_mode: 'poll', selected_time_option_id: 't1', selected_start: kstISO(day, 18 * 60), selected_end: kstISO(day, 20 * 60), host_participant_id: 'p0' },
    participants: Q, times: [{ id: 't1' }, { id: 't2' }],
    choices: [{ participant_id: 'p0', time_option_id: 't1' }, { participant_id: 'p1', time_option_id: 't2' }],
    scheduleSubs: [{ participant_id: 'p0' }, { participant_id: 'p1' }, { participant_id: 'p2' }],
    candidates: [], placeSubs: [], votes: [], finals: [],
  }, 'u0');
  const st = Q.map((p) => participantStatus(v, p));
  assert.deepEqual(st.map((x) => x.response), ['done', 'done', 'none', 'pending']);
  assert.deepEqual(st.map((x) => x.pick), ['yes', 'no', 'no', null]);
  assert.deepEqual(st.map((x) => x.joined), [true, true, true, false]);
  assert.deepEqual(st.map((x) => x.role), ['host', null, null, null]);
  assert.ok(st.every((x) => !('attend' in x))); // 참석 여부는 저장 데이터가 없어 만들지 않음
});
t('참여자 상태(B 모드): 확정 구간의 모든 칸을 골랐을 때만 확정 시간 가능', () => {
  const v = derive({
    meeting: { owner_user_id: 'u0', schedule_mode: 'grid', selected_start: kstISO(day, 18 * 60), selected_end: kstISO(day, 19 * 60) },
    participants: P.slice(0, 2), times: [], choices: [], surveyDays: survey,
    scheduleSubs: [{ participant_id: 'p0' }, { participant_id: 'p1' }],
    gridRows: [at('p0', 18, 0), at('p0', 18, 30), at('p1', 18, 0)],
    candidates: [], placeSubs: [], votes: [], finals: [],
  }, 'u0');
  assert.deepEqual(P.slice(0, 2).map((p) => participantStatus(v, p).pick), ['yes', 'no']);
});
t('확정 전에는 확정 시간 선택(pick)을 계산하지 않음', () => {
  const v = derive({ meeting: { schedule_mode: 'poll' }, participants: P.slice(0, 1), times: [], choices: [], scheduleSubs: [{ participant_id: 'p0' }], candidates: [], placeSubs: [], votes: [], finals: [] }, 'x');
  assert.equal(participantStatus(v, P[0]).pick, null);
});
t('스텝퍼 연결선: 완료-완료 done · 다음이 진행 중 active · 다음이 대기 wait', () => {
  assert.equal(segmentState('done', 'done'), 'done');
  assert.equal(segmentState('done', 'now'), 'active');
  assert.equal(segmentState('now', 'now'), 'active');
  assert.equal(segmentState('now', 'wait'), 'wait');
  assert.equal(segmentState('done', 'wait'), 'wait');
  assert.equal(segmentState('now', 'done'), 'active'); // 장소가 일정보다 먼저 끝난 경우
});
t('확정 일시 긴 형식(한국 시간)', () => {
  assert.equal(fmtRangeLong(kstISO(day, 18 * 60), kstISO(day, 20 * 60)), '11월 14일(토) 18:00~20:00');
  assert.equal(fmtRangeLong('2026-11-14T14:00:00Z', '2026-11-14T16:00:00Z'), '11월 14일(토) 23:00~11월 15일(일) 01:00');
});

t('참석 확인 집계: 현재 회차만, 행 없음=미응답(미정과 구분), 기능 없으면 null', () => {
  const ps = P.slice(0, 4);
  const base = { meeting: { schedule_round: 2 }, participants: ps, me: ps[0] };
  const rs = rsvpSummary({ ...base, rsvps: [
    { participant_id: 'p0', round: 2, status: 'yes' }, { participant_id: 'p1', round: 2, status: 'maybe' },
    { participant_id: 'p2', round: 1, status: 'no' }, // 이전 회차 → 지금은 미응답
  ] });
  assert.deepEqual(rs.count, { yes: 1, no: 0, maybe: 1, none: 2 });
  assert.equal(rs.mine, 'yes');
  assert.equal(rs.of(ps[2]), 'none');
  assert.equal(rsvpSummary({ ...base, rsvps: null }), null);
});

console.log(`\n${pass}개 통과`);
