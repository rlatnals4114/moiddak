// 카카오맵 JavaScript SDK(+ services 장소 검색). 키가 없거나 불러오기에 실패하면 null 을 돌려주고,
// 화면은 지도 없이 후보 목록·외부 지도 링크로 계속 동작한다.
// JavaScript 키는 브라우저 공개용이며 카카오 개발자 콘솔에 등록한 도메인에서만 동작한다.
import { html, useEffect, useRef, useState } from '../lib/deps.js';
import { KAKAO_JS_KEY } from '../config.js';
import { initialView, validPoint, readSavedView, saveView, DEFAULT_VIEW } from '../lib/mapview.js';

let loading = null;
export function loadKakao() {
  if (!KAKAO_JS_KEY) return Promise.reject(new Error('지도 키가 아직 설정되지 않았어요.'));
  if (window.kakao && window.kakao.maps && window.kakao.maps.services) return Promise.resolve(window.kakao);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(KAKAO_JS_KEY)}&libraries=services&autoload=false`;
      s.onload = () => (window.kakao && window.kakao.maps ? window.kakao.maps.load(() => resolve(window.kakao)) : reject(new Error('지도를 불러오지 못했어요.')));
      s.onerror = () => reject(new Error('지도를 불러오지 못했어요. 등록된 도메인인지 확인해 주세요.'));
      setTimeout(() => reject(new Error('지도 불러오기가 너무 오래 걸려요.')), 12000);
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// 장소 키워드 검색(실제 카카오 검색 결과). category: 'FD6' 음식점 · 'CE7' 카페 · undefined 전체
export async function searchPlaces(query, { category, center } = {}) {
  const kakao = await loadKakao();
  const ps = new kakao.maps.services.Places();
  const opts = { size: 15 };
  if (category) opts.category_group_code = category;
  if (center) { opts.location = new kakao.maps.LatLng(center.lat, center.lng); opts.sort = kakao.maps.services.SortBy.ACCURACY; }
  return new Promise((resolve, reject) => {
    ps.keywordSearch(query, (data, status) => {
      if (status === kakao.maps.services.Status.OK) resolve(data);
      else if (status === kakao.maps.services.Status.ZERO_RESULT) resolve([]);
      else reject(new Error('장소 검색에 실패했어요. 잠시 후 다시 시도해 주세요.'));
    }, opts);
  });
}

// 검색 결과 → DB 저장용 필드
export const toPlace = (r) => ({
  provider: 'kakao',
  provider_place_id: String(r.id),
  address: r.address_name || null,
  road_address: r.road_address_name || null,
  category: r.category_name || null,
  latitude: Number(r.y),
  longitude: Number(r.x),
  detail_url: r.place_url || null,
});

// 지도: points = [{id, lat, lng, label, kind}] · activeId 강조 · onSelect(id) 마커 선택
// 처음 범위는 lib/mapview.js 규칙(후보 → 마지막으로 본 지역/검색 지역 → 기본 지역)으로 한 번만 맞춘다.
// 사용자가 지도를 끌거나 확대·축소한 뒤에는 다시 불러오기·늦은 응답 때문에 범위를 되돌리지 않는다.
// fitKey(필터 등 사용자가 직접 바꾼 값)가 바뀔 때만 다시 맞춘다. 위치 권한은 요청하지 않는다.
export function MapView({ points, activeId, onSelect, onCenter, onError, viewKey = null, fitKey = '', searched = [] }) {
  const box = useRef(null);
  const st = useRef({ userMoved: false, prog: false, fittedFrom: null });
  const latest = useRef(points);
  latest.current = points;
  const latestSearched = useRef(searched);
  latestSearched.current = searched;
  const [ready, setReady] = useState(false);

  // 프로그램이 움직이는 동안 표시(사용자 조작과 구분)
  const apply = (view) => {
    const { kakao, map } = st.current;
    if (!map) return;
    st.current.prog = true;
    if (view.type === 'bounds') {
      const b = new kakao.maps.LatLngBounds();
      view.points.forEach((p) => b.extend(new kakao.maps.LatLng(p.lat, p.lng)));
      map.setBounds(b, 40, 40, 40, 40);
      if (map.getLevel() < view.minLevel) map.setLevel(view.minLevel);
    } else {
      map.setLevel(view.level);
      map.setCenter(new kakao.maps.LatLng(view.lat, view.lng));
    }
    st.current.fittedFrom = view.source;
    // 범위가 그대로라 idle 이 안 오는 경우를 대비해 잠시 뒤 표시를 푼다
    clearTimeout(st.current.progTimer);
    st.current.progTimer = setTimeout(() => { st.current.prog = false; }, 800);
  };
  const fit = () => apply(initialView(latest.current, { saved: viewKey ? readSavedView(viewKey) : null, searched: latestSearched.current }));

  useEffect(() => {
    let alive = true;
    let ro = null;
    loadKakao().then((kakao) => {
      if (!alive || !box.current) return;
      const map = new kakao.maps.Map(box.current, { center: new kakao.maps.LatLng(DEFAULT_VIEW.lat, DEFAULT_VIEW.lng), level: DEFAULT_VIEW.level });
      map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
      const userMove = () => { if (!st.current.prog) st.current.userMoved = true; };
      kakao.maps.event.addListener(map, 'dragstart', () => { st.current.userMoved = true; });
      kakao.maps.event.addListener(map, 'zoom_changed', userMove);
      kakao.maps.event.addListener(map, 'idle', () => {
        const c = map.getCenter();
        const wasProg = st.current.prog;
        st.current.prog = false;
        onCenter && onCenter({ lat: c.getLat(), lng: c.getLng() });
        if (!wasProg && st.current.userMoved && viewKey) saveView(viewKey, { lat: c.getLat(), lng: c.getLng(), level: map.getLevel() });
      });
      st.current = { ...st.current, kakao, map, markers: new Map(), overlay: null };
      // 컨테이너 크기가 바뀌면(처음 0px·회전 등) 다시 그리고, 사용자가 아직 안 움직였으면 범위도 다시 맞춘다
      if ('ResizeObserver' in window) {
        let last = box.current.clientWidth;
        ro = new ResizeObserver(() => {
          const w = box.current ? box.current.clientWidth : 0;
          if (!w || w === last) return;
          last = w;
          map.relayout();
          if (!st.current.userMoved) fit();
        });
        ro.observe(box.current);
      }
      setReady(true);
    }).catch((e) => onError && onError(e.message));
    return () => { alive = false; if (ro) ro.disconnect(); };
  }, []);

  // 마커 다시 그리기(범위는 건드리지 않음)
  const ids = points.map((p) => p.id).join();
  useEffect(() => {
    if (!ready) return;
    const { kakao, map, markers } = st.current;
    markers.forEach((m) => m.setMap(null));
    markers.clear();
    points.filter(validPoint).forEach((p) => {
      const marker = new kakao.maps.Marker({ position: new kakao.maps.LatLng(p.lat, p.lng), title: p.label, clickable: true });
      marker.setMap(map);
      kakao.maps.event.addListener(marker, 'click', () => onSelect && onSelect(p.id));
      markers.set(p.id, marker);
    });
    // 처음 한 번 맞추기. 후보 좌표가 늦게 생겼는데(기본·저장 지역으로 맞춘 상태) 사용자가 아직 안 움직였으면 후보 기준으로 한 번 더.
    const hasPts = points.some(validPoint);
    if (st.current.fittedFrom === null || (!st.current.userMoved && hasPts && st.current.fittedFrom !== 'candidates')) fit();
  }, [ready, ids]);

  // 사용자가 필터를 바꾸면 그 후보들에 맞춘다(명시적 조작)
  const firstFit = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (firstFit.current) { firstFit.current = false; return; }
    st.current.userMoved = false;
    fit();
  }, [fitKey]);

  // 검색 결과: 후보가 없을 때만 검색한 지역을 보여 준다
  const searchedKey = searched.map((p) => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    if (!ready || !searched.length || latest.current.some(validPoint)) return;
    apply(initialView([], { searched }));
  }, [searchedKey]);

  // 선택한 장소 강조(이름표) + 이동. 이름은 textContent 로 넣어 HTML 로 실행되지 않게 한다. (선택이 바뀔 때만)
  useEffect(() => {
    if (!ready) return;
    const { kakao, map, overlay } = st.current;
    if (overlay) overlay.setMap(null);
    const p = latest.current.find((x) => x.id === activeId);
    if (!p || !validPoint(p)) return;
    const el = document.createElement('div');
    el.className = 'map-label';
    el.textContent = p.label;
    const pos = new kakao.maps.LatLng(p.lat, p.lng);
    st.current.overlay = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 2.4, zIndex: 3 });
    st.current.overlay.setMap(map);
    map.panTo(pos);
  }, [ready, activeId]);

  return html`<div class="map" ref=${box} role="application" aria-label="장소 후보 지도">${!ready && html`<p class="muted center map-loading">지도 불러오는 중…</p>`}</div>`;
}
