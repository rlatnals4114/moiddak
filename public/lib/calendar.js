// 통합 캘린더 데이터(005 my_calendar). 내 약속만, 다른 사람 정보 없음.
import { useState, useEffect } from './deps.js';
import { sb } from './sb.js';
import { dayKey } from './time.js';

// 모임방마다 구분되는 색(점·칩). 일회성 약속은 남색.
const GROUP_COLORS = ['#3B55E8', '#FF8469', '#2BA97A', '#7C6CF2', '#E2A229', '#E86CA8', '#2F8FD8', '#B5703C'];
export const ONE_OFF = { key: 'one-off', name: '일회성 약속', color: '#242338' };
export function groupColor(id) {
  if (!id) return ONE_OFF.color;
  const h = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

const notReady = (e) => /my_calendar|schema cache|Could not find|does not exist/i.test((e && e.message) || '');

export async function loadCalendar(from, to) {
  const { data, error } = await sb.rpc('my_calendar', { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) return notReady(error) ? { ready: false, items: [] } : { ready: true, items: [], error: error.message };
  return { ready: true, items: data || [] };
}

// 약속 화면에서 충돌 확인용으로 쓰는 내 캘린더(30초 캐시). 005 전이면 items 가 비어 표시가 없다.
let cache = null;
let cachedAt = 0;
export function useMyCalendar() {
  const [st, setSt] = useState(cache);
  useEffect(() => {
    if (cache && Date.now() - cachedAt < 30000) return;
    loadCalendar(new Date(Date.now() - 30 * 86400000), new Date(Date.now() + 365 * 86400000)).then((r) => { cache = r; cachedAt = Date.now(); setSt(r); });
  }, []);
  return st;
}
export const invalidateMyCalendar = () => { cache = null; };

// 상태 분류: 확정(fixed) · 후보(cand) · 내 응답 필요(need) — 규칙은 lib/calstate.js(단위 테스트)
export { needsMe, scheduleState } from './calstate.js';

// 날짜별 항목: 확정은 확정 날짜, 미확정은 후보 날짜(내가 고른 후보가 있으면 그 날짜 우선)
export function entriesByDay(items) {
  const map = {};
  const push = (day, e) => { (map[day] ||= []).push(e); };
  for (const it of items) {
    if (it.selected_start) {
      push(dayKey(it.selected_start), { it, kind: 'fixed', start: it.selected_start, end: it.selected_end });
    } else {
      const seen = new Set();
      const mine = it.candidates.filter((c) => c.mine);
      for (const c of (mine.length ? mine : it.candidates)) {
        const d = dayKey(c.start);
        const k = `${d}|${c.start}`;
        if (seen.has(k)) continue;
        seen.add(k);
        push(d, { it, kind: 'cand', mine: c.mine, start: c.start, end: c.end });
      }
    }
  }
  for (const d of Object.keys(map)) map[d].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return map;
}
