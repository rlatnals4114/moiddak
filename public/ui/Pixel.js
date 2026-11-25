// 픽셀 장식(별·하트·반짝이·왕관·구름)과 로고. 모두 장식이라 aria-hidden, 클릭을 가로채지 않는다(CSS pointer-events:none).
// 로고 이미지가 나오면 LOGO_IMAGE 에 경로만 넣으면 된다.
import { html } from '../lib/deps.js';

export const LOGO_IMAGE = '';

const ICONS = {
  star: { w: 5, rows: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.'] },
  sparkle: { w: 5, rows: ['..X..', '..X..', 'XXXXX', '..X..', '..X..'] },
  heart: { w: 7, rows: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'] },
  crown: { w: 7, rows: ['X..X..X', 'XX.X.XX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.'] },
  cloud: { w: 9, rows: ['...XXX...', '.XXXXXXX.', 'XXXXXXXXX', '.XXXXXXX.'] },
  pin: { w: 5, rows: ['.XXX.', 'XX.XX', 'XXXXX', '.XXX.', '..X..'] },
  cal: { w: 7, rows: ['X.....X', 'XXXXXXX', 'X.....X', 'X.X.X.X', 'X.....X', 'XXXXXXX'] },
  bowl: { w: 7, rows: ['.X.X.X.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'] },
  cup: { w: 7, rows: ['.X.X...', 'XXXXX..', 'XXXXXXX', 'XXXXX.X', 'XXXXXX.', '.XXX...'] },
  house: { w: 7, rows: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.X...X.', '.X.X.X.', '.XXXXX.'] },
  people: { w: 9, rows: ['.XX...XX.', '.XX...XX.', '.........', 'XXXX.XXXX', 'XXXX.XXXX', 'XXXX.XXXX'] },
  person: { w: 5, rows: ['.XXX.', '.XXX.', '.....', 'XXXXX', 'XXXXX', 'XXXXX'] },
  question: { w: 5, rows: ['.XXX.', 'XX.XX', '...XX', '..XX.', '..X..', '.....', '..X..'] },
  ticket: { w: 7, rows: ['XXXXXXX', 'XX...XX', '.X.X.X.', 'XX...XX', 'XXXXXXX'] },
  mountain: { w: 9, rows: ['....X....', '...XXX...', '..XXXXX.X', '.XXXXXXXX', 'XXXXXXXXX'] },
  flag: { w: 6, rows: ['XXXXX.', 'XXXXXX', 'XXXXX.', 'X.....', 'X.....', 'X.....', 'X.....'] },
  clock: { w: 7, rows: ['..XXX..', '.X...X.', 'X..X..X', 'X..XX.X', 'X.....X', '.X...X.', '..XXX..'] },
  check: { w: 7, rows: ['......X', '.....XX', 'X...XX.', 'XX.XX..', '.XXX...', '..X....'] },
  skip: { w: 7, rows: ['X..X..X', 'XX.XX.X', 'XXXXXXX', 'XX.XX.X', 'X..X..X'] },
  back: { w: 4, rows: ['...X', '..XX', '.XX.', 'XX..', '.XX.', '..XX', '...X'] },
  refresh: { w: 7, rows: ['..XXXX.', '.X...XX', 'X...XXX', 'X......', 'X.....X', '.X...X.', '..XXX..'] },
  chat: { w: 8, rows: ['.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '.XX.....', 'X.......'] },
  chev: { w: 4, rows: ['X...', 'XX..', '.XX.', '..XX', '.XX.', 'XX..', 'X...'] },
};

export function PixelIcon({ name, size = 14, color = 'currentColor', className = '' }) {
  const ic = ICONS[name];
  if (!ic) return null;
  const h = ic.rows.length;
  const rects = [];
  ic.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') rects.push(html`<rect x=${x} y=${y} width="1.02" height="1.02" />`); }));
  return html`<svg class="pixel-icon ${className}" viewBox=${`0 0 ${ic.w} ${h}`} width=${size} height=${Math.round((size * h) / ic.w)}
    fill=${color} shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

export function Logo({ small = false }) {
  if (LOGO_IMAGE) return html`<img class="logo-img ${small ? 'small' : ''}" src=${LOGO_IMAGE} alt="모이딱" />`;
  return html`<span class="logo ${small ? 'small' : ''}" role="img" aria-label="모이딱">
    <${PixelIcon} name="sparkle" size=${small ? 8 : 12} className="logo-spark l" color="var(--palette-butter)" />
    <span aria-hidden="true">모이딱</span>
    <${PixelIcon} name="star" size=${small ? 8 : 12} className="logo-spark r" color="var(--palette-coral)" />
  </span>`;
}

// 하늘 배경 장식(구름·별). 내용 뒤에 깔리고 클릭을 막지 않는다.
export function SkyDecor() {
  return html`<span class="sky-decor" aria-hidden="true">
    <${PixelIcon} name="cloud" size=${36} color="#FFFFFF" className="c1" />
    <${PixelIcon} name="cloud" size=${26} color="#FFFFFF" className="c2" />
    <${PixelIcon} name="star" size=${10} color="var(--palette-butter)" className="s1" />
    <${PixelIcon} name="sparkle" size=${9} color="var(--palette-lilac)" className="s2" />
    <${PixelIcon} name="heart" size=${10} color="var(--palette-coral)" className="s3" />
  </span>`;
}

// 장소 분류 픽셀 아이콘(같은 격자·같은 채움). 색은 CSS(.kicon.k-분류). 글자 라벨과 함께 쓴다.
export const KIND_PIXEL = { meeting_point: 'pin', restaurant: 'bowl', cafe: 'cup', activity: 'ticket', attraction: 'mountain', etc: 'flag' };
export function KindIcon({ kind, size = 14 }) {
  return html`<span class=${`kicon k-${kind}`} aria-hidden="true"><${PixelIcon} name=${KIND_PIXEL[kind] || 'flag'} size=${size} /></span>`;
}
