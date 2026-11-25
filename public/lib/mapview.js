// 장소 지도의 처음 보이는 범위(순수 함수). 화면은 ui/KakaoMap.js.
// 우선순위: ① 유효한 후보 좌표 → 후보가 모두 보이게 ② 후보가 없으면 이 기기에서 이 약속 지도를 마지막으로 본 지역(사용자가 고른 지역)
//          또는 방금 검색한 결과 지역 ③ 둘 다 없으면 기본 지역(서울시청 일대).
// 카카오맵 level: 숫자가 작을수록 더 확대. 후보가 하나뿐이거나 아주 가까울 때 너무 확대되지 않게 MIN_LEVEL 아래로 내려가지 않는다.

export const DEFAULT_VIEW = { type: 'center', lat: 37.5665, lng: 126.978, level: 7 };
export const MIN_LEVEL = 4; // 이보다 더 확대하지 않음(골목 단위가 아니라 동네 단위)
export const SINGLE_LEVEL = 5;

// 위도·경도가 숫자이고 범위 안이며 (0,0) 이 아닌 것만
export function validPoint(p) {
  if (!p) return false;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (p.lat === null || p.lat === undefined || p.lng === null || p.lng === undefined) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

// points: 후보 [{lat,lng}] · saved: 저장된 마지막 시점 {lat,lng,level} · searched: 검색 결과 [{lat,lng}]
export function initialView(points, { saved = null, searched = [] } = {}) {
  const pts = (points || []).filter(validPoint);
  if (pts.length === 1) return { type: 'center', lat: Number(pts[0].lat), lng: Number(pts[0].lng), level: SINGLE_LEVEL, source: 'candidates' };
  if (pts.length > 1) return { type: 'bounds', points: pts.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })), minLevel: MIN_LEVEL, source: 'candidates' };
  if (saved && validPoint(saved)) return { type: 'center', lat: Number(saved.lat), lng: Number(saved.lng), level: clampLevel(saved.level), source: 'saved' };
  const found = (searched || []).filter(validPoint);
  if (found.length === 1) return { type: 'center', lat: Number(found[0].lat), lng: Number(found[0].lng), level: SINGLE_LEVEL, source: 'search' };
  if (found.length > 1) return { type: 'bounds', points: found.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })), minLevel: MIN_LEVEL, source: 'search' };
  return { ...DEFAULT_VIEW, source: 'default' };
}

export const clampLevel = (lv) => {
  const n = Number(lv);
  if (!Number.isFinite(n)) return DEFAULT_VIEW.level;
  return Math.min(12, Math.max(MIN_LEVEL, Math.round(n)));
};

// 이 기기에 약속별 마지막 지도 시점 저장(로그인 정보·위치 권한과 무관, 내가 움직인 지도 중심만)
const KEY = (id) => `moiddak:mapview:${id}`;
export function readSavedView(meetingId) {
  try { const v = JSON.parse(localStorage.getItem(KEY(meetingId)) || 'null'); return v && validPoint(v) ? v : null; } catch { return null; }
}
export function saveView(meetingId, v) {
  try { localStorage.setItem(KEY(meetingId), JSON.stringify({ lat: v.lat, lng: v.lng, level: v.level })); } catch { /* 저장 못 해도 지도는 동작 */ }
}
