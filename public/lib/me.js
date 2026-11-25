// 내 프로필(닉네임·캐릭터)을 화면들이 함께 쓰는 작은 저장소. 서버 값은 profiles 표(003 마이그레이션).
import { useState, useEffect } from './deps.js';
import { loadMyProfile, saveMyProfile } from './sb.js';
import { TYPE_KEYS } from '../assets/characters/index.js';

let cache = null;
const subs = new Set();
const publish = () => subs.forEach((f) => f(cache));

export async function refreshMe() {
  cache = await loadMyProfile();
  publish();
  return cache;
}

export async function saveMe(nickname, avatar) {
  const res = await saveMyProfile(nickname, avatar);
  if (!res.error) { cache = { ...cache, nickname: nickname || null, avatar: avatar || (cache && cache.avatar) || {} }; publish(); }
  return res;
}

export function useMe() {
  const [me, setMe] = useState(cache);
  useEffect(() => {
    subs.add(setMe);
    if (!cache) refreshMe();
    return () => subs.delete(setMe);
  }, []);
  return me;
}

// 처음 쓰는 사람: 캐릭터를 아직 안 골랐으면 4종 중 하나를 무작위로 골라 프로필에 저장한다.
// 프로필에 저장되므로 이후 참여하는 모든 약속·모임방에 같은 캐릭터로 보인다(내 정보에서 언제든 바꿀 수 있음).
// 한 번 정해진 기기는 다시 확인하지 않는다(localStorage 표시).
const CHAR_FLAG = 'moiddak:char-assigned';
export async function ensureCharacter() {
  try { if (localStorage.getItem(CHAR_FLAG)) return; } catch { /* 저장소를 못 쓰면 매번 확인 */ }
  const me = await refreshMe();
  if (!me || me.ready === false || me.error) return;
  if (!(me.avatar && me.avatar.base)) {
    const base = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
    const res = await saveMe(me.nickname || null, { ...(me.avatar || {}), v: 1, base });
    if (res.error) return;
  }
  try { localStorage.setItem(CHAR_FLAG, '1'); } catch { /* 무시 */ }
}

// 내 캐릭터 종류(아직 정해지지 않았으면 민트)
export const myBase = (me) => (me && me.avatar && me.avatar.base) || 'mint';
