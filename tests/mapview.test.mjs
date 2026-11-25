// 지도 처음 범위 규칙 단위 테스트: node tests/mapview.test.mjs
import assert from 'node:assert/strict';
import { initialView, validPoint, clampLevel, DEFAULT_VIEW, MIN_LEVEL, SINGLE_LEVEL } from '../public/lib/mapview.js';

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };
const A = { lat: 37.5662, lng: 126.991 };
const B = { lat: 37.57, lng: 126.983 };

t('잘못된 좌표 거르기(null·문자·범위 밖·0,0)', () => {
  assert.equal(validPoint(A), true);
  assert.equal(validPoint({ lat: '37.5', lng: '127.0' }), true);
  for (const bad of [null, {}, { lat: null, lng: 127 }, { lat: 'x', lng: 127 }, { lat: 91, lng: 0 }, { lat: 37, lng: 200 }, { lat: 0, lng: 0 }, { lat: NaN, lng: 1 }]) assert.equal(validPoint(bad), false, JSON.stringify(bad));
});
t('후보 0개 + 저장·검색 없음 → 기본 지역', () => {
  assert.deepEqual(initialView([]), { ...DEFAULT_VIEW, source: 'default' });
  assert.equal(initialView(undefined).source, 'default'); // 로딩 전
});
t('후보 1개 → 그 위치, 과도한 확대 없이 고정 레벨', () => {
  const v = initialView([A]);
  assert.equal(v.type, 'center'); assert.equal(v.level, SINGLE_LEVEL); assert.ok(v.level >= MIN_LEVEL);
});
t('후보 여러 개 → 모두 보이게(bounds), 최소 레벨 제한', () => {
  const v = initialView([A, B, { lat: null, lng: 1 }]);
  assert.equal(v.type, 'bounds'); assert.equal(v.points.length, 2); assert.equal(v.minLevel, MIN_LEVEL);
});
t('잘못된 좌표만 있는 후보 → 후보 없음으로 처리', () => {
  assert.equal(initialView([{ lat: 0, lng: 0 }, { lat: 'a', lng: 'b' }]).source, 'default');
});
t('후보가 있으면 저장된 지역·검색 지역보다 우선', () => {
  assert.equal(initialView([A], { saved: { ...B, level: 3 }, searched: [B] }).source, 'candidates');
});
t('후보 없음: 저장된(내가 본) 지역 → 검색 지역 → 기본', () => {
  const s = initialView([], { saved: { ...B, level: 2 }, searched: [A] });
  assert.equal(s.source, 'saved'); assert.equal(s.level, MIN_LEVEL); // 저장값도 너무 확대되지 않게
  assert.equal(initialView([], { searched: [A, B] }).source, 'search');
  assert.equal(initialView([], { saved: { lat: 0, lng: 0 } }).source, 'default');
});
t('레벨 보정', () => { assert.equal(clampLevel('x'), DEFAULT_VIEW.level); assert.equal(clampLevel(1), MIN_LEVEL); assert.equal(clampLevel(30), 12); });

console.log(`\n${pass}개 통과`);
