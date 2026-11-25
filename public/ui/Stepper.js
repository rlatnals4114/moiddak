// 약속 진행 스텝퍼: 아이콘 + 연결선 + 단계명·상태.
// 완료 = 초록 ✓ · 진행 중 = 파랑 채운 원 · 대기 = 회색 빈 원. 모양·글자로도 구분하고, 진행 중 단계는 aria-current="step".
// 연결선은 실제 단계 상태로만 칠한다(완료 구간 초록 · 진행 중 구간 초록→파랑 · 대기 구간 회색). 임의의 진행률은 그리지 않는다.
import { html } from '../lib/deps.js';
import { segmentState } from '../lib/schedule.js';
import { PixelIcon } from './Pixel.js';

const WORD = { done: '완료', now: '진행 중', wait: '대기', skip: '생략' };

export function Stepper({ steps, label = '약속 진행 상태' }) {
  return html`<ol class="stepper" aria-label=${label} style=${`grid-template-columns:repeat(${steps.length},1fr)`}>
    ${steps.map((s, i) => html`<li class=${`st-${s.state}`} aria-current=${s.state === 'now' ? 'step' : null}>
      ${i > 0 && html`<span class=${`line seg-${segmentState(steps[i - 1].state, s.state)}`} aria-hidden="true"></span>`}
      <span class="icon" aria-hidden="true">${s.state === 'done' ? '✓' : s.state === 'skip' ? html`<${PixelIcon} name="skip" size=${12} />` : ''}</span>
      <span class="label">${s.label}</span>
      ${s.note && html`<span class="note">${s.note}</span>`}
      <span class="sr-only">${WORD[s.state]}</span>
    </li>`)}
  </ol>`;
}
