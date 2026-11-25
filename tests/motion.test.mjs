// 캐릭터 움직임 규칙 단위 테스트: node tests/motion.test.mjs
import assert from 'node:assert/strict';
import { lanes, pickAction, pickTarget, clampToLane, walkMs, restMs, MAX_ACTORS } from '../public/lib/motion.js';

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };

t('레인은 배너 안(6%~94%)에 있고 서로 겹치지 않음(1~8명)', () => {
  for (let n = 1; n <= MAX_ACTORS; n += 1) {
    const L = lanes(n);
    assert.equal(L.length, n);
    L.forEach((l, i) => {
      assert.ok(l.min >= 6 && l.max <= 94 && l.min < l.max, `n=${n} i=${i}`);
      if (i > 0) assert.ok(L[i - 1].max < l.min, `겹침 n=${n} i=${i}`);
      assert.ok(l.home > l.min && l.home < l.max);
    });
  }
});
t('9명 이상이면 움직이는 캐릭터는 최대 8명', () => assert.equal(lanes(12).length, MAX_ACTORS));
t('목표 위치는 항상 자기 레인 안', () => {
  const l = lanes(4)[2];
  for (const r of [0, 0.01, 0.5, 0.99, 1]) { const x = pickTarget(l, r); assert.ok(x >= l.min && x <= l.max); }
  assert.equal(clampToLane(l, -50), l.min);
  assert.equal(clampToLane(l, 500), l.max);
});
t('행동 분포·시간 범위', () => {
  assert.equal(pickAction(0.1), 'idle');
  assert.equal(pickAction(0.6), 'walk');
  assert.equal(pickAction(0.95), 'jump');
  assert.ok(walkMs(10, 11) >= 700 && walkMs(0, 100) <= 3200);
  assert.ok(restMs(0) >= 1800 && restMs(1) <= 5000);
});

console.log(`\n${pass}개 통과`);
