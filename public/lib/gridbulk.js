// B 모드 '여러 날 한 번에' 응답 계산(순수 함수). 화면: ui/TimeGrid.js MultiDayInput.
// - 고른 날짜마다 [from, to) 안에 '완전히 들어가는' 30분 칸만 고른다(주최자가 정한 조사 범위 밖은 자동 제외).
// - 기존 선택은 그대로 두고, '추가'는 더하기만, '해제'는 그 구간만 뺀다(예고 없이 덮어쓰지 않음).
import { SLOT } from './time.js';

export function bulkKeys(grid, days, from, to) {
  const out = [];
  let outside = 0;
  for (const d of grid) {
    if (!days.has(d.day)) continue;
    const want = Math.max(0, (Math.min(to, 1440) - Math.max(from, 0)) / SLOT);
    const inDay = d.slots.filter((s) => s.minute >= from && s.minute + SLOT <= to);
    outside += Math.max(0, want - inDay.length);
    inDay.forEach((s) => out.push({ day: d.day, key: s.key }));
  }
  return { items: out, outside };
}

// 미리보기: on=true(추가) → 새로 생길 칸·이미 고른 칸, on=false(해제) → 빠질 칸
export function bulkPreview(selected, items, on) {
  const hit = items.filter((i) => selected.has(i.key));
  const miss = items.filter((i) => !selected.has(i.key));
  return on ? { change: miss.length, already: hit.length, days: new Set(miss.map((i) => i.day)).size }
    : { change: hit.length, already: miss.length, days: new Set(hit.map((i) => i.day)).size };
}

export function bulkApply(selected, items, on) {
  const n = new Set(selected);
  items.forEach((i) => (on ? n.add(i.key) : n.delete(i.key)));
  return n;
}
