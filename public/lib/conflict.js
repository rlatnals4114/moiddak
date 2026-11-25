// 일정 충돌 규칙(순수 함수, 내 캘린더 데이터만 사용 — 다른 사람에게는 보이지 않는다).
// - 두 구간 [a1,a2), [b1,b2) 은 a1 < b2 && b1 < a2 일 때만 겹친다(같은 날이어도 시간이 안 겹치면 충돌 아님, 끝=시작은 안 겹침).
// - 시작이나 끝 시각이 없으면 정확히 겹치는지 알 수 없으므로 비교하지 않는다(추정 경고를 만들지 않음).
// - 모든 시각은 저장된 UTC 순간(Date.parse)으로 비교한다 → 날짜 경계·시간대 표기(+09:00/Z)와 무관.
// - 등급: 'fixed' 다른 확정 약속과 겹침(경고) · 'maybe' 투표 중인 다른 약속의 후보와 겹침(가능성 안내) · null 없음.
// - 충돌이 있어도 자동으로 불가 처리하지 않는다. 사용자가 직접 판단한다.

export function toRange(start, end) {
  const s = start ? Date.parse(start) : NaN;
  const e = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  return [s, e];
}

export const overlaps = (a, b) => !!a && !!b && a[0] < b[1] && b[0] < a[1];

// 내 캘린더 항목 → 비교 대상 구간 목록. 현재 약속(excludeId)은 뺀다.
//   확정 약속 → fixed, 미확정 약속 → 후보(내가 가능으로 고른 후보가 있으면 그것만, 없으면 전체 후보) → maybe
export function busyFrom(items, excludeId) {
  const out = [];
  for (const it of items || []) {
    if (it.id === excludeId) continue;
    if (it.selected_start) {
      out.push({ level: 'fixed', id: it.id, title: it.title, range: toRange(it.selected_start, it.selected_end), group: it.group });
    } else {
      const mine = (it.candidates || []).filter((c) => c.mine);
      for (const c of (mine.length ? mine : it.candidates || [])) {
        out.push({ level: 'maybe', id: it.id, title: it.title, range: toRange(c.start, c.end), group: it.group });
      }
    }
  }
  return out.filter((b) => b.range);
}

// 한 구간이 내 다른 일정과 겹치는지. 확정 충돌이 있으면 'fixed', 후보만 겹치면 'maybe'.
export function conflictOf(start, end, busy) {
  const r = toRange(start, end);
  if (!r) return null;
  const hits = busy.filter((b) => overlaps(r, b.range));
  const fixed = hits.filter((h) => h.level === 'fixed');
  const maybe = hits.filter((h) => h.level === 'maybe');
  // 같은 약속의 후보가 여러 개 겹쳐도 한 번만
  const uniq = (list) => [...new Map(list.map((h) => [h.id, h])).values()];
  if (fixed.length) return { level: 'fixed', hits: uniq(fixed), maybe: uniq(maybe) };
  if (maybe.length) return { level: 'maybe', hits: uniq(maybe), maybe: [] };
  return null;
}

// 캘린더 항목끼리 겹치는 것: 확정-확정(경고) · 그 외 후보가 낀 겹침('후보 시간 중복' 안내).
// 날짜 경계를 넘는 일정도 놓치지 않도록 하루 단위가 아니라 전체 항목을 넘겨 쓴다.
export function dayConflicts(entries) {
  const res = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (a.it.id === b.it.id) continue;
      if (!overlaps(toRange(a.start, a.end), toRange(b.start, b.end))) continue;
      const level = a.kind === 'fixed' && b.kind === 'fixed' ? 'fixed' : 'maybe';
      for (const [x, y] of [[a, b], [b, a]]) {
        const cur = res.get(x);
        // 등급이 높은 것 우선, 같은 등급이면 상대가 확정 약속인 쪽을 먼저 알려 준다
        const better = !cur || (cur.level === 'maybe' && level === 'fixed') || (cur.level === level && !cur.fixedPartner && y.kind === 'fixed');
        if (better) res.set(x, { level, with: y.it.title, fixedPartner: y.kind === 'fixed' });
      }
    }
  }
  return res;
}
