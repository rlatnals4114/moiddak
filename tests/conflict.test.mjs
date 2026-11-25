// 일정 충돌 규칙 단위 테스트: node tests/conflict.test.mjs
import assert from 'node:assert/strict';
import { overlaps, toRange, busyFrom, conflictOf, dayConflicts } from '../public/lib/conflict.js';

const d = '2026-12-05';
const at = (hm) => `${d}T${hm}:00+09:00`;
let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };

const items = [
  { id: 'book', title: '독서모임', selected_start: at('14:00'), selected_end: at('16:00'), candidates: [] },
  { id: 'trip', title: '여행 계획', selected_start: null, candidates: [
    { start: at('18:00'), end: at('20:00'), mine: false },
    { start: at('19:00'), end: at('21:00'), mine: true },
  ] },
  { id: 'open', title: '아직 응답 안 함', selected_start: null, candidates: [{ start: at('10:00'), end: null, mine: false }] },
  { id: 'self', title: '지금 보는 약속', selected_start: at('15:00'), selected_end: at('17:00'), candidates: [] },
];
const busy = busyFrom(items, 'self');

t('독서모임 14:00~16:00 vs 친구모임 15:00~17:00 → 확정 충돌 경고', () => {
  const c = conflictOf(at('15:00'), at('17:00'), busy);
  assert.equal(c.level, 'fixed');
  assert.equal(c.hits[0].title, '독서모임');
});
t('같은 날 16:00~18:00 은 겹치지 않음(끝=시작)', () => {
  assert.equal(conflictOf(at('16:00'), at('18:00'), busy), null);
  assert.equal(overlaps(toRange(at('14:00'), at('16:00')), toRange(at('16:00'), at('18:00'))), false);
});
t('미확정 약속은 내가 고른 후보(19~21)만 비교 → 가능성 안내', () => {
  assert.equal(conflictOf(at('20:00'), at('21:00'), busy).level, 'maybe');
  assert.equal(conflictOf(at('18:00'), at('19:00'), busy), null); // 내가 고르지 않은 18~20 후보는 제외
});
t('끝 시각이 없는 후보는 정확한 겹침을 알 수 없어 비교하지 않음(추정 경고 없음)', () => {
  assert.equal(conflictOf(at('10:30'), at('12:00'), busy), null);
  assert.equal(conflictOf(at('10:00'), null, busy), null);
  assert.equal(toRange(at('10:00'), null), null);
});
t('지금 보는 약속 자신은 비교에서 제외', () => {
  assert.ok(!busy.some((b) => b.id === 'self'));
});
t('확정+후보가 함께 겹치면 확정 경고가 우선, 후보 목록도 함께', () => {
  const b2 = busyFrom([...items, { id: 'x', title: '후보', selected_start: null, candidates: [{ start: at('14:30'), end: at('15:30'), mine: true }] }], 'self');
  const c = conflictOf(at('15:00'), at('15:30'), b2);
  assert.equal(c.level, 'fixed');
  assert.equal(c.maybe.length, 1);
});
t('캘린더 하루: 확정끼리 겹침=경고, 확정-후보=안내, 안 겹치면 없음', () => {
  const e = [
    { it: { id: 'a', title: 'A' }, kind: 'fixed', start: at('14:00'), end: at('16:00') },
    { it: { id: 'b', title: 'B' }, kind: 'fixed', start: at('15:00'), end: at('17:00') },
    { it: { id: 'c', title: 'C' }, kind: 'cand', start: at('16:30'), end: at('18:00') },
    { it: { id: 'd', title: 'D' }, kind: 'fixed', start: at('20:00'), end: at('21:00') },
  ];
  const r = dayConflicts(e);
  assert.equal(r.get(e[0]).level, 'fixed');
  assert.equal(r.get(e[1]).level, 'fixed');
  assert.equal(r.get(e[2]).level, 'maybe');
  assert.equal(r.get(e[3]), undefined);
});

t('후보가 확정 약속과 다른 후보 둘 다와 겹치면 확정 약속 이름을 먼저 알려 줌', () => {
  const e = [
    { it: { id: 'x', title: '후보 약속' }, kind: 'cand', start: at('15:00'), end: at('17:00') },
    { it: { id: 'y', title: '다른 후보' }, kind: 'cand', start: at('13:00'), end: at('22:00') },
    { it: { id: 'z', title: '독서모임' }, kind: 'fixed', start: at('14:00'), end: at('16:00') },
  ];
  assert.equal(dayConflicts(e).get(e[0]).with, '독서모임');
});

t('날짜 경계: 23:00~다음날 01:00 과 다음날 00:30~01:30 은 겹침(하루 단위가 아니라 전체 비교)', () => {
  const e = [
    { it: { id: 'a', title: '밤 약속' }, kind: 'fixed', start: '2026-12-05T23:00:00+09:00', end: '2026-12-06T01:00:00+09:00' },
    { it: { id: 'b', title: '새벽 약속' }, kind: 'fixed', start: '2026-12-06T00:30:00+09:00', end: '2026-12-06T01:30:00+09:00' },
    { it: { id: 'c', title: '같은 날 아침' }, kind: 'fixed', start: '2026-12-06T09:00:00+09:00', end: '2026-12-06T10:00:00+09:00' },
  ];
  const r = dayConflicts(e);
  assert.equal(r.get(e[0]).level, 'fixed');
  assert.equal(r.get(e[1]).with, '밤 약속');
  assert.equal(r.get(e[2]), undefined); // 날짜만 같다고 경고하지 않음
});
t('시간대 표기가 달라도 같은 순간으로 비교(+09:00 과 Z)', () => {
  assert.equal(overlaps(toRange('2026-12-05T14:00:00+09:00', '2026-12-05T16:00:00+09:00'), toRange('2026-12-05T06:30:00Z', '2026-12-05T07:30:00Z')), true);
  assert.equal(overlaps(toRange('2026-12-05T14:00:00+09:00', '2026-12-05T16:00:00+09:00'), toRange('2026-12-05T07:00:00Z', '2026-12-05T08:00:00Z')), false); // 16:00 = 07:00Z 인접
});
t('끝 시각이 없는 캘린더 항목은 겹침 판단에서 제외', () => {
  const e = [
    { it: { id: 'a', title: '끝 없음' }, kind: 'cand', start: at('14:00'), end: null },
    { it: { id: 'b', title: '확정' }, kind: 'fixed', start: at('14:00'), end: at('15:00') },
  ];
  assert.equal(dayConflicts(e).size, 0);
});

console.log(`\n${pass}개 통과`);
