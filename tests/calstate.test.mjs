// 캘린더 상태(확정·후보·응답 필요) 단위 테스트: node tests/calstate.test.mjs
import assert from 'node:assert/strict';
import { needsMe, scheduleState } from '../public/lib/calstate.js';

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };
const now = Date.parse('2026-12-01T12:00:00+09:00');
const fut = { start: '2026-12-05T14:00:00+09:00', end: '2026-12-05T16:00:00+09:00', mine: false };
const past = { start: '2026-11-20T14:00:00+09:00', end: '2026-11-20T16:00:00+09:00', mine: false };
const base = { i_participate: true, my_state: 'pending', status: 'schedule_open', selected_start: null, candidates: [fut] };

t('조율 중 + 미응답 + 남은 후보 → 응답 필요(후보 상태와 함께)', () => {
  assert.equal(needsMe(base, { now }), true);
  assert.equal(scheduleState(base), 'cand');
});
t('이미 응답(done/none)했으면 응답 필요 아님', () => {
  assert.equal(needsMe({ ...base, my_state: 'done' }, { now }), false);
  assert.equal(needsMe({ ...base, my_state: 'none' }, { now }), false);
});
t('확정됐거나 장소 단계면 응답 필요 아님(미응답이어도)', () => {
  const fixed = { ...base, status: 'place_open', selected_start: fut.start, selected_end: fut.end, candidates: [] };
  assert.equal(needsMe(fixed, { now }), false);
  assert.equal(scheduleState(fixed), 'fixed');
});
t('후보가 모두 지나 더 응답할 수 없으면 응답 필요 아님', () => {
  assert.equal(needsMe({ ...base, candidates: [past] }, { now }), false);
  assert.equal(needsMe({ ...base, candidates: [past, fut] }, { now }), true);
});
t('참여하지 않는 약속은 응답 필요 아님', () => assert.equal(needsMe({ ...base, i_participate: false, my_state: null }, { now }), false));
t('배열 filter 에 바로 넘겨도 인덱스를 시각으로 쓰지 않음', () => {
  assert.deepEqual([base, base].filter(needsMe).length, 2);
});

console.log(`\n${pass}개 통과`);
