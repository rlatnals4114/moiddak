import { useState, useEffect } from './deps.js';

export const STATUS_LABEL = { schedule_open: '일정 조사 중', place_open: '장소 정하는 중', finalized: '약속 완성' };
export const MODE_LABEL = { poll: '시간 후보 투표', grid: '30분 시간표' };
// 장소 분류(006). 모두 선택 사항 — 필요한 것만 정한다. kakaoCode = 카카오 장소 검색 카테고리
export const KIND = {
  meeting_point: { label: '집결지', icon: '📍', note: '처음 만나는 곳', kakaoCode: undefined },
  restaurant: { label: '식당', icon: '🍽', note: '밥 먹을 곳', kakaoCode: 'FD6' },
  cafe: { label: '카페', icon: '☕', note: '쉬어 갈 곳', kakaoCode: 'CE7' },
  activity: { label: '놀거리', icon: '🎳', note: '전시·공연·체험', kakaoCode: 'CT1' },
  attraction: { label: '관광지', icon: '🏞', note: '구경할 곳', kakaoCode: 'AT4' },
  etc: { label: '기타', icon: '📌', note: '그 밖의 장소', kakaoCode: undefined },
};
export const KIND_KEYS = Object.keys(KIND);
// 카카오 검색 결과 분류 → 모이딱 분류 추천
export const guessKind = (r) => ({ FD6: 'restaurant', CE7: 'cafe', CT1: 'activity', AT4: 'attraction', SW8: 'meeting_point' }[r && r.category_group_code] || 'etc');

export const safeUrl = (u) => (u && /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : null);
export const names = (list) => list.map((p) => p.display_name).join(', ');

const base = () => location.origin + location.pathname;
export const meetingLink = (id) => `${base()}#/m/${id}`;
export const inviteLink = (id, token) => `${base()}#/m/${id}?invite=${token}`;
export const adminLink = (id, token) => `${base()}#/m/${id}?admin=${token}`;
// 일회성 약속 참여 링크(010). # 뒤라 서버·리퍼러로 가지 않는다
export const meetingJoinLink = (token) => `${base()}#/join-m?t=${token}`;

export function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
export const toast = (text) => emit('moiddak:toast', text);

export async function copyText(text, done = '복사했어요. 카카오톡에 붙여 넣어 주세요.') {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    emit('moiddak:manual-copy', text);
  }
}

// 공유하기: 지원하는 기기에서는 공유 시트, 아니면 복사로 대신한다. 사용자가 취소하면 아무 말도 하지 않는다.
export async function shareOrCopy({ title, text, url }, done) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  await copyText(text ? `${text}\n${url}` : url, done);
  return 'copied';
}

// 주최자 기기에만 남겨 두는 초대·관리자 링크(나중에 다시 복사하려고). 서버·로그로 보내지 않는다.
const hostKey = (id) => `moiddak:host:${id}`;
export function readHost(id) {
  try { return JSON.parse(localStorage.getItem(hostKey(id))) || { invites: {} }; } catch { return { invites: {} }; }
}
export function writeHost(id, patch) {
  try {
    const cur = readHost(id);
    localStorage.setItem(hostKey(id), JSON.stringify({ ...cur, ...patch, invites: { ...cur.invites, ...(patch.invites || {}) } }));
  } catch { /* 저장 못 해도 화면은 동작한다 */ }
}

// ───────── 라우팅: #/ · #/new · #/m/<id>[/schedule|/place|/host][?invite=…] ─────────
export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const m = path.match(/^\/m\/([0-9a-f-]{36})(?:\/(schedule|place|host))?\/?$/i);
  if (m) return { name: 'meeting', id: m[1], tab: m[2] || 'home', params };
  if (path === '/new') return { name: 'new', params };
  if (path === '/calendar') return { name: 'calendar', params };
  if (path === '/join') return { name: 'join', params };
  if (path === '/join-m') return { name: 'join-meeting', params };
  if (path === '/groups') return { name: 'groups', params };
  if (path === '/groups/new') return { name: 'group-new', params };
  const g = path.match(/^\/g\/([0-9a-f-]{36})(?:\/(settings|new))?\/?$/i);
  if (g) return { name: 'group', id: g[1], sub: g[2] || 'home', params };
  if (path === '/me' || path === '/me/character') return { name: 'me', sub: path === '/me/character' ? 'character' : 'home', params };
  return { name: 'home', params };
}
export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
export const go = (path) => { location.hash = `#${path}`; };
// 토큰이 주소창·방문 기록에 남지 않게 지운다.
export const cleanUrl = (path) => history.replaceState(null, '', `${location.pathname}#${path}`);
