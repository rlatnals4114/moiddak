// '여러 날 한 번에' 계산 단위 테스트: node tests/gridbulk.test.mjs
import assert from 'node:assert/strict';
import { buildGrid } from '../public/lib/schedule.js';
import { bulkKeys, bulkPreview, bulkApply } from '../public/lib/gridbulk.js';

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };
const days = [
  { day: '2026-11-20', start_minute: 17 * 60, end_minute: 22 * 60 },
  { day: '2026-11-21', start_minute: 10 * 60, end_minute: 22 * 60 },
  { day: '2026-11-22', start_minute: 19 * 60, end_minute: 21 * 60 },
];
const grid = buildGrid(days, [], []);

t('고른 날짜마다 18~22시 칸만, 조사 범위 밖은 제외하고 개수로 알려 줌', () => {
  const r = bulkKeys(grid, new Set(['2026-11-20', '2026-11-21', '2026-11-22']), 18 * 60, 22 * 60);
  assert.equal(r.items.filter((i) => i.day === '2026-11-20').length, 8);
  assert.equal(r.items.filter((i) => i.day === '2026-11-21').length, 8);
  assert.equal(r.items.filter((i) => i.day === '2026-11-22').length, 4); // 19~21 만 조사
  assert.equal(r.outside, 4);
});
t('고르지 않은 날은 건드리지 않음', () => {
  const r = bulkKeys(grid, new Set(['2026-11-21']), 18 * 60, 22 * 60);
  assert.ok(r.items.every((i) => i.day === '2026-11-21'));
});
t('추가는 기존 선택을 지우지 않고, 미리보기 수와 결과가 일치', () => {
  const r = bulkKeys(grid, new Set(['2026-11-20', '2026-11-21']), 18 * 60, 20 * 60);
  const before = new Set([r.items[0].key, grid[1].slots[0].key]); // 하나는 겹침, 하나는 범위 밖(10:00)
  const p = bulkPreview(before, r.items, true);
  assert.deepEqual([p.change, p.already], [r.items.length - 1, 1]);
  const after = bulkApply(before, r.items, true);
  assert.equal(after.size, before.size + p.change);
  assert.ok(after.has(grid[1].slots[0].key)); // 기존 10:00 그대로
});
t('해제는 그 구간 안의 고른 칸만 빠짐', () => {
  const all = new Set(grid.flatMap((g) => g.slots.map((s) => s.key)));
  const r = bulkKeys(grid, new Set(['2026-11-21']), 10 * 60, 12 * 60);
  const p = bulkPreview(all, r.items, false);
  const after = bulkApply(all, r.items, false);
  assert.equal(p.change, 4);
  assert.equal(after.size, all.size - 4);
});

console.log(`\n${pass}개 통과`);
