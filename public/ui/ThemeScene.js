// 모임방·약속 배너: 테마 배경(피크닉·바다·카페·밤하늘) + 움직이는 도트 캐릭터.
// - 배경은 캐릭터와 같은 픽셀 그림체로 코드에 그린 장면. Figma 일러스트가 나오면 THEME_IMAGES 에 경로를 넣는다.
// - 캐릭터는 배너 안 자기 레인에서만 움직이고(lib/motion.js), 클릭을 가로채지 않는다(pointer-events: none).
// - 움직임 줄이기(시스템·앱 설정), 화면 밖, 탭 숨김일 때는 멈춘다. small(목록 썸네일)은 항상 정지.
// - 캐릭터 = 멤버/참여자 '존재'일 뿐, 응답 상태가 아니다(dim 은 약속 화면에서 미응답 표시용).
import { html, useState, useEffect, useRef } from '../lib/deps.js';
import { THEMES } from '../lib/groups.js';
import { lanes, pickAction, pickTarget, walkMs, restMs, MAX_ACTORS } from '../lib/motion.js';
import { useReducedMotion } from '../lib/prefs.js';
import { Sprite, SpriteAnim } from './Avatar.js';

export const THEME_IMAGES = {};

const px = (rows, colors, x, y, s = 1, cls = '') => rows.flatMap((r, j) => [...r].map((c, i) => (c === '.' ? null
  : html`<rect class=${cls} x=${x + i * s} y=${y + j * s} width=${s * 1.02} height=${s * 1.02} fill=${colors[c]} />`))).filter(Boolean);

const TREE = ['..GGG..', '.GGgGG.', 'GGGGGgG', 'GgGGGGG', '.GGGGG.', '...T...', '...T...'];
const FLOWER = ['.R.', 'RYR', '.R.', '.g.'];
const BLANKET = ['RWRWRWRW', 'WRWRWRWR'];
const SUN = ['.YYY.', 'YYYYY', 'YYYYY', 'YYYYY', '.YYY.'];
const WAVE = ['.WW...WW...WW..', 'W..W.W..W.W..W.'];
const UMBRELLA = ['..RRRRR..', '.RWRWRWR.', 'RRRRRRRRR', '....K....', '....K....', '....K....'];
const LAMP = ['..K..', '..K..', '.LLL.', 'LLLLL'];
const WIN = ['KKKKKKK', 'KBBKBBK', 'KBBKBBK', 'KKKKKKK', 'KBBKBBK', 'KBBKBBK', 'KKKKKKK'];
const SHELF = ['KKKKKKKKKK', '.C..M..C..', 'KKKKKKKKKK'];
const MOON = ['.MM.', 'MM..', 'MM..', '.MM.'];
const CITY = ['....BB.......BBB....', '....BB..BB...BWB..BB', 'BB..BWB.BB...BBB..BB', 'BWB.BBB.BWBB.BWB.BWB', 'BBBBBWBBBBBBBBBBBBBB'];

function Decor({ theme }) {
  const c = { G: '#7CC56A', g: '#5DAA4E', T: '#8A5A3B', Y: '#FFD54A', W: '#FFFFFF', R: '#FF8469', L: '#FFE49A', K: '#6B4A34', B: '#CFE7FF', M: '#FFE49A', C: '#3B55E8' };
  if (theme === 'picnic') return [...px(TREE, c, 4, 29, 3), ...px(TREE, c, 84, 36, 2), ...px(SUN, c, 50, 19, 2), ...px(FLOWER, c, 30, 40, 1), ...px(FLOWER, c, 70, 42, 1), ...px(BLANKET, c, 58, 45, 2)];
  if (theme === 'beach') return [...px(SUN, c, 84, 19, 2), ...px(WAVE, { W: '#FFFFFF' }, 4, 30, 2, 'wave'), ...px(WAVE, { W: '#FFFFFF' }, 58, 34, 2, 'wave'), ...px(UMBRELLA, c, 6, 38, 2)];
  if (theme === 'cafe') return [...px(WIN, c, 6, 20, 3), ...px(LAMP, c, 46, 16, 2), ...px(LAMP, c, 72, 16, 2), ...px(SHELF, { K: '#8A5A3B', C: '#FF8469', M: '#3B55E8' }, 64, 30, 3)];
  if (theme === 'night') {
    const stars = [[10, 19], [24, 24], [40, 18], [58, 21], [72, 27], [94, 30], [50, 29], [16, 31]].map(([x, y], i) => html`<rect class=${`star s${i % 3}`} x=${x} y=${y} width="1.3" height="1.3" fill="#FFF6C8" />`);
    return [...stars, ...px(MOON, c, 84, 19, 2), ...px(CITY, { B: '#3B3F78', W: '#FFE49A' }, 30, 30, 2)];
  }
  return [];
}

// 배우 한 명: 자기 레인 안에서 대기·걷기·짧게 뛰기
function Actor({ person, lane, size, dim, active, celebrate, seed }) {
  const [x, setX] = useState(lane.home);
  const [state, setState] = useState('idle');
  const [face, setFace] = useState(seed % 2 ? 'left' : 'right');
  const [dur, setDur] = useState(0);
  const timer = useRef(null);
  useEffect(() => {
    if (!active) { clearTimeout(timer.current); setState('idle'); return undefined; }
    let alive = true;
    const loop = (delay) => {
      timer.current = setTimeout(() => {
        if (!alive) return;
        const act = pickAction(Math.random());
        if (act === 'walk') {
          setX((cur) => {
            const to = pickTarget(lane, Math.random());
            const ms = walkMs(cur, to);
            setFace(to < cur ? 'left' : 'right');
            setDur(ms);
            setState('walk');
            timer.current = setTimeout(() => { if (alive) { setState('idle'); loop(restMs(Math.random())); } }, ms);
            return to;
          });
          return;
        }
        if (act === 'jump') { setState('jump'); timer.current = setTimeout(() => { if (alive) { setState('idle'); loop(restMs(Math.random())); } }, 520); return; }
        loop(restMs(Math.random()));
      }, delay);
    };
    loop(400 + seed * 350);
    return () => { alive = false; clearTimeout(timer.current); };
  }, [active, lane.min, lane.max]);
  return html`<span class=${`actor ${dim ? 'dim' : ''}`} data-state=${celebrate ? 'cheer' : state} data-face=${face}
    style=${`left:${x}%;transition-duration:${state === 'walk' ? dur : 0}ms;--blink:${3.2 + (seed % 5) * 0.7}s;--delay:${(seed % 4) * 0.4}s`}>
    <span class="actor-body"><${SpriteAnim} person=${person} size=${size} /></span>
  </span>`;
}

export function ThemeScene({ theme = 'picnic', people = [], dim = () => false, height = 140, small = false, celebrate = false }) {
  const t = THEMES[theme] || THEMES.picnic;
  const img = THEME_IMAGES[theme];
  const reduce = useReducedMotion();
  const box = useRef(null);
  const [visible, setVisible] = useState(true);
  const [pageShown, setPageShown] = useState(typeof document === 'undefined' || document.visibilityState === 'visible');
  const [cheer, setCheer] = useState(false);
  const animate = !small && !reduce;

  useEffect(() => {
    if (!animate || !box.current || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.1 });
    io.observe(box.current);
    const onVis = () => setPageShown(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [animate]);
  // 약속 확정 축하: 이 기기에서 그 약속을 확정 후 처음 볼 때 한 번, 3.6초 동안 함께 점프 + 반짝이.
  // celebrate 에 약속 id(문자열)를 주면 한 번만, true 면 매번.
  useEffect(() => {
    if (!celebrate || !animate) return undefined;
    if (typeof celebrate === 'string') {
      const key = `moiddak:cheered:${celebrate}`;
      try { if (localStorage.getItem(key)) return undefined; localStorage.setItem(key, '1'); } catch { /* 저장 못 하면 그냥 축하 */ }
    }
    setCheer(true);
    const id = setTimeout(() => setCheer(false), 3600);
    return () => clearTimeout(id);
  }, [celebrate, animate]);

  const shown = people.slice(0, small ? 5 : MAX_ACTORS);
  const L = lanes(shown.length);
  const size = small ? 24 : (shown.length > 6 ? 30 : 36);
  const active = animate && visible && pageShown;
  return html`<div ref=${box} class=${`theme-scene th-${theme} ${small ? 'small' : ''} ${animate ? 'animated' : 'still'} ${active ? '' : 'paused'}`}
    style=${`height:${height}px;background:${img ? `url(${img}) center/cover` : t.sky}`} aria-hidden="true">
    ${!img && html`<svg class="scene-decor" viewBox="0 14 100 36" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">${Decor({ theme })}</svg>`}
    <div class="scene-ground" style=${`background:${t.ground};box-shadow:inset 0 4px 0 ${t.groundDark}`}></div>
    ${animate ? html`<div class="scene-stage">
        ${shown.map((p, i) => html`<${Actor} key=${p.id || i} person=${p} lane=${L[i]} size=${size} dim=${dim(p)} active=${active && !cheer} celebrate=${cheer} seed=${i} />`)}
        ${cheer && html`<span class="confetti">${Array.from({ length: 14 }, (_, i) => html`<i style=${`left:${(i * 7 + 4) % 96}%;--c:${['#FF8469', '#FFE49A', '#3B55E8', '#DCD4FF', '#2BA97A'][i % 5]};--d:${(i % 7) * 0.12}s`}></i>`)}</span>`}
      </div>`
      : html`<div class="scene-crowd">
        ${shown.map((p) => html`<span class=${dim(p) ? 'stand pending' : 'stand'}><${Sprite} person=${p} size=${small ? 24 : size} /></span>`)}
      </div>`}
  </div>`;
}
