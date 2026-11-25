// 월간 달력. 날짜 키(KST 'YYYY-MM-DD')로만 다룬다.
// marks: { [day]: { text: '2개', tone: 'all'|'some'|'none'|'pending'|'plain' } }
// 상태는 점 색 + 모양(● ◐ ✕ ○) + 글자로 함께 표시한다(색만으로 구분하지 않음).
import { html, useState } from '../lib/deps.js';
import { PixelIcon } from './Pixel.js';
import { pad, weekday, todayKey } from '../lib/time.js';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const TONE = {
  all: { sym: '●', label: '응답자 모두 가능' },
  some: { sym: '◐', label: '일부 가능' },
  none: { sym: '✕', label: '가능한 사람 없음' },
  pending: { sym: '○', label: '응답 없음' },
  plain: { sym: '●', label: '' },
};

export function CalendarLegend({ tones = ['all', 'some', 'none', 'pending'] }) {
  return html`<p class="cal-legend">${tones.map((t) => html`<span class="tone-${t}"><b aria-hidden="true">${TONE[t].sym}</b>${TONE[t].label}</span>`)}</p>`;
}

export function Calendar({ initial, marks = {}, isSelected = () => false, isEnabled = () => true, onPick, label = '달력' }) {
  const start = initial || Object.keys(marks).sort()[0] || todayKey();
  const [ym, setYm] = useState(start.slice(0, 7));
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = weekday(first);
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${ym}-${pad(i + 1)}`)];
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`); };
  const today = todayKey();

  return html`
    <div class="calendar" aria-label=${label}>
      <div class="cal-head">
        <button type="button" class="icon-btn" aria-label="이전 달" onClick=${() => shift(-1)}><${PixelIcon} name="back" size=${14} /></button>
        <strong>${y}년 ${m}월</strong>
        <button type="button" class="icon-btn" aria-label="다음 달" onClick=${() => shift(1)}><${PixelIcon} name="chev" size=${14} /></button>
      </div>
      <div class="cal-grid">
        ${WD.map((w, i) => html`<div class="cal-wd ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}" aria-hidden="true">${w}</div>`)}
        ${cells.map((day) => {
          if (!day) return html`<div class="cal-cell empty" aria-hidden="true"></div>`;
          const mk = marks[day];
          const sel = isSelected(day);
          const ok = isEnabled(day);
          const wd = weekday(day);
          const tone = mk ? mk.tone || 'plain' : '';
          const toneText = mk && mk.dots ? (mk.alert ? ', 내 응답 필요' : '') : mk && TONE[tone].label ? `, ${TONE[tone].label}` : '';
          return html`<button type="button"
            class="cal-cell ${sel ? 'sel' : ''} ${mk ? `has tone-${tone}` : ''} ${day === today ? 'today' : ''} ${wd === 0 ? 'sun' : wd === 6 ? 'sat' : ''}"
            aria-pressed=${sel} disabled=${!ok}
            aria-label=${`${m}월 ${Number(day.slice(8))}일 ${WD[wd]}요일${mk ? `, ${mk.text}` : ''}${toneText}${sel ? ', 선택됨' : ''}`}
            onClick=${() => onPick && onPick(day)}>
            <span class="num">${Number(day.slice(8))}</span>
            ${mk && !mk.dots && html`<span class="mark" aria-hidden="true"><b>${TONE[tone].sym}</b>${mk.text}</span>`}
            ${mk && mk.dots && html`<span class="dots" aria-hidden="true">${mk.dots.map((d) => html`<i class=${d.fixed ? 'd fixed' : 'd cand'} style=${`--c:${d.color}`}></i>`)}</span>`}
            ${mk && mk.alert && html`<span class="alert-mark" aria-hidden="true">!</span>`}
          </button>`;
        })}
      </div>
    </div>`;
}
