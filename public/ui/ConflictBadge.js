// 일정 충돌 표시(나에게만 보임). 색 + 기호 + 글자로 표시하고, 선택을 막지 않는다.
import { html } from '../lib/deps.js';
import { fmtRange } from '../lib/time.js';

const when = (h) => fmtRange(new Date(h.range[0]).toISOString(), new Date(h.range[1]).toISOString());

export function ConflictBadge({ c, compact = false }) {
  if (!c) return null;
  const first = c.hits[0];
  if (c.level === 'fixed') {
    return html`<span class="conflict fixed" role="note">◆ 확정 일정과 시간 겹침${compact ? '' : html`: <b>${first.title}</b> ${when(first)}${c.hits.length > 1 ? ` 외 ${c.hits.length - 1}건` : ''}`}</span>`;
  }
  return html`<span class="conflict maybe" role="note">◇ 후보 시간 중복${compact ? '' : html`: ${first.title}${c.hits.length > 1 ? ` 외 ${c.hits.length - 1}건` : ''}`}</span>`;
}

// 확인 창에 덧붙일 문장
export function conflictText(c) {
  if (!c) return '';
  if (c.level === 'fixed') return `\n◆ 확정 일정과 시간 겹침: ${c.hits.map((h) => `${h.title}(${when(h)})`).join(', ')}\n`;
  return `\n◇ 후보 시간 중복(다른 약속의 아직 정하지 않은 후보): ${c.hits.map((h) => h.title).join(', ')}\n`;
}
