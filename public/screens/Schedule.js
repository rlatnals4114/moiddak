// 일정 탭: A 후보 투표(달력+후보 카드) / B 30분 시간표(입력 ↔ 결과 히트맵 분리)
import { html, useState } from '../lib/deps.js';
import { sb } from '../lib/sb.js';
import { names, copyText, toast, meetingLink } from '../lib/util.js';
import { fmtRange, dayKey, dayLabel, dayLabelLong, minuteLabel, kstISO, SLOT } from '../lib/time.js';
import { recommend, dayTone } from '../lib/schedule.js';
import { Msg, Progress, Segmented, TimeSelect, askConfirm } from '../ui/common.js';
import { Calendar, CalendarLegend } from '../ui/Calendar.js';
import { GridInput, DayMatrix, MultiDayInput } from '../ui/TimeGrid.js';
import { PixelIcon } from '../ui/Pixel.js';
import { useMyCalendar } from '../lib/calendar.js';
import { busyFrom, conflictOf } from '../lib/conflict.js';
import { ConflictBadge, conflictText } from '../ui/ConflictBadge.js';

function requestText(v) {
  return `[${v.meeting.title}] 일정 응답 아직 안 한 분: ${names(v.schedPending)} 🙏\n`
    + `아래 약속 링크에서 가능한 시간을 골라 주세요.\n${meetingLink(v.meeting.id)}\n`
    + '(처음이면 주최자가 따로 보낸 개인 초대 링크로 들어와 주세요)';
}

export function ScheduleTab({ v, reload }) {
  const open = v.meeting.status === 'schedule_open';
  return html`
    <section class="card" aria-labelledby="sched-h">
      <div class="row-between"><h2 id="sched-h">일정</h2><span class="pill mode" title="약속을 만들 때 정한 방식이에요">${v.mode === 'grid' ? '30분 시간표' : '시간 후보 투표'}</span></div>
      ${v.selectedStart ? html`
        <p class="msg ok small">일정이 확정됐어요(위 ‘확정 일시’). 더 이상 일정 투표를 받지 않아요.</p>
        <details class="fold">
          <summary><span class="fold-title">조율 결과</span>
            <span class="fold-sub">지난 일정 투표 · 응답 ${v.schedDone.length}/${v.N}명</span></summary>
          <div class="fold-body">
            <p class="small muted">일정을 정할 때의 투표 기록이에요. 투표는 끝났고, 미응답은 불참이 아니에요.</p>
            <${Progress} label="일정 응답" done=${v.schedDone} pending=${v.schedPending} none=${v.schedNone} total=${v.N} onRequest=${null} closed=${true} />
            ${v.mode === 'grid' ? html`<${GridMode} v=${v} reload=${reload} />` : html`<${PollMode} v=${v} reload=${reload} />`}
          </div>
        </details>`
      : html`
        <div class="sticky-status">
          <${Progress} label="일정 응답" done=${v.schedDone} pending=${v.schedPending} none=${v.schedNone} total=${v.N}
            onRequest=${v.isOwner && open ? () => copyText(requestText(v)) : null} />
        </div>
        ${v.mode === 'grid' ? html`<${GridMode} v=${v} reload=${reload} />` : html`<${PollMode} v=${v} reload=${reload} />`}`}
    </section>`;
}

// ───────── A 모드 ─────────

function PollMode({ v, reload }) {
  const open = v.meeting.status === 'schedule_open';
  const byDay = {};
  v.options.forEach((o) => { (byDay[dayKey(o.starts_at)] ||= []).push(o); });
  const days = Object.keys(byDay).sort();
  const [day, setDay] = useState(null); // null = 전체
  const marks = Object.fromEntries(days.map((d) => {
    const best = Math.max(...byDay[d].map((o) => o.people.length));
    return [d, { text: `${byDay[d].length}개`, tone: dayTone(best, v.schedDone.length) }];
  }));
  const shown = day ? byDay[day] || [] : v.options;
  const [sel, setSel] = useState(() => new Set(v.myChoices));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const canInput = open && v.me;
  const tops = v.options.filter((o) => v.maxCount > 0 && o.people.length === v.maxCount).length;
  // 내 다른 약속과의 충돌(나에게만 보임). 확정 후에는 확정된 시간만 의미가 있으므로 열린 동안만 표시
  const myCal = useMyCalendar();
  const myBusy = busyFrom(myCal && myCal.items, v.meeting.id);

  async function submit(ids) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc('submit_schedule', { p_meeting_id: v.meeting.id, p_time_option_ids: ids });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: `저장하지 못했어요: ${error.message} (고른 후보는 그대로 있어요. 다시 눌러 주세요)` }); return; }
    setMsg({ type: 'ok', text: ids.length ? `응답을 저장했어요 ✓ ${ids.length}개 가능` : '‘가능한 시간 없음’으로 응답했어요 ✓' });
    reload();
  }
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return html`
    <${Calendar} label="후보 날짜" marks=${marks} isSelected=${(d) => d === day} isEnabled=${(d) => !!byDay[d]}
      onPick=${(d) => setDay(day === d ? null : d)} />
    <${CalendarLegend} />
    <div class="row-between">
      <h3>${day ? dayLabelLong(day) : '모든 후보'} ${canInput ? html`<span class="muted small">· 가능한 후보를 모두 눌러요</span>` : ''}</h3>
      ${day && html`<button class="btn ghost small" onClick=${() => setDay(null)}>전체 보기</button>`}
    </div>
    <p class="muted small">숫자는 ‘가능 인원 / 응답한 사람 / 전체’예요. 미응답자는 불가능으로 세지 않아요.</p>
    ${open && myBusy.length > 0 && html`<p class="muted small">◆ ◇ 표시는 내 캘린더의 다른 약속과 겹치는지 알려 줘요(나에게만 보이고, 고를 수는 있어요).</p>`}
    <ul class="opt-cards">
      ${shown.map((o) => {
        const on = sel.has(o.id);
        const isTop = v.maxCount > 0 && o.people.length === v.maxCount;
        const picked = v.meeting.selected_time_option_id === o.id;
        const body = html`
          <span class="oc-head">
            ${canInput && html`<span class="check-box" aria-hidden="true">${on && html`<${PixelIcon} name="check" size=${12} />`}</span>`}
            <strong>${fmtRange(o.starts_at, o.ends_at)}</strong>
            ${isTop && html`<span class="tag">${tops > 1 ? '공동 1위' : '가장 많음'}</span>`}
            ${picked && html`<span class="tag ok">확정</span>`}
          </span>
          <span class="oc-count"><b>${o.people.length}명 가능</b> / ${v.schedDone.length}명 응답 · 전체 ${v.N}명</span>
          <span class="bar" aria-hidden="true"><span style=${`width:${v.N ? (o.people.length / v.N) * 100 : 0}%`}></span></span>
          <span class="small muted">${o.people.length ? names(o.people) : '아직 가능한 사람 없음'}</span>
          ${open && html`<${ConflictBadge} c=${conflictOf(o.starts_at, o.ends_at, myBusy)} />`}`;
        return html`<li class=${picked ? 'picked' : isTop ? 'top' : ''}>
          ${canInput ? html`<button type="button" class="opt-card ${on ? 'on' : ''}" aria-pressed=${on} onClick=${() => toggle(o.id)}>${body}</button>`
            : html`<div class="opt-card static">${body}</div>`}
        </li>`;
      })}
    </ul>
    ${v.schedDone.length > 0 && v.maxCount === 0 && html`<p class="msg warn">지금까지 응답한 사람 모두가 가능한 후보가 없어요. 새 후보로 다시 조사하는 것을 고려해 주세요.</p>`}
    ${canInput && html`
      <${Msg} m=${msg} />
      <div class="cta-bar">
        <p class="small">내 응답: ${v.mySchedSubmitted ? (v.myChoices.length ? `제출함 (${v.myChoices.length}개 가능)` : '제출함 (가능한 시간 없음)') : '아직 안 냄'}</p>
        <button class="btn block" disabled=${busy || sel.size === 0} onClick=${() => submit([...sel])}>${busy ? '저장 중…' : `응답 제출 (${sel.size}개 가능)`}</button>
        <button class="btn ghost block" disabled=${busy} onClick=${() => {
          if (confirm('가능한 시간이 하나도 없다고 응답할까요?\n(일정이 확정되기 전까지 다시 고칠 수 있어요)')) { setSel(new Set()); submit([]); }
        }}>가능한 시간 없음으로 응답</button>
      </div>`}
    ${open && v.isOwner && html`<${PollConfirm} v=${v} reload=${reload} />`}`;
}

// 확정 직전 재확인: 서버에서 최신 응답·상태를 다시 읽고, 미응답자가 있으면 경고 창(돌아가기/확정하기)을 띄운다.
// '가능 시간 없음'으로 답한 사람은 미응답이 아니다. 가능 인원도 '참석 인원'이라고 부르지 않는다.
async function confirmCheck(v, { when, canCount, conflict }) {
  const [subs, cur] = await Promise.all([
    sb.from('schedule_submissions').select('participant_id').eq('meeting_id', v.meeting.id),
    sb.from('meetings').select('status,version').eq('id', v.meeting.id).maybeSingle(),
  ]);
  if (subs.error || cur.error || !cur.data) return { error: '최신 응답을 확인하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.' };
  if (cur.data.status !== 'schedule_open') return { error: '일정은 이미 확정됐어요. 화면을 새로고침할게요.' };
  const done = new Set(subs.data.map((x) => x.participant_id));
  const pending = v.participants.filter((p) => !done.has(p.id));
  const changed = pending.length !== v.schedPending.length || cur.data.version !== v.meeting.version;
  const facts = `${when} · 이 시간 가능으로 응답 ${canCount}명 · 일정 응답 ${done.size}/${v.N}명`;
  const tail = '확정하면 일정 응답은 더 이상 바꿀 수 없어요. 일정 응답은 참석 확인이 아니에요.';
  const ok = await askConfirm(pending.length
    ? { title: `미응답자가 ${pending.length}명 있어요`, ok: '확정하기', cancel: '돌아가기',
        body: ['아직 일정을 제출하지 않은 사람이 있습니다. 이대로 날짜를 확정하시겠어요?', `미응답: ${names(pending)}`, facts,
          changed && '방금 응답이 바뀌어서 최신 숫자로 다시 보여 드려요.', conflict, tail] }
    : { title: '이 시간으로 확정할까요?', ok: '확정하기', cancel: '돌아가기', body: [facts, changed && '방금 응답이 바뀌어서 최신 숫자로 다시 보여 드려요.', conflict, tail] });
  return ok ? { version: cur.data.version } : { skipped: true };
}

function PollConfirm({ v, reload }) {
  const best = v.options.find((o) => v.maxCount > 0 && o.people.length === v.maxCount);
  const [chosen, setChosen] = useState(null);
  const pick = chosen ?? (best ? best.id : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const myCal = useMyCalendar();
  async function confirmIt() {
    const o = v.options.find((x) => x.id === pick);
    if (!o || busy) return;
    setBusy(true); setMsg(null);
    const chk = await confirmCheck(v, { when: fmtRange(o.starts_at, o.ends_at), canCount: o.people.length,
      conflict: conflictText(conflictOf(o.starts_at, o.ends_at, busyFrom(myCal && myCal.items, v.meeting.id))).trim() });
    if (chk.skipped) { setBusy(false); return; }
    if (chk.error) { setBusy(false); setMsg({ type: 'error', text: chk.error }); reload(); return; }
    const { error } = await sb.rpc('confirm_schedule', { p_meeting_id: v.meeting.id, p_time_option_id: pick, p_expected_version: chk.version });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); reload(); return; }
    toast('일정을 확정했어요. 이제 장소를 정해요!');
    reload();
  }
  return html`
    <div class="host-box">
      <h3><${PixelIcon} name="crown" size=${14} /> 일정 확정 (주최자)</h3>
      <p class="muted small">가장 많은 후보를 추천해 두었지만 자동으로 확정되지 않아요.</p>
      ${v.options.map((o) => html`
        <label class="radio ${pick === o.id ? 'on' : ''}">
          <input type="radio" name="confirm-time" checked=${pick === o.id} onChange=${() => setChosen(o.id)} />
          <span>${fmtRange(o.starts_at, o.ends_at)} <span class="muted small">· ${o.people.length}명 가능</span></span>
        </label>`)}
      <${Msg} m=${msg} />
      ${!pick && html`<p class="small hint">확정할 시간 후보를 위에서 먼저 골라 주세요.</p>`}
      <button class="btn block" disabled=${!pick || busy} onClick=${confirmIt}>${busy ? '확인·확정 중…' : '이 시간으로 일정 확정'}</button>
    </div>`;
}

// ───────── B 모드 ─────────

function GridMode({ v, reload }) {
  const open = v.meeting.status === 'schedule_open';
  const canInput = open && v.me;
  const [view, setView] = useState(canInput && !v.mySchedSubmitted ? 'input' : 'result');
  return html`
    ${canInput && html`<${Segmented} label="시간표 보기" value=${view} onChange=${setView}
      options=${[{ value: 'input', label: '내 시간 입력' }, { value: 'result', label: '모두의 결과' }]} />`}
    ${canInput && view === 'input' ? html`<${GridMine} v=${v} reload=${reload} onDone=${() => setView('result')} />` : html`<${GridResult} v=${v} reload=${reload} />`}`;
}

function GridMine({ v, reload, onDone }) {
  const [sel, setSel] = useState(() => new Set(v.myGrid));
  const [day, setDay] = useState(v.grid[0]?.day);
  const [mode, setMode] = useState('one');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const d = v.grid.find((x) => x.day === day);
  const countOn = (g) => g.slots.filter((s) => sel.has(s.key)).length;
  const myCal = useMyCalendar();
  const myBusy = busyFrom(myCal && myCal.items, v.meeting.id);
  const busyOf = (s) => conflictOf(s.iso, new Date(s.key + SLOT * 60000).toISOString(), myBusy);
  const marks = Object.fromEntries(v.grid.map((g) => [g.day, { text: countOn(g) ? `${countOn(g)}칸` : '조사', tone: countOn(g) ? 'all' : 'pending' }]));

  async function submit(keys) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const slots = keys.map((k) => new Date(k).toISOString());
    const { error } = await sb.rpc('submit_grid', { p_meeting_id: v.meeting.id, p_slots: slots });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: `저장하지 못했어요: ${error.message} (고른 칸은 그대로 있어요)` }); return; }
    toast(keys.length ? `응답을 저장했어요 ✓ ${keys.length}칸 가능` : '‘가능한 시간 없음’으로 응답했어요 ✓');
    reload();
    onDone();
  }

  return html`
    <${Calendar} label="조사 날짜" marks=${marks} isSelected=${(x) => x === day} isEnabled=${(x) => !!marks[x]} onPick=${setDay} />
    ${mode !== 'multi' && html`<div class="day-tabs" role="tablist" aria-label="날짜 고르기">
      ${v.grid.map((g) => html`<button type="button" role="tab" aria-selected=${g.day === day} class=${g.day === day ? 'on' : ''} onClick=${() => setDay(g.day)}>
        ${dayLabel(g.day)}${countOn(g) ? ` · ${countOn(g)}` : ''}</button>`)}
    </div>`}
    ${v.grid.length > 1 && html`<${Segmented} label="입력 방식" value=${mode} onChange=${setMode}
      options=${[{ value: 'one', label: '하루씩' }, { value: 'multi', label: '여러 날 한 번에' }]} />`}
    ${mode === 'multi' && v.grid.length > 1 ? html`<${MultiDayInput} grid=${v.grid} selected=${sel} onChange=${setSel} />
        <p class="small">${v.grid.filter((g) => countOn(g)).map((g) => `${dayLabel(g.day)} ${countOn(g)}칸`).join(' · ') || '아직 고른 칸이 없어요.'}</p>`
      : d && html`<${GridInput} key=${d.day} day=${d} selected=${sel} onChange=${setSel} busyOf=${busyOf} />`}
    <${Msg} m=${msg} />
    <div class="cta-bar">
      <p class="small">전체 ${sel.size}칸(${sel.size * SLOT / 60}시간) 선택 · 내 응답: ${v.mySchedSubmitted ? (v.myGrid.length ? '제출함' : '제출함 (가능한 시간 없음)') : '아직 안 냄'}</p>
      <button class="btn block" disabled=${busy || sel.size === 0} onClick=${() => submit([...sel])}>${busy ? '저장 중…' : `응답 제출 (${sel.size}칸)`}</button>
      <button class="btn ghost block" disabled=${busy} onClick=${() => {
        if (confirm('가능한 시간이 하나도 없다고 응답할까요?\n(일정이 확정되기 전까지 다시 고칠 수 있어요)')) { setSel(new Set()); submit([]); }
      }}>가능한 시간 없음으로 응답</button>
    </div>`;
}

function GridResult({ v, reload }) {
  const [cell, setCell] = useState(null);
  const [len, setLen] = useState(2);
  const recs = recommend(v.grid, len);
  const responded = v.schedDone.length;
  const doneIds = new Set(v.schedDone.map((p) => p.id));
  const marks = Object.fromEntries(v.grid.map((g) => {
    const best = Math.max(0, ...g.slots.map((s) => s.people.length));
    return [g.day, { text: responded ? `${best}명` : '', tone: dayTone(best, responded) }];
  }));
  const firstDay = (recs[0] && recs[0].day) || (v.grid[0] && v.grid[0].day);
  const [day, setDay] = useState(firstDay);
  const d = v.grid.find((x) => x.day === day);
  const open = v.meeting.status === 'schedule_open';
  return html`
    <${Calendar} label="조사 날짜별 결과" initial=${firstDay} marks=${marks} isSelected=${(x) => x === day} isEnabled=${(x) => !!marks[x]}
      onPick=${(x) => { setDay(x); setCell(null); }} />
    <${CalendarLegend} />
    <p class="muted small">날짜 아래 숫자 = 그날 한 칸에 함께 가능한 최대 인원 · 전체 ${v.N}명 중 ${responded}명 응답 (미응답 ${v.schedPending.length}명은 불가로 세지 않아요)</p>

    ${d && html`<h3>${dayLabelLong(d.day)} 시간별 가능 인원</h3>
      <${DayMatrix} day=${d} participants=${v.participants} doneIds=${doneIds} N=${v.N} picked=${cell?.key} onPick=${setCell} />`}
    ${cell && html`<${CellDetail} v=${v} cell=${cell} onClose=${() => setCell(null)} />`}

    <div class="row-between"><h3>추천 시간</h3>
      <select aria-label="필요한 길이" value=${len} onChange=${(e) => setLen(Number(e.target.value))}>
        ${[1, 2, 3, 4, 6].map((b) => html`<option value=${b}>${b * SLOT / 60}시간 이상 함께</option>`)}
      </select>
    </div>
    ${responded === 0 ? html`<p class="muted">아직 응답이 없어요.</p>`
      : recs.length === 0 ? html`<p class="msg warn">${len * SLOT / 60}시간 동안 함께 가능한 사람이 없어요. 길이를 줄이거나 새 날짜로 다시 조사해 주세요.</p>`
        : html`
          <${RecommendCard} v=${v} r=${recs[0]} responded=${responded} reload=${reload} canConfirm=${open && v.isOwner} />
          ${recs.length > 1 && html`<ol class="recs">${recs.slice(1).map((r) => html`<li>
            <strong>${dayLabel(r.day)} ${minuteLabel(r.startMinute)}~${minuteLabel(r.endMinute)}</strong>
            <span>${r.ids.length}명 가능 / ${responded}명 응답 · 전체 ${v.N}명</span>
            <span class="small muted">${names(v.participants.filter((p) => r.ids.includes(p.id)))}</span>
          </li>`)}</ol>`}`}
    <p class="muted small">추천은 제안일 뿐이에요. 확정은 주최자가 직접 해요.</p>
    ${open && v.isOwner && html`<${GridConfirm} v=${v} recs=${recs} reload=${reload} />`}`;
}

// 구간 확정(주최자). 확인 창에 이 구간 내내 가능한 인원과 미응답자를 보여 준다.
async function confirmGridRange(v, target, myItems) {
  const s = kstISO(target.day, target.startMinute);
  const e = kstISO(target.day, target.endMinute);
  const ids = new Set(v.grid.find((x) => x.day === target.day).slots
    .filter((x) => x.minute >= target.startMinute && x.minute < target.endMinute)
    .reduce((acc, x, i) => (i === 0 ? x.people.map((p) => p.id) : acc.filter((id) => x.people.some((p) => p.id === id))), []));
  const chk = await confirmCheck(v, { when: fmtRange(s, e), canCount: ids.size, conflict: conflictText(conflictOf(s, e, busyFrom(myItems, v.meeting.id))).trim() });
  if (chk.skipped) return { skipped: true };
  if (chk.error) return { error: { message: chk.error } };
  return sb.rpc('confirm_grid', { p_meeting_id: v.meeting.id, p_start: s, p_end: e, p_expected_version: chk.version });
}

function RecommendCard({ v, r, responded, reload, canConfirm }) {
  const myCal = useMyCalendar();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function go() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const res = await confirmGridRange(v, r, myCal && myCal.items);
    setBusy(false);
    if (res.skipped) return;
    if (res.error) { setMsg({ type: 'error', text: res.error.message }); reload(); return; }
    toast('일정을 확정했어요. 이제 장소를 정해요!');
    reload();
  }
  return html`<div class="rec-card">
    <div class="rec-body">
      <p class="rec-eyebrow"><${PixelIcon} name="crown" size=${14} color="var(--palette-butter)" /> 추천 시간</p>
      <p class="rec-when">${dayLabelLong(r.day)} ${minuteLabel(r.startMinute)} ~ ${minuteLabel(r.endMinute)}</p>
      <p class="rec-who">${r.ids.length === responded ? `응답한 ${responded}명 모두 가능` : `${r.ids.length}명 가능 / ${responded}명 응답`} · 전체 ${v.N}명
        ${v.schedPending.length ? html`<span class="muted"> (미응답 ${v.schedPending.length}명)</span>` : ''}</p>
      <p class="small muted">${names(v.participants.filter((p) => r.ids.includes(p.id)))}</p>
    </div>
    ${canConfirm && html`<button class="btn small rec-btn" disabled=${busy} onClick=${go}>${busy ? '확인·확정 중…' : '확정하기'}</button>`}
    <${Msg} m=${msg} />
  </div>`;
}

function CellDetail({ v, cell, onClose }) {
  const can = cell.people;
  const cannot = v.schedDone.filter((p) => !can.includes(p));
  return html`<div class="cell-detail" role="region" aria-label="선택한 칸 상세">
    <div class="row-between"><strong>${dayLabel(cell.day)} ${minuteLabel(cell.minute)}~${minuteLabel(cell.minute + SLOT)}</strong>
      <button class="icon-btn" aria-label="닫기" onClick=${onClose}>×</button></div>
    <p>✓ 가능 ${can.length}명: ${can.length ? names(can) : '없음'}</p>
    <p>✕ 응답했지만 불가 ${cannot.length}명: ${cannot.length ? names(cannot) : '없음'}</p>
    <p>미응답 ${v.schedPending.length}명: ${v.schedPending.length ? names(v.schedPending) : '없음'}</p>
  </div>`;
}

function GridConfirm({ v, recs, reload }) {
  const myCal = useMyCalendar();
  const [choice, setChoice] = useState(recs[0] ? 'rec0' : 'custom');
  const [day, setDay] = useState(v.grid[0]?.day);
  const g = v.grid.find((x) => x.day === day);
  const [start, setStart] = useState(g ? g.start : 0);
  const [blocks, setBlocks] = useState(2);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const custom = g ? { day, startMinute: start, endMinute: Math.min(g.end, start + blocks * SLOT) } : null;
  const target = choice.startsWith('rec') ? recs[Number(choice.slice(3))] : custom;

  async function confirmIt() {
    if (!target || busy) return;
    setBusy(true); setMsg(null);
    const res = await confirmGridRange(v, target, myCal && myCal.items);
    setBusy(false);
    if (res.skipped) return;
    if (res.error) { setMsg({ type: 'error', text: res.error.message }); reload(); return; }
    toast('일정을 확정했어요. 이제 장소를 정해요!');
    reload();
  }

  const starts = [];
  if (g) for (let m = g.start; m < g.end; m += SLOT) starts.push(m);
  return html`
    <div class="host-box">
      <h3><${PixelIcon} name="crown" size=${14} /> 다른 시간으로 확정 (주최자)</h3>
      ${recs.map((r, i) => html`<label class="radio ${choice === `rec${i}` ? 'on' : ''}">
        <input type="radio" name="grid-confirm" checked=${choice === `rec${i}`} onChange=${() => setChoice(`rec${i}`)} />
        <span>${dayLabel(r.day)} ${minuteLabel(r.startMinute)}~${minuteLabel(r.endMinute)} <span class="muted small">· ${r.ids.length}명 가능</span></span>
      </label>`)}
      <label class="radio ${choice === 'custom' ? 'on' : ''}">
        <input type="radio" name="grid-confirm" checked=${choice === 'custom'} onChange=${() => setChoice('custom')} />
        <span>직접 고르기</span>
      </label>
      ${choice === 'custom' && g && html`<div class="range-pick wrap">
        <select aria-label="날짜" value=${day} onChange=${(e) => { const nd = e.target.value; setDay(nd); setStart(v.grid.find((x) => x.day === nd).start); }}>
          ${v.grid.map((x) => html`<option value=${x.day}>${dayLabel(x.day)}</option>`)}
        </select>
        <${TimeSelect} label="시작" value=${start} steps=${starts} onChange=${setStart} />
        <select aria-label="길이" value=${blocks} onChange=${(e) => setBlocks(Number(e.target.value))}>
          ${[1, 2, 3, 4, 5, 6, 8].map((b) => html`<option value=${b}>${b * SLOT / 60}시간</option>`)}
        </select>
        <span class="small muted">→ ${minuteLabel(custom.startMinute)}~${minuteLabel(custom.endMinute)}</span>
      </div>`}
      <${Msg} m=${msg} />
      ${(!target || target.endMinute <= target.startMinute) && html`<p class="small hint">확정할 날짜와 시작·길이를 먼저 골라 주세요.</p>`}
      <button class="btn block" disabled=${!target || busy || (target && target.endMinute <= target.startMinute)} onClick=${confirmIt}>${busy ? '확인·확정 중…' : '이 시간으로 일정 확정'}</button>
    </div>`;
}
