// 하단 탭 바: 홈 · 캘린더 · 모임방 · 내 정보. 맨 위 화면에서만 보이고 약속·만들기 화면에서는 숨긴다(app.js).
import { html } from '../lib/deps.js';
import { PixelIcon } from './Pixel.js';

const TABS = [
  { key: 'home', href: '#/', label: '홈', icon: 'house' },
  { key: 'calendar', href: '#/calendar', label: '캘린더', icon: 'cal' },
  { key: 'groups', href: '#/groups', label: '모임방', icon: 'people' },
  { key: 'me', href: '#/me', label: '내 정보', icon: 'person' },
];

export function TabBar({ active }) {
  return html`<nav class="tabbar" aria-label="주요 메뉴">
    ${TABS.map((t) => html`<a href=${t.href} class=${active === t.key ? 'on' : ''} aria-current=${active === t.key ? 'page' : null}>
      <${PixelIcon} name=${t.icon} size=${20} /><span>${t.label}</span></a>`)}
  </nav>`;
}

// 라우트 → 탭(없으면 탭 바 숨김)
export function tabOf(route) {
  if (route.name === 'home') return 'home';
  if (route.name === 'calendar') return 'calendar';
  if (route.name === 'groups' || (route.name === 'group' && route.sub === 'home')) return 'groups';
  if (route.name === 'me' && route.sub === 'home') return 'me';
  return null;
}
