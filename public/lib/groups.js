// 모임방(지속형) 데이터. 쓰기는 004 의 RPC, 읽기는 group_overview / my_groups RPC.
import { sb } from './sb.js';

export const THEMES = {
  picnic: { label: '피크닉', note: '잔디와 나무', sky: 'linear-gradient(180deg,#DFF1FF 0%,#EEF7FF 60%,#FFF8E6 100%)', ground: '#BFE3A5', groundDark: '#94CC7A', dot: '#2BA97A' },
  beach: { label: '바다', note: '해변과 하늘', sky: 'linear-gradient(180deg,#CFE9FF 0%,#E6F4FF 55%,#BFE6F2 100%)', ground: '#F6E2B3', groundDark: '#E8C988', dot: '#2F8FD8' },
  cafe: { label: '카페', note: '아늑한 실내', sky: 'linear-gradient(180deg,#F6E8DA 0%,#FBF1E6 60%,#F3E2CF 100%)', ground: '#C9A27E', groundDark: '#A9825F', dot: '#B5703C' },
  night: { label: '밤하늘', note: '별과 도시 야경', sky: 'linear-gradient(180deg,#1E2148 0%,#2E3370 60%,#463F86 100%)', ground: '#2A2D52', groundDark: '#1C1E3D', dot: '#7C6CF2' },
};
export const THEME_KEYS = Object.keys(THEMES);

// 004 실행 전이면 ready:false
const notReady = (e) => /my_groups|group_overview|create_group|schema cache|does not exist|Could not find/i.test((e && e.message) || '');

export async function loadMyGroups() {
  const { data, error } = await sb.rpc('my_groups');
  if (error) return notReady(error) ? { ready: false, list: [] } : { ready: true, list: [], error: error.message };
  return { ready: true, list: data || [] };
}

export async function loadGroup(id) {
  const { data, error } = await sb.rpc('group_overview', { p_group_id: id });
  if (error) {
    if (notReady(error)) return { phase: 'notready' };
    if (/멤버만/.test(error.message)) {
      const { data: info } = await sb.rpc('group_public_info', { p_group_id: id });
      return { phase: 'outsider', info };
    }
    return { phase: 'error', error: error.message };
  }
  return { phase: 'ready', ...data };
}

// 관리자 기기에만 남겨 두는 멤버 초대 링크(다시 복사용). 서버·로그로 보내지 않는다.
const key = (id) => `moiddak:group:${id}`;
export function readGroupHost(id) {
  try { return JSON.parse(localStorage.getItem(key(id))) || { invites: {} }; } catch { return { invites: {} }; }
}
export function writeGroupInvites(id, invites) {
  try {
    const cur = readGroupHost(id);
    localStorage.setItem(key(id), JSON.stringify({ ...cur, invites: { ...cur.invites, ...Object.fromEntries(invites.map((i) => [i.member_id, i.token])) } }));
  } catch { /* 저장 못 해도 동작 */ }
}

const base = () => location.origin + location.pathname;
export const groupLink = (id) => `${base()}#/g/${id}`;
export const groupInviteLink = (id, token) => `${base()}#/g/${id}?invite=${token}`;
// 공용 초대 링크(007): 주소의 # 뒤에 있어 서버·리퍼러로 가지 않는다
export const joinLink = (token) => `${base()}#/join?t=${token}`;
export function readJoinToken(id) { return readGroupHost(id).joinToken || null; }
export function writeJoinToken(id, token) {
  try { localStorage.setItem(key(id), JSON.stringify({ ...readGroupHost(id), joinToken: token })); } catch { /* 저장 못 해도 동작 */ }
}
// 공용 초대 기능(007 SQL)이 DB 에 있는지: 없으면 화면에 공용 링크를 보이지 않는다(동작하는 것처럼 보이지 않게)
export const joinNotReady = (e) => /group_join_link|preview_group_join|join_group_with_link|schema cache|Could not find the function/i.test((e && e.message) || '');
