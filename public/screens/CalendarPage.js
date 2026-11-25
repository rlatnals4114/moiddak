// 통합 캘린더(#/calendar): 내가 참여·주최하는 모든 약속을 한 달력에. 모임방별 색, 확정 ●/후보 ○/응답 필요 !.
// 시간 겹침은 이 화면에 불러온 '내가 볼 수 있는 약속'끼리만, 실제 시작·끝 시각으로 비교한다(날짜 경계 포함).
import { html, useState, useEffect, useMemo } from '../lib/deps.js';
import { PixelIcon } from '../ui/Pixel.js';
import { todayKey, dayLabelLong, fmtTime, fmtRange, dayKey } from '../lib/time.js';
import { loadCalendar, entriesByDay, groupColor, needsMe, ONE_OFF } from '../lib/calendar.js';
import { Calendar } from '../ui/Calendar.js';
import { Msg, EmptyState } from '../ui/common.js';
import { dayConflicts } from '../lib/conflict.js';

function Top() {
  return html`<div class="topbar"><span class="top-gap"></span><span class="top-title">내 캘린더</span><span class="top-gap"></span></div>`;
}

// 겹침 문구: 확정끼리 = 경고 · 확정과 후보 = '확정 일정과 겹침' · 후보끼리 = '충돌 가능성'
function clashLabel(e, c) {
  if (c.level === 'fixed') return '◆ 확정 일정끼리 겹침';
  if (e.kind === 'fixed' || c.fixedPartner) return '◇ 확정 일정과 겹침(후보 시간)';
  return '◇ 충돌 가능성(후보끼리)';
}

export function CalendarPage() {
  const [st, setSt] = useState(null);
  const [day, setDay] = useState(todayKey());
  const [filter, setFilter] = useState('all');
  const [showCand, setShowCand] = useState(true);
  useEffect(() => {
    const from = new Date(Date.now() - 120 * 86400000);
    const to = new Date(Date.now() + 270 * 86400000);
    loadCalendar(from, to).then(setSt);
  }, []);

  const items = (st && st.items) || [];
  const groups = useMemo(() => {
    const m = new Map();
    items.forEach((it) => { const k = it.group ? it.group.id : ONE_OFF.key; if (!m.has(k)) m.set(k, it.group ? it.group.name : ONE_OFF.name); });
    return [...m.entries()];
  }, [st]);
  const visible = items.filter((it) => filter === 'all' || (it.group ? it.group.id : ONE_OFF.key) === filter);
  const byDay = entriesByDay(visible.filter((it) => showCand || it.selected_start));
  const marks = Object.fromEntries(Object.entries(byDay).map(([d, list]) => {
    const fixed = list.filter((e) => e.kind === 'fixed').length;
    const need = list.some((e) => needsMe(e.it));
    return [d, {
      text: fixed ? `${fixed}건` : `후보${list.length > 1 ? list.length : ''}`,
      tone: fixed ? 'all' : 'pending',
      dots: list.slice(0, 3).map((e) => ({ color: groupColor(e.it.group && e.it.group.id), fixed: e.kind === 'fixed' })),
      alert: need,
    }];
  }));
  const list = byDay[day] || [];
  const need = items.filter(needsMe);
  // 겹침 정책: 필터·후보 숨김과 상관없이 '내 전체 약속(확정+후보)'끼리 계산하고, 보이는 항목에만 표시한다
  //  → 필터로 숨겼다고 충돌이 사라진 것처럼 보이지 않게. 하루 단위가 아니라 전체 비교(자정을 넘는 약속 포함).
  const allEntries = Object.values(entriesByDay(items)).flat();
  const allClash = dayConflicts(allEntries);
  const clashByKey = new Map(allEntries.filter((e) => allClash.get(e)).map((e) => [`${e.it.id}|${e.start}`, allClash.get(e)]));
  const clash = { get: (e) => clashByKey.get(`${e.it.id}|${e.start}`) };
  // 앞으로 확정 약속끼리 겹치는 날(경고) — 필터와 상관없이 내 전체 확정 약속 기준
  const fixedEntries = Object.values(entriesByDay(items.filter((it) => it.selected_start))).flat();
  const fixedClash = dayConflicts(fixedEntries);
  const clashDays = [...new Set(fixedEntries.filter((e) => fixedClash.get(e) && fixedClash.get(e).level === 'fixed').map((e) => dayKey(e.start)))]
    .filter((d) => d >= todayKey()).sort();

  return html`
    <${Top} />
    ${st && !st.ready && html`<div class="msg warn">통합 캘린더를 쓰려면 DB 추가 설정(005 SQL)이 필요해요.</div>`}
    ${st && st.error && html`<${Msg} m=${{ type: 'error', text: st.error }} />`}
    ${need.length > 0 && html`<a class="todo-card" href=${`#/m/${need[0].id}/schedule`}>
      <span class="todo-icon" aria-hidden="true">!</span>
      <span class="todo-text"><strong>내 응답이 필요한 약속 ${need.length}개</strong><span>${need.map((n) => n.title).slice(0, 3).join(', ')}${need.length > 3 ? ` 외 ${need.length - 3}개` : ''}</span></span>
      <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span></a>`}

    ${clashDays.length > 0 && html`<button type="button" class="conflict-banner" onClick=${() => setDay(clashDays[0])}>
      ◆ 확정된 약속끼리 시간이 겹치는 날이 ${clashDays.length}일 있어요 (${clashDays.slice(0, 3).map((d) => dayLabelLong(d)).join(', ')}) ›</button>`}
    <div class="filter-chips" role="group" aria-label="모임방 필터">
      <button type="button" class=${filter === 'all' ? 'chip-btn on' : 'chip-btn'} aria-pressed=${filter === 'all'} onClick=${() => setFilter('all')}>전체</button>
      ${groups.map(([k, name]) => html`<button type="button" class=${filter === k ? 'chip-btn on' : 'chip-btn'} aria-pressed=${filter === k} onClick=${() => setFilter(k)}>
        <i class="gdot" style=${`background:${groupColor(k === ONE_OFF.key ? null : k)}`}></i>${name}</button>`)}
    </div>
    <label class="me-pick small"><input type="checkbox" checked=${showCand} onChange=${(e) => setShowCand(e.target.checked)} /> 아직 정하는 중인 후보 일정도 보기</label>

    <${Calendar} label="내 약속 달력" initial=${day} marks=${marks} isSelected=${(d) => d === day} onPick=${setDay} />
    <p class="cal-legend"><span><b class="dot-fixed">●</b>확정</span><span><b class="dot-cand">○</b>후보(정하는 중)</span><span><b class="alert-mark">!</b>내 응답 필요</span><span>점 색 = 모임방(상태는 ●○ 모양과 글자로 표시)</span></p>

    <h2 class="section-title">${dayLabelLong(day)}</h2>
    ${st === null && html`<p class="muted">불러오는 중…</p>`}
    ${st && list.length === 0 && html`<${EmptyState} compact icon="cal" text="이날 약속이 없어요." />`}
    <ul class="cal-list">${list.map((e) => {
      // 왼쪽 굵은 선 대신 상태 픽셀 아이콘: 내 응답 필요(코랄 물음표) · 확정(달력) · 후보(시계). 모임방 색은 아래 태그로.
      const st = needsMe(e.it) ? 'need' : e.kind === 'fixed' ? 'fixed' : 'cand';
      return html`<li><a href=${`#/m/${e.it.id}`} class=${`cal-item ci-${st}`}>
      <span class="ci-left">
        <span class="hi-icon" aria-hidden="true"><${PixelIcon} name=${st === 'need' ? 'question' : st === 'fixed' ? 'cal' : 'clock'} size=${st === 'need' ? 13 : 15} /></span>
        <span class="ci-time">${fmtTime(e.start)}${e.end ? html`<br /><span class="muted">~${fmtTime(e.end)}</span>` : ''}</span>
      </span>
      <span class="ci-body">
        <strong>${e.it.title}</strong>
        <span class="gtag"><i aria-hidden="true" style=${`background:${groupColor(e.it.group && e.it.group.id)}`}></i>${e.it.group ? `${e.it.group.name} 모임방` : '일회성 약속'}</span>
        <span class="ci-tags">
          ${e.kind === 'fixed' ? html`<span class="pill st-finalized">● 확정</span>` : html`<span class="pill mode">○ 후보${e.mine ? ' · 내가 가능' : ''}</span>`}
          ${needsMe(e.it) && html`<span class="pill need">! 내 응답 필요</span>`}
          ${e.it.i_host && html`<span class="pill host">주최</span>`}
          ${!e.it.i_participate && html`<span class="pill mode">참여 안 함</span>`}
        </span>
        ${clash.get(e) && html`<span class=${`conflict ${clash.get(e).level}`}>${clashLabel(e, clash.get(e))}: ${clash.get(e).with}</span>`}
      </span>
      <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span>
    </a></li>`;
    })}</ul>
    <p class="muted small">이 캘린더는 나에게만 보여요. 다른 사람에게 내 일정이 공개되지 않아요.</p>
    <p class="muted small">시간 겹침은 모이딱에서 내가 참여·주최하는 약속끼리만, 시작·끝 시각(한국 시간)으로 비교해요. 필터로 숨긴 약속과의 겹침도 표시해요. 다른 캘린더의 개인 일정이나 끝 시각이 없는 후보는 비교하지 않아요.</p>`;
}

// 홈에서 쓰는 요약(다가오는 확정 약속, 응답 필요)
export function upcomingAndNeed(items) {
  const now = Date.now();
  return {
    upcoming: items.filter((it) => it.selected_start && Date.parse(it.selected_end || it.selected_start) > now)
      .sort((a, b) => Date.parse(a.selected_start) - Date.parse(b.selected_start)),
    need: items.filter(needsMe),
  };
}
export { fmtRange };
