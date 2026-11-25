// 앱 설정(이 기기에만 저장). 지금은 '움직임 줄이기' 하나.
// 시스템 설정(prefers-reduced-motion)이 켜져 있거나 앱 설정을 켜면 캐릭터·배경 애니메이션을 멈춘다.
import { useState, useEffect } from './deps.js';

const KEY = 'moiddak:reduceMotion';
export function getReduceMotionSetting() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setReduceMotionSetting(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
  window.dispatchEvent(new CustomEvent('moiddak:prefs', { detail: { reduceMotion: on } }));
}
const systemReduce = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export function useReducedMotion() {
  const calc = () => systemReduce() || getReduceMotionSetting();
  const [reduce, setReduce] = useState(calc);
  useEffect(() => {
    const on = () => setReduce(calc());
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    window.addEventListener('moiddak:prefs', on);
    if (mq && mq.addEventListener) mq.addEventListener('change', on);
    return () => { window.removeEventListener('moiddak:prefs', on); if (mq && mq.removeEventListener) mq.removeEventListener('change', on); };
  }, []);
  return reduce;
}
