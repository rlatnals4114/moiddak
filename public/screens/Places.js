// 장소 탭: 검색(카카오 실제 결과) → 후보 추가 → 지도 마커 ↔ 후보 카드 연동 → 선호 투표 → 방문 일정 → 최종 확정
// 006: 분류 6종(집결지·식당·카페·놀거리·관광지·기타), 장소부터 정하기(일정 확정 전 투표), 여러 방문지·순서·시간, 식당 필수 해제.
// 지도를 못 불러와도 후보 목록·외부 지도 링크·직접 입력은 계속 동작한다.
import { html, useState, useMemo, useRef } from '../lib/deps.js';
import { sb } from '../lib/sb.js';
import { KIND, KIND_KEYS, guessKind, names, safeUrl, copyText, toast, meetingLink } from '../lib/util.js';
import { fmtRange, fmtTime, dayKey, STEPS, minuteLabel, kstISO, midnight } from '../lib/time.js';
import { Msg, Progress, EmptyState } from '../ui/common.js';
import { PixelIcon, KindIcon } from '../ui/Pixel.js';
import { MapView, searchPlaces, toPlace } from '../ui/KakaoMap.js';
import { KAKAO_JS_KEY } from '../config.js';

function requestText(v) {
  const lines = v.kinds.filter((k) => k.cands.length && k.pending.length)
    .map((k) => `${KIND[k.kind].icon} ${KIND[k.kind].label}: ${names(k.pending)}`);
  return `[${v.meeting.title}] 장소 투표 아직 안 한 분 🙏\n${lines.join('\n')}\n아래 링크에서 장소 선호를 골라 주세요.\n${meetingLink(v.meeting.id)}`;
}

export function PlaceTab({ v, reload }) {
  const st = v.meeting.status;
  const [filter, setFilter] = useState('all');
  const [active, setActive] = useState(null);
  const [mapError, setMapError] = useState(KAKAO_JS_KEY ? '' : '지도 키가 아직 설정되지 않아 지도 없이 보여 드려요.');
  const [center, setCenter] = useState(null);
  const [searched, setSearched] = useState([]);
  const member = !!v.me || v.isOwner;
  const open = st !== 'finalized';
  const onlyMine = filter === 'mine';
  const withCands = v.kinds.filter((k) => k.cands.length);
  const kinds = withCands.filter((k) => filter === 'all' || onlyMine || k.kind === filter);
  const isMine = (k, c) => k.myVote === c.id || (v.me && c.created_by_participant_id === v.me.id);
  const points = useMemo(() => kinds.flatMap((k) => k.cands.filter((c) => c.latitude != null && c.longitude != null && (!onlyMine || isMine(k, c)))
    .map((c) => ({ id: c.id, lat: c.latitude, lng: c.longitude, kind: k.kind,
      label: `${KIND[k.kind].label} · ${c.name} · ${c.voters.length}명 선호` }))), [v, filter]);
  const select = (id) => {
    setActive(id);
    const el = document.getElementById(`cand-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const anyPending = v.kinds.some((k) => k.cands.length && k.pending.length);

  return html`
    <section class="card" aria-labelledby="place-h">
      <h2 id="place-h">장소</h2>
      <p class="muted small">필요한 장소만 정하면 돼요(집결지만, 식당만, 또는 장소 없이도 OK). 일정보다 먼저 정해도 돼요.</p>
      ${open && v.stops.length > 0 && html`<${StopsPreview} v=${v} />`}
      <div class="filter-chips" role="group" aria-label="장소 필터">
        <button type="button" class=${filter === 'all' ? 'chip-btn on' : 'chip-btn'} aria-pressed=${filter === 'all'} onClick=${() => setFilter('all')}>전체</button>
        ${withCands.map((k) => html`<button type="button" class=${filter === k.kind ? 'chip-btn on' : 'chip-btn'} aria-pressed=${filter === k.kind} onClick=${() => setFilter(k.kind)}>
          <${KindIcon} kind=${k.kind} size=${14} /> ${KIND[k.kind].label} ${k.cands.length}</button>`)}
        ${v.me && html`<button type="button" class=${onlyMine ? 'chip-btn on' : 'chip-btn'} aria-pressed=${onlyMine} onClick=${() => setFilter('mine')}><${PixelIcon} name="heart" size=${12} /> 내가 고른 곳</button>`}
      </div>
      ${open && member && !mapError && html`<${PlaceSearch} v=${v} center=${center} reload=${reload} onAdded=${select} onResults=${setSearched} />`}

      <div class="place-layout">
        <div class="place-map">
          ${mapError ? html`<div class="msg info">${mapError}</div>`
            : html`<${MapView} points=${points} activeId=${active} onSelect=${select} onCenter=${setCenter} onError=${setMapError}
              viewKey=${v.meeting.id} fitKey=${filter} searched=${searched} />`}
        </div>
        <div class="place-list">
          ${open && v.me && withCands.length > 0 && html`<p class="small muted">마음에 드는 곳에 하트 버튼을 눌러요. 분류마다 1곳, 다시 누르면 ‘선호 없음’이에요.</p>`}
          ${withCands.length === 0 && html`<${EmptyState} compact icon="pin" title="아직 장소 후보가 없어요" text="위에서 검색하거나 아래 ‘직접 올리기’로 올려 보세요. 장소 없이 진행해도 돼요." />`}
          ${kinds.map((k) => html`<${KindBlock} key=${k.kind} k=${k} v=${v} reload=${reload} active=${active} onSelect=${setActive} onlyMine=${onlyMine} />`)}
          ${onlyMine && !kinds.some((k) => k.cands.some((c) => isMine(k, c))) && html`<p class="muted">아직 내가 고르거나 올린 곳이 없어요.</p>`}
        </div>
      </div>

      ${open && v.isOwner && anyPending && html`
        <button class="btn ghost small" onClick=${() => copyText(requestText(v))}>장소 미응답자에게 보낼 문구 복사</button>`}
      ${open && member && html`<${ManualAdd} v=${v} reload=${reload} />`}
      ${open && v.isOwner && html`<${ItineraryEditor} key=${v.stops.map((s) => s.id).join()} v=${v} reload=${reload} />`}
      ${open && v.isOwner && html`<${FinalizeV2} v=${v} reload=${reload} />`}
      <p class="muted small">영업시간·휴무는 확인하지 않아요. 방문일 운영 여부는 ‘지도에서 보기’로 직접 확인해 주세요.</p>
    </section>`;
}

function StopsPreview({ v }) {
  return html`<div class="stops-preview">
    <p class="small"><strong>주최자가 정한 방문 일정</strong> (확정 전, 바뀔 수 있어요)</p>
    <ol class="timeline">${v.stops.map((s) => html`<li><span class="tl-time">${s.planned_time ? fmtTime(s.planned_time) : ''}</span>
      <span><${KindIcon} kind=${s.kind} size=${14} /> ${s.name}</span></li>`)}</ol>
  </div>`;
}

function PlaceSearch({ v, center, reload, onAdded, onResults }) {
  const [q, setQ] = useState('');
  const [want, setWant] = useState('auto'); // 올릴 분류(자동 = 카카오 분류로 추천)
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const locked = new Set(v.kinds.filter((k) => k.votingStarted).map((k) => k.kind));
  const existing = new Set(v.candidates.filter((c) => c.provider_place_id).map((c) => `${c.kind}:${c.provider_place_id}`));

  async function search(e) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const found = await searchPlaces(q.trim(), { category: want === 'auto' ? undefined : KIND[want].kakaoCode, center });
      setResults(found);
      if (onResults) onResults(found.map((r) => ({ lat: Number(r.y), lng: Number(r.x) })));
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
    setBusy(false);
  }
  async function add(r, kind) {
    setMsg(null);
    const { data, error } = await sb.rpc('add_place_candidate_v3', {
      p_meeting_id: v.meeting.id, p_kind: kind, p_name: r.place_name.slice(0, 40), p_map_url: null, p_place: toPlace(r),
    });
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    toast(`${KIND[kind].label} 후보로 올렸어요 ✓`);
    await reload();
    onAdded(data);
  }

  return html`
    <form class="search" onSubmit=${search} role="search">
      <select aria-label="올릴 장소 분류" value=${want} onChange=${(e) => setWant(e.target.value)}>
        <option value="auto">분류 자동</option>
        ${KIND_KEYS.map((k) => html`<option value=${k} disabled=${locked.has(k)}>${KIND[k].label}${locked.has(k) ? '(투표 중)' : ''}</option>`)}
      </select>
      <input type="search" aria-label="장소나 지역 검색" placeholder="장소·지역 (예: 제주시청)" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <button class="btn" type="submit" disabled=${busy}>${busy ? '…' : '검색'}</button>
    </form>
    <${Msg} m=${msg} />
    ${results && html`<div class="results">
      <div class="row-between"><span class="small muted">검색 결과 ${results.length}개 (카카오맵)</span>
        <button class="btn ghost small" onClick=${() => setResults(null)}>닫기</button></div>
      ${results.length === 0 && html`<p class="muted">결과가 없어요. 다른 이름이나 지역으로 찾아 주세요.</p>`}
      <ul class="result-list">${results.map((r) => {
        const kind = want === 'auto' ? guessKind(r) : want;
        return html`<li>
          <div><strong>${r.place_name}</strong>
            <span class="small muted">${r.road_address_name || r.address_name}</span>
            <span class="small muted">${(r.category_name || '').split(' > ').slice(-1)[0]}</span>
            ${safeUrl(r.place_url) && html`<a class="ext-link" href=${r.place_url} target="_blank" rel="noopener noreferrer">상세 보기 ↗</a>`}
          </div>
          <div class="btn-col">
            ${existing.has(`${kind}:${r.id}`) ? html`<span class="tag ok">${KIND[kind].label} 후보에 있음</span>`
              : locked.has(kind) ? html`<span class="tag">${KIND[kind].label} 투표 중</span>`
                : html`<button class="btn small" onClick=${() => add(r, kind)}>+ <${KindIcon} kind=${kind} size=${12} /> ${KIND[kind].label}</button>`}
          </div>
        </li>`;
      })}</ul>
      <p class="muted small">분류가 맞지 않으면 위의 ‘분류’에서 골라 다시 검색해 주세요.</p>
    </div>`}`;
}

function KindBlock({ k, v, reload, active, onSelect, onlyMine }) {
  const st = v.meeting.status;
  const info = KIND[k.kind];
  const [busy, setBusy] = useState(false);
  const voting = st !== 'finalized' && !!v.me;
  const tops = k.cands.filter((c) => k.max > 0 && c.voters.length === k.max).length;
  const canDelete = (c) => st !== 'finalized' && !k.votingStarted && (v.isOwner || (v.me && c.created_by_participant_id === v.me.id));
  const mine = (c) => k.myVote === c.id || (v.me && c.created_by_participant_id === v.me.id);
  const list = onlyMine ? k.cands.filter(mine) : k.cands;
  const inStops = new Set(v.stops.map((s) => s.candidate_id).filter(Boolean));

  async function remove(c) {
    if (!confirm(`‘${c.name}’ 후보를 지울까요?`)) return;
    const { error } = await sb.rpc('delete_place_candidate', { p_candidate_id: c.id });
    if (error) toast(error.message); else reload();
  }
  // 하트 = 이 분류에서 내 선호 1곳. 다른 곳을 누르면 옮겨 가고, 같은 곳을 다시 누르면 '선호 없음'.
  async function vote(candidateId) {
    if (busy) return;
    setBusy(true);
    const { error } = await sb.rpc('submit_place_v2', { p_meeting_id: v.meeting.id, p_kind: k.kind, p_candidate_id: candidateId });
    setBusy(false);
    if (error) { toast(error.message); return; }
    toast(candidateId ? `${info.label} 선호를 저장했어요 ♥` : `${info.label}는 ‘선호 없음’으로 응답했어요`);
    reload();
  }

  if (onlyMine && !list.length) return null;
  return html`
    <div class="kind-block">
      <div class="row-between"><h3><${KindIcon} kind=${k.kind} size=${16} /> ${info.label} 후보 <span class="muted small">(${info.note})</span></h3>
        ${voting && html`<span class="small my-vote">${k.mySubmitted ? (k.myVote ? '내 선호 저장됨' : '선호 없음으로 응답') : '아직 투표 안 함'}</span>`}</div>
      ${k.votingStarted && html`<${Progress} label=${`${info.label} 선호`} done=${k.done} pending=${k.pending} total=${v.N} />`}
      <ul class="place-cards">
        ${list.map((c) => {
          const isTop = k.max > 0 && c.voters.length === k.max;
          const url = safeUrl(c.detail_url) || safeUrl(c.map_url);
          const hasPos = c.latitude != null;
          const hearted = k.myVote === c.id;
          const cat = (c.category || '').split(' > ').slice(-1)[0];
          return html`<li id=${`cand-${c.id}`} class="${active === c.id ? 'active' : ''} ${inStops.has(c.id) ? 'picked' : ''}">
            <button type="button" class="pc-main" aria-pressed=${active === c.id} onClick=${() => hasPos && onSelect(c.id)}>
              <span class="pc-thumb ${k.kind}" aria-hidden="true"><${KindIcon} kind=${k.kind} size=${26} /></span>
              <span class="pc-text">
                <strong>${c.name}${inStops.has(c.id) ? ' · 방문 일정에 포함' : ''}</strong>
                <span class="small muted">${[cat || info.label, c.road_address || c.address].filter(Boolean).join(' · ') || (hasPos ? '' : '지도 위치 없음 · 링크로 보기')}</span>
                <span class="pc-tags">
                  <span class="vote-badge ${c.voters.length ? 'on' : ''}"><${PixelIcon} name="heart" size=${10} /> ${c.voters.length}명 선호</span>
                  ${isTop && html`<span class="tag">${tops > 1 ? '공동 1위' : '가장 많음'}</span>`}
                  ${hasPos && html`<span class="small link-like"><${PixelIcon} name="pin" size=${10} /> 지도에서 보기</span>`}
                </span>
              </span>
            </button>
            ${voting && html`<button type="button" class="heart ${hearted ? 'on' : ''}" aria-pressed=${hearted} disabled=${busy}
              aria-label=${hearted ? `${c.name} 선호 취소(선호 없음으로)` : `${c.name} 선호하기`} onClick=${() => vote(hearted ? null : c.id)}>
              <${PixelIcon} name="heart" size=${18} /></button>`}
            <div class="pc-actions">
              ${url && html`<a class="btn ghost small" href=${url} target="_blank" rel="noopener noreferrer">${hasPos ? '상세·영업시간 ↗' : '링크로 보기 ↗'}</a>`}
              ${canDelete(c) && html`<button class="btn danger small" onClick=${() => remove(c)}>지우기</button>`}
            </div>
            ${c.voters.length > 0 && html`<p class="small muted voters">${names(c.voters)}</p>`}
          </li>`;
        })}
      </ul>
      ${voting && html`<button type="button" class="btn ghost small ${k.mySubmitted && !k.myVote ? 'on' : ''}" disabled=${busy}
        aria-pressed=${k.mySubmitted && !k.myVote} onClick=${() => vote(null)}>어디든 좋아요 (${info.label} 선호 없음)</button>`}
      ${k.noPref.length > 0 && html`<p class="small muted">선호 없음: ${names(k.noPref)}</p>`}
      ${k.votingStarted && st !== 'finalized' && html`<p class="small muted">투표가 시작돼서 ${info.label} 후보는 더 추가하거나 지울 수 없어요.</p>`}
    </div>`;
}

// 이름·링크로 직접 올리기(집결지처럼 검색이 어려운 곳, 지도 키가 없을 때)
function ManualAdd({ v, reload }) {
  const open = KIND_KEYS.filter((k) => !v.kinds.find((x) => x.kind === k).votingStarted);
  const [show, setShow] = useState(false);
  const [kind, setKind] = useState(open[0]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // 연타·중복 요청 방지: 상태(busy)가 반영되기 전 두 번째 클릭도 막는다
  const addLock = useRef(false);
  async function add(e) {
    if (addLock.current) { if (e && e.preventDefault) e.preventDefault(); return; }
    addLock.current = true;
    try { await addInner(e); } finally { addLock.current = false; }
  }
  async function addInner(e) {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    const u = url.trim();
    if (!n) return setMsg({ type: 'error', text: '장소 이름을 적어 주세요.' });
    if (u && !safeUrl(u)) return setMsg({ type: 'error', text: '지도 링크는 https:// 로 시작하는 주소만 돼요.' });
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc('add_place_candidate_v3', { p_meeting_id: v.meeting.id, p_kind: kind, p_name: n, p_map_url: u || null, p_place: null });
    setBusy(false);
    if (error) return setMsg({ type: 'error', text: error.message });
    setName(''); setUrl('');
    toast('후보를 올렸어요 ✓');
    reload();
  }
  if (!open.length) return null;
  if (!show) return html`<button class="btn ghost small" onClick=${() => setShow(true)}>+ 이름·링크로 직접 올리기</button>`;
  return html`
    <form class="manual-add" onSubmit=${add} noValidate>
      <h3>이름·링크로 직접 올리기 <span class="muted small">(지도 위치 없이 목록에만 보여요)</span></h3>
      <label for="cand-kind">분류</label>
      <select id="cand-kind" value=${kind} onChange=${(e) => setKind(e.target.value)}>
        ${open.map((k) => html`<option value=${k}>${KIND[k].label}</option>`)}
      </select>
      <label for="cand-name">장소 이름</label>
      <input id="cand-name" type="text" maxLength="40" placeholder="예: 제주시청 앞 정류장" value=${name} onInput=${(e) => setName(e.target.value)} />
      <label for="cand-url">지도 링크 <span class="muted small">(선택)</span></label>
      <input id="cand-url" type="url" inputMode="url" maxLength="500" placeholder="https://naver.me/…" value=${url} onInput=${(e) => setUrl(e.target.value)} />
      <${Msg} m=${msg} />
      <div class="btn-row"><button class="btn ghost" type="button" onClick=${() => setShow(false)}>닫기</button>
        <button class="btn grow" type="submit" disabled=${busy}>${busy ? '올리는 중…' : '후보 올리기'}</button></div>
    </form>`;
}

// 방문 일정(주최자): 후보에서 고르거나 직접 입력(집결지), 순서·시간·메모. 일정이 확정되지 않았으면 시간은 비워 둔다.
const toMinute = (iso, day) => Math.round((Date.parse(iso) - midnight(day)) / 60000);
function ItineraryEditor({ v, reload }) {
  const day = v.selectedStart ? dayKey(v.selectedStart) : null;
  const [rows, setRows] = useState(() => v.stops.map((s) => ({
    candidate_id: s.candidate_id, kind: s.kind, name: s.name, address: s.address || '', map_url: s.map_url || '',
    minute: s.planned_time && day ? toMinute(s.planned_time, day) : '', note: s.note || '',
  })));
  const [skip, setSkip] = useState(v.placeSkipped);
  const [pick, setPick] = useState('');
  const [mp, setMp] = useState({ name: '', address: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const cands = v.kinds.flatMap((k) => k.cands.map((c) => ({ ...c, kindKey: k.kind, votes: c.voters.length })));
  const used = new Set(rows.map((r) => r.candidate_id).filter(Boolean));
  const move = (i, d) => setRows((a) => { const n = [...a]; const j = i + d; if (j < 0 || j >= n.length) return a; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const set = (i, k, val) => setRows((a) => a.map((r, j) => (j === i ? { ...r, [k]: val } : r)));

  function addCand() {
    const c = cands.find((x) => x.id === pick);
    if (!c || rows.length >= 10) return;
    setRows((a) => [...a, { candidate_id: c.id, kind: c.kindKey, name: c.name, address: c.road_address || c.address || '', map_url: c.detail_url || c.map_url || '', minute: '', note: '' }]);
    setPick(''); setSkip(false);
  }
  function addMeetingPoint() {
    if (!mp.name.trim() || rows.length >= 10) return;
    setRows((a) => [{ candidate_id: null, kind: 'meeting_point', name: mp.name.trim(), address: mp.address.trim(), map_url: '', minute: '', note: '' }, ...a]);
    setMp({ name: '', address: '' }); setSkip(false);
  }
  async function save() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const stops = skip ? [] : rows.map((r) => ({
      candidate_id: r.candidate_id, kind: r.kind, name: r.name, address: r.address || null, map_url: r.map_url || null, note: r.note || null,
      planned_time: day && r.minute !== '' ? kstISO(day, Number(r.minute)) : null,
    }));
    const { error } = await sb.rpc('set_itinerary', { p_meeting_id: v.meeting.id, p_stops: stops, p_skip: skip });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    toast(skip ? '‘장소 없이 진행’으로 저장했어요' : `방문 일정 ${stops.length}곳을 저장했어요 ✓`);
    reload();
  }

  return html`
    <div class="host-box itinerary">
      <h3><${PixelIcon} name="crown" size=${14} /> 방문 일정 정하기 (주최자)</h3>
      <p class="muted small">실제로 갈 곳만 순서대로 담아요. 집결지·식당·카페·놀거리… 몇 곳이든(최대 10곳), 0곳이어도 돼요.${day ? '' : ' 시간은 일정이 확정되면 넣을 수 있어요.'}</p>
      <label class="me-pick"><input type="checkbox" checked=${skip} onChange=${(e) => setSkip(e.target.checked)} /> 이번 약속은 장소 없이 진행(온라인·장소 미정)</label>
      ${!skip && html`
        <ol class="stop-edit">${rows.map((r, i) => html`<li>
          <div class="se-head">
            <span class="se-no">${i + 1}</span>
            <strong><${KindIcon} kind=${r.kind} size=${14} /> ${r.name}</strong>
            <span class="btn-row tight">
              <button type="button" class="icon-btn" aria-label="위로" disabled=${i === 0} onClick=${() => move(i, -1)}>↑</button>
              <button type="button" class="icon-btn" aria-label="아래로" disabled=${i === rows.length - 1} onClick=${() => move(i, 1)}>↓</button>
              <button type="button" class="icon-btn" aria-label="빼기" onClick=${() => setRows((a) => a.filter((_, j) => j !== i))}>×</button>
            </span>
          </div>
          <div class="se-fields">
            <select aria-label=${`${r.name} 예정 시간`} disabled=${!day} value=${r.minute} onChange=${(e) => set(i, 'minute', e.target.value)}>
              <option value="">시간 미정</option>
              ${STEPS.slice(0, -1).map((m) => html`<option value=${m}>${minuteLabel(m)}</option>`)}
            </select>
            <input type="text" maxLength="100" aria-label=${`${r.name} 메모`} placeholder="메모(선택) 예: 2번 출구" value=${r.note} onInput=${(e) => set(i, 'note', e.target.value)} />
          </div>
        </li>`)}</ol>
        ${rows.length === 0 && html`<p class="muted small">아직 담은 장소가 없어요.</p>`}
        <div class="se-add">
          <select aria-label="후보에서 추가" value=${pick} onChange=${(e) => setPick(e.target.value)}>
            <option value="">후보에서 고르기…</option>
            ${cands.filter((c) => !used.has(c.id)).map((c) => html`<option value=${c.id}>${KIND[c.kindKey].label} · ${c.name} (선호 ${c.votes}명)</option>`)}
          </select>
          <button type="button" class="btn small" disabled=${!pick || rows.length >= 10} onClick=${addCand}>담기</button>
        </div>
        <div class="se-add">
          <input type="text" maxLength="40" aria-label="집결지 이름" placeholder="집결지 직접 입력 (예: 제주시청 앞)" value=${mp.name} onInput=${(e) => setMp({ ...mp, name: e.target.value })} />
          <button type="button" class="btn ghost small" disabled=${!mp.name.trim() || rows.length >= 10} onClick=${addMeetingPoint}>맨 앞에 추가</button>
        </div>`}
      <${Msg} m=${msg} />
      <button class="btn block" disabled=${busy} onClick=${save}>${busy ? '저장 중…' : '방문 일정 저장'}</button>
    </div>`;
}

// 최종 확정 v2: 일정 확정만 필수(장소는 저장된 방문 일정 그대로, 0곳도 가능)
function FinalizeV2({ v, reload }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const ready = !!v.selectedStart;
  async function finalize() {
    if (busy || !ready) return;
    const places = v.stops.length ? v.stops.map((s) => `${s.planned_time ? `${fmtTime(s.planned_time)} ` : ''}${KIND[s.kind].icon} ${s.name}`).join('\n') : (v.placeSkipped ? '장소 없이 진행' : '방문 장소 없음');
    const pend = v.kinds.filter((k) => k.cands.length && k.votingStarted && k.pending.length).map((k) => `${KIND[k.kind].label}: ${names(k.pending)}`);
    const text = `이렇게 최종 확정할까요?\n\n🗓 ${fmtRange(v.selectedStart, v.selectedEnd)}\n${places}\n`
      + (pend.length ? `\n⚠️ 아직 장소 투표 안 함 — ${pend.join(' / ')}\n` : '') + '\n확정하면 모든 투표와 장소 변경이 잠겨요.';
    if (!confirm(text)) return;
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc('finalize_meeting_v2', { p_meeting_id: v.meeting.id, p_expected_version: v.meeting.version });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); reload(); return; }
    toast('약속이 완성됐어요!');
    location.hash = `#/m/${v.meeting.id}`;
    reload();
  }
  return html`
    <div class="host-box">
      <h3><${PixelIcon} name="crown" size=${14} /> 약속 최종 확정 (주최자)</h3>
      <p class="muted small">${ready ? '저장한 방문 일정으로 확정해요. 장소가 없어도 확정할 수 있어요.' : '일정을 먼저 확정해야 최종 확정할 수 있어요(장소는 지금 정해 둬도 돼요).'}</p>
      <${Msg} m=${msg} />
      <button class="btn block" disabled=${busy || !ready} onClick=${finalize}>${busy ? '확정 중…' : '이대로 최종 확정'}</button>
    </div>`;
}
