// 참가자 도트 캐릭터. 생김새는 assets/characters 에서 가져오고(교체 가능), 여기서는 상태 표시만 담당한다.
// 상태: 'done' 일정 응답함 · 'pending' 일정 미응답(회색+⏰) · 'none' 응답했지만 가능 시간 없음 · 'neutral' 응답 표시 없음(확정 후 명단)
// 캐릭터가 보인다고 '참석 확정'이 아니다 — 상태 글자를 항상 함께 쓴다.
import { html } from '../lib/deps.js';
import { PixelIcon } from './Pixel.js';
import { spriteOf, typeOf, IMAGE_OVERRIDES } from '../assets/characters/index.js';

export const STATE_TEXT = { pending: '일정 미응답', done: '일정 응답함', none: '응답 · 가능 시간 없음' };

// 도트가 번지지 않도록 너비를 24px 의 정수배로 맞춘다(24×32 원본 기준 1배·2배·3배…).
const snap = (size) => Math.max(24, Math.round(size / 24) * 24);
const broken = new Set(); // 불러오기 실패한 이미지 → 코드 도트로 대체

export function Sprite({ person, type, size = 48, className = '' }) {
  const t = type || typeOf(person);
  const img = IMAGE_OVERRIDES[t];
  const w = snap(size);
  if (img && !broken.has(img)) {
    return html`<img class="sprite pixel ${className}" src=${img} alt="" width=${w} height=${(w / 3) * 4} decoding="async"
      onError=${(e) => { broken.add(img); e.currentTarget.style.visibility = 'hidden'; }} />`;
  }
  const { rows, colors } = spriteOf(t);
  const rects = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') rects.push(html`<rect x=${x} y=${y} width="1.02" height="1.02" fill=${colors[c]} />`);
  }));
  return html`<svg class="sprite ${className}" viewBox="0 0 12 16" width=${size} height=${Math.round(size * 4 / 3)}
    shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// 움직이는 배너용 도트(같은 그림에서 프레임만 파생): 눈 감기(깜빡임)·걷는 발 두 장.
// 몸은 그대로 두고 눈·발 부분만 겹쳐 그려서, CSS 가 보이기/숨기기만 바꾼다(가벼움).
const FEET_ROWS = 2;
const WALK_FEET = ['..KPPKKPPK..', '.KBBK...KBBK'];
export function SpriteAnim({ person, type, size = 38 }) {
  const t = type || typeOf(person);
  const { rows, colors } = spriteOf(t);
  const cell = (x, y, c, key) => html`<rect key=${key} x=${x} y=${y} width="1.02" height="1.02" fill=${colors[c]} />`;
  const base = [];
  const eyes = [];
  const lids = [];
  const feetA = [];
  const feetB = [];
  const footStart = rows.length - FEET_ROWS;
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    if (y >= footStart) { feetA.push(cell(x, y, c, `a${x}-${y}`)); return; }
    if (c === 'E') { eyes.push(cell(x, y, c, `e${x}-${y}`)); lids.push(html`<rect x=${x} y=${y} width="1.02" height="1.02" fill=${colors.S} />`); return; }
    base.push(cell(x, y, c, `b${x}-${y}`));
  }));
  WALK_FEET.forEach((row, j) => [...row].forEach((c, x) => { if (c !== '.') feetB.push(cell(x, footStart + j, c, `w${x}-${j}`)); }));
  return html`<svg class="sprite anim" viewBox="0 0 12 16" width=${size} height=${Math.round(size * 4 / 3)} shape-rendering="crispEdges" aria-hidden="true">
    <g>${base}</g><g class="eyes">${eyes}</g><g class="lids">${lids}</g><g class="feet-a">${feetA}</g><g class="feet-b">${feetB}</g>
  </svg>`;
}

// 캐릭터 + 이름 + 상태(점·글자)
export function Avatar({ person, state = 'done', you = false, host = false, size = 44, extra = [] }) {
  return html`
    <figure class="avatar st-${state}">
      <div class="seat">
        <${Sprite} person=${person} size=${size} />
        ${state === 'pending' && html`<span class="badge pending" aria-hidden="true"><${PixelIcon} name="clock" size=${11} /></span>`}
        ${state === 'done' && html`<span class="badge done" aria-hidden="true">✓</span>`}
        ${state === 'none' && html`<span class="badge none" aria-hidden="true">✕</span>`}
      </div>
      <figcaption>
        <strong>${person.display_name}${you ? ' (나)' : ''}</strong>
        ${STATE_TEXT[state] && html`<span class="state-text"><i class="dot" aria-hidden="true"></i>${STATE_TEXT[state]}</span>`}
        ${extra.filter(Boolean).map((t) => html`<span class="extra-text">${t}</span>`)}
        ${host && html`<span class="host-tag">주최자</span>`}
      </figcaption>
    </figure>`;
}

// 작은 캐릭터 줄(홈 카드 등). 미응답은 회색으로.
export function AvatarRow({ people, pendingIds = new Set(), max = 6, size = 24 }) {
  const shown = people.slice(0, max);
  return html`<span class="avatar-row" aria-hidden="true">
    ${shown.map((p) => html`<span class=${pendingIds.has(p.id) ? 'mini pending' : 'mini'}><${Sprite} person=${p} size=${size} /></span>`)}
    ${people.length > max && html`<span class="more">+${people.length - max}</span>`}
  </span>`;
}
