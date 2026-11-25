// B 모드 시간표: 입력(GridInput)과 결과(DayMatrix, 참가자별 하루 시간표)를 분리해 오입력을 막는다.
// 입력은 드래그 없이 탭·구간 일괄 선택·빠른 범위로 한다(스크롤 중 오작동 방지).
import { html, useState } from '../lib/deps.js';
import { SLOT, minuteLabel, dayLabel, toRanges } from '../lib/time.js';
import { TimeSelect } from './common.js';
import { Sprite } from './Avatar.js';
import { PixelIcon } from './Pixel.js';
import { bulkKeys, bulkPreview, bulkApply } from '../lib/gridbulk.js';

const PRESETS = [
  { label: '오전', from: 0, to: 12 * 60 },
  { label: '오후', from: 12 * 60, to: 18 * 60 },
  { label: '저녁', from: 18 * 60, to: 24 * 60 },
];

// 하루치 입력. selected: Set<slotKey(ms)>
// busyOf(slot) → 내 다른 약속과의 충돌({level, hits}) 또는 null. 표시만 하고 선택은 막지 않는다.
export function GridInput({ day, selected, onChange, busyOf = () => null }) {
  const [from, setFrom] = useState(day.start);
  const [to, setTo] = useState(day.end);
  const keysIn = (a, b) => day.slots.filter((s) => s.minute >= a && s.minute + SLOT <= b).map((s) => s.key);
  const setMany = (keys, on) => { const n = new Set(selected); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); onChange(n); };
  const toggle = (k) => setMany([k], !selected.has(k));
  const steps = [];
  for (let m = day.start; m <= day.end; m += SLOT) steps.push(m);
  const mine = day.slots.filter((s) => selected.has(s.key));
  const ranges = toRanges(mine.map((s) => s.minute));
  const presets = PRESETS.map((p) => ({ ...p, keys: keysIn(Math.max(p.from, day.start), Math.min(p.to, day.end)) })).filter((p) => p.keys.length);

  return html`
    <div class="grid-input">
      <div class="tools">
        <div class="range-pick">
          <${TimeSelect} label="구간 시작" value=${from} steps=${steps.slice(0, -1)} onChange=${setFrom} />
          <span class="muted">~</span>
          <${TimeSelect} label="구간 끝" value=${to} steps=${steps.slice(1)} onChange=${setTo} />
        </div>
        <div class="btn-row tight">
          <button type="button" class="btn small" disabled=${to <= from} onClick=${() => setMany(keysIn(from, to), true)}>이 구간 가능</button>
          <button type="button" class="btn ghost small" disabled=${to <= from} onClick=${() => setMany(keysIn(from, to), false)}>이 구간 해제</button>
        </div>
        <div class="btn-row tight">
          ${presets.map((p) => html`<button type="button" class="chip-btn" onClick=${() => setMany(p.keys, true)}>+ ${p.label}</button>`)}
          <button type="button" class="chip-btn" onClick=${() => setMany(day.slots.map((s) => s.key), true)}>+ 하루 전체</button>
          <button type="button" class="chip-btn" disabled=${!mine.length} onClick=${() => setMany(day.slots.map((s) => s.key), false)}>이 날 모두 해제</button>
        </div>
      </div>
      <p class="small" aria-live="polite">
        ${dayLabel(day.day)} 고른 시간: ${ranges.length ? ranges.map((r) => `${minuteLabel(r.start)}~${minuteLabel(r.end)}`).join(', ') : '없음'}
      </p>
      <div class="slots" role="group" aria-label=${`${dayLabel(day.day)} 30분 칸`}>
        ${day.slots.map((s) => {
          const on = selected.has(s.key);
          const c = busyOf(s);
          const busyCls = c ? (c.level === 'fixed' ? 'busy-fixed' : 'busy-maybe') : '';
          const busyText = c ? (c.level === 'fixed' ? '◆ 내 다른 약속' : '◇ 후보 겹침') : '';
          return html`<button type="button" class="slot ${on ? 'on' : ''} ${busyCls} ${s.minute % 60 === 0 ? 'hour' : ''}" aria-pressed=${on}
            aria-label=${`${minuteLabel(s.minute)} ${on ? '가능' : '선택 안 함'}${c ? `, ${c.level === 'fixed' ? '내 다른 확정 약속과 겹침' : '다른 약속 후보와 겹칠 수 있음'}: ${c.hits[0].title}` : ''}`}
            title=${c ? c.hits.map((h) => h.title).join(', ') : ''} onClick=${() => toggle(s.key)}>
            <span class="t">${minuteLabel(s.minute)}</span><span class="v">${on ? '✓ 가능' : busyText}</span></button>`;
        })}
      </div>
      ${day.slots.some((s) => busyOf(s)) && html`<p class="muted small">◆ 빗금 칸은 내 다른 확정 약속, ◇ 점선 칸은 투표 중인 다른 약속과 겹쳐요(나에게만 보여요). 그래도 가능하면 골라도 돼요.</p>`}
    </div>`;
}

// '여러 날 한 번에': 날짜 여러 개 + 시간 구간 하나 → 미리보기 → 가능으로 추가 / 해제. 기존 선택은 덮어쓰지 않는다.
export function MultiDayInput({ grid, selected, onChange }) {
  const [days, setDays] = useState(() => new Set(grid.map((g) => g.day)));
  const lo = Math.min(...grid.map((g) => g.start));
  const hi = Math.max(...grid.map((g) => g.end));
  const [from, setFrom] = useState(Math.max(lo, Math.min(18 * 60, hi - 60)));
  const [to, setTo] = useState(hi);
  const steps = [];
  for (let m = lo; m <= hi; m += SLOT) steps.push(m);
  const toggleDay = (d) => setDays((cur) => { const n = new Set(cur); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  const { items, outside } = bulkKeys(grid, days, from, to);
  const add = bulkPreview(selected, items, true);
  const del = bulkPreview(selected, items, false);
  const presets = PRESETS.map((p) => ({ ...p, from: Math.max(p.from, lo), to: Math.min(p.to, hi) })).filter((p) => p.to > p.from);
  return html`<div class="grid-input multi">
    <p class="small"><strong>1. 날짜 고르기</strong> <span class="muted">(${days.size}/${grid.length}일)</span></p>
    <div class="btn-row tight" role="group" aria-label="적용할 날짜">
      ${grid.map((g) => html`<button type="button" class=${days.has(g.day) ? 'chip-btn on' : 'chip-btn'} aria-pressed=${days.has(g.day)} onClick=${() => toggleDay(g.day)}>${dayLabel(g.day)}</button>`)}
      <button type="button" class="chip-btn" onClick=${() => setDays(new Set(days.size === grid.length ? [] : grid.map((g) => g.day)))}>${days.size === grid.length ? '모두 해제' : '모두 선택'}</button>
    </div>
    <p class="small"><strong>2. 시간 구간</strong></p>
    <div class="range-pick">
      <${TimeSelect} label="여러 날 구간 시작" value=${from} steps=${steps.slice(0, -1)} onChange=${setFrom} />
      <span class="muted">~</span>
      <${TimeSelect} label="여러 날 구간 끝" value=${to} steps=${steps.slice(1)} onChange=${setTo} />
    </div>
    <div class="btn-row tight">${presets.map((p) => html`<button type="button" class="chip-btn" onClick=${() => { setFrom(p.from); setTo(p.to); }}>${p.label}</button>`)}</div>
    <p class="small bulk-preview" aria-live="polite">
      ${to <= from || !days.size ? '날짜와 시간 구간을 골라 주세요.'
        : `${days.size}일 · ${minuteLabel(from)}~${minuteLabel(to)} → 새로 가능 ${add.change}칸 추가${add.already ? ` (이미 고른 ${add.already}칸은 그대로)` : ''}${outside ? ` · 조사 시간 밖 ${outside}칸은 제외` : ''}`}
    </p>
    <div class="btn-row tight">
      <button type="button" class="btn small" disabled=${!add.change} onClick=${() => onChange(bulkApply(selected, items, true))}>3. 이 날짜들에 가능으로 추가</button>
      <button type="button" class="btn ghost small" disabled=${!del.change} onClick=${() => onChange(bulkApply(selected, items, false))}>이 구간 해제 (${del.change}칸)</button>
    </div>
    <p class="muted small">추가·해제는 아직 저장 전이에요. 날짜별로 고치려면 ‘하루씩’으로 바꿔서 수정하고, 아래 ‘응답 제출’을 눌러야 저장돼요.</p>
  </div>`;
}

// 선택한 날의 참가자별 시간표: 열 = 참가자(캐릭터·이름), 행 = 30분 칸, 마지막 열 = 가능 인원.
// 칸 색 = 그 사람이 가능(파랑) · 응답했지만 불가(빈 칸) · 미응답(회색 빗금). 행을 누르면 이름 상세가 열린다.
export function DayMatrix({ day, participants, doneIds, N, picked, onPick }) {
  const max = Math.max(0, ...day.slots.map((s) => s.people.length));
  const level = (n) => (n === 0 ? 0 : Math.min(5, Math.ceil((n / N) * 5)));
  return html`
    <div class="matrix-wrap">
      <table class="matrix" aria-label=${`${dayLabel(day.day)} 참가자별 가능 시간`}>
        <thead><tr>
          <th scope="col" class="t">시간</th>
          ${participants.map((p) => html`<th scope="col" class=${doneIds.has(p.id) ? '' : 'pending'}>
            <${Sprite} person=${p} size=${22} /><span>${p.display_name}</span></th>`)}
          <th scope="col" class="n">가능<br />인원</th>
        </tr></thead>
        <tbody>
          ${day.slots.map((s) => {
            const n = s.people.length;
            const ids = new Set(s.people.map((p) => p.id));
            return html`<tr class=${picked === s.key ? 'picked' : ''} onClick=${() => onPick(s)}>
              <th scope="row" class="t">${minuteLabel(s.minute)}</th>
              ${participants.map((p) => {
                const st = !doneIds.has(p.id) ? 'pending' : ids.has(p.id) ? 'yes' : 'no';
                return html`<td class=${`c ${st} h${level(n)}`}><span class="sr-only">${p.display_name} ${st === 'yes' ? '가능' : st === 'no' ? '불가' : '미응답'}</span></td>`;
              })}
              <td class="n"><button type="button" class="n-btn" aria-label=${`${minuteLabel(s.minute)} ${N}명 중 ${n}명 가능, 상세 보기`}>
                ${n === max && n > 0 && html`<${PixelIcon} name="crown" size=${11} color="var(--palette-butter)" className="crown" />`}${n}/${N}</button></td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>
    <p class="matrix-legend small"><span><i class="sw yes"></i>가능</span><span><i class="sw no"></i>응답했지만 불가</span><span><i class="sw pending"></i>미응답</span>
      <span>진한 파랑일수록 그 시간에 가능한 사람이 많아요</span></p>`;
}
