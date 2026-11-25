// 모임방: 상단 탭(홈 · 일정 · 장소 · 관리). 초대 링크로 들어오면 바로 일정 탭으로 간다.
import { html, useState, useEffect, useCallback } from '../lib/deps.js';
import { sb, fetchMeeting, friendly } from '../lib/sb.js';
import { cleanUrl, go, writeHost, copyText, KIND, MODE_LABEL, STATUS_LABEL } from '../lib/util.js';
import { derive, schedState, progressSteps, participantStatus, placeState, rsvpSummary, RSVP_TEXT, RESPONSE_TEXT, PICK_TEXT } from '../lib/schedule.js';
import { Stepper } from '../ui/Stepper.js';
import { ThemeScene } from '../ui/ThemeScene.js';
import { fmtRange, fmtRangeLong, fmtTime, dDay } from '../lib/time.js';
import { Msg } from '../ui/common.js';
import { Avatar } from '../ui/Avatar.js';
import { PixelIcon, KindIcon } from '../ui/Pixel.js';
import { ScheduleTab } from './Schedule.js';
import { PlaceTab } from './Places.js';
import { HostTab } from './Host.js';
import { FinalCard, finalText } from './Final.js';
import { AddToCalendar } from '../ui/AddToCalendar.js';

export function MeetingPage({ id, tab, params, uid }) {
  const [state, setState] = useState({ phase: 'loading' });
  const [notice, setNotice] = useState(null);
  const [created] = useState(params.get('created') === '1');

  const load = useCallback(async () => {
    try {
      const d = await fetchMeeting(id);
      if (!d) {
        const { data } = await sb.rpc('meeting_public_info', { p_meeting_id: id });
        setState({ phase: 'outsider', info: data });
      } else {
        setState({ phase: 'ready', d, loadedAt: new Date() });
      }
    } catch (e) {
      const message = friendly(e && e.message);
      setState((s) => (s.phase === 'ready' ? { ...s, loadError: message } : { phase: 'error', error: message }));
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      const invite = params.get('invite');
      const admin = params.get('admin');
      const path = `/m/${id}${tab === 'home' ? '' : `/${tab}`}`;
      if (invite || admin || params.has('created')) cleanUrl(path);
      if (invite) {
        const { error } = await sb.rpc('accept_invite', { p_token: invite });
        if (error) setNotice({ type: 'error', text: error.message });
        else { setNotice({ type: 'ok', text: '초대를 확인했어요. 이제 이 기기에서 내 응답을 할 수 있어요.' }); go(`/m/${id}/schedule`); }
      }
      if (admin) {
        const { error } = await sb.rpc('claim_admin', { p_token: admin });
        if (error) setNotice({ type: 'error', text: error.message });
        else { writeHost(id, { admin }); setNotice({ type: 'ok', text: '이 기기를 주최자로 연결했어요.' }); }
      }
      await load();
    })();
  }, [id]);

  // 탭을 옮길 때마다 최신 응답을 다시 불러온다(실시간 구독 없음). 첫 진입은 위에서 이미 불러온다.
  const [seenTab, setSeenTab] = useState(tab);
  useEffect(() => {
    if (tab !== seenTab) { setSeenTab(tab); if (state.phase === 'ready') load(); }
  }, [tab]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (state.phase === 'loading') return html`<${Top} /><p class="muted center">약속을 불러오는 중…</p>`;
  if (state.phase === 'error') {
    return html`<${Top} /><div class="card"><h2>불러오지 못했어요</h2><p>${state.error}</p><button class="btn" onClick=${load}>다시 시도</button></div>`;
  }
  if (state.phase === 'outsider') {
    return html`<${Top} /><${Msg} m=${notice} />
      <div class="card">
        <h2>${state.info && state.info.title ? state.info.title : '이 약속을 볼 수 없어요'}</h2>
        <p>${state.info && state.info.title ? '이 약속은 초대받은 사람만 볼 수 있어요.' : '약속이 없거나, 초대받은 사람만 볼 수 있는 약속이에요.'}</p>
        <p><strong>주최자에게 받은 초대 링크(‘참여 링크’ 또는 내 이름이 적힌 개인 초대 링크)를 열어 주세요.</strong></p>
        <ul class="howto small">
          <li>모임방 약속이라면 주최자가 이번 약속의 참여 대상에 넣어야 보여요.</li>
          <li>전에 들어온 적이 있다면 다른 브라우저(예: 카카오톡 안 브라우저)이거나 방문 기록이 지워진 경우예요. 처음 열었던 브라우저로 열거나 주최자에게 새 링크를 부탁해 주세요.</li>
          <li>받은 주소를 복사할 때 일부가 잘리지 않았는지도 확인해 주세요.</li>
        </ul>
      </div>`;
  }

  const v = derive(state.d, uid);
  const tabs = [
    { key: 'home', label: '요약' },
    { key: 'schedule', label: '일정' },
    { key: 'place', label: '장소' },
    ...(v.isOwner ? [{ key: 'host', label: '관리' }] : []),
  ];
  const current = tabs.some((t) => t.key === tab) ? tab : 'home';
  return html`
    <${Top} onReload=${load} title=${state.d.group ? `${state.d.group.name} 모임방` : '일회성 약속'}
      back=${state.d.group ? `#/g/${state.d.group.id}` : '#/'} backLabel=${state.d.group ? `${state.d.group.name} 모임방으로` : '홈으로'} />
    ${current === 'home' && html`<${RoomBanner} v=${v} theme=${state.d.group?.theme} />`}
    <header class="room-head">
      <h1>${v.meeting.title}</h1>
      ${v.selectedStart
        ? html`<div class="when-fixed"><span class="wf-label">확정 일시</span>
            <strong>${fmtRangeLong(v.selectedStart, v.selectedEnd)}</strong>
            <span class="muted small">한국 시간 · ${dDay(v.selectedStart)}</span>
            ${current === 'home' && html`<${AddToCalendar} v=${v} />`}</div>`
        : html`<p class="room-sum">일정 조율 중 · 일정 응답 ${v.schedDone.length}/${v.N}명</p>`}
      <p class="room-meta">
        <span class="pill st-${v.meeting.status}">${STATUS_LABEL[v.meeting.status]}</span>
        <span class="pill mode">${MODE_LABEL[v.mode]}</span>
        ${v.me && html`<span class="muted small">나: ${v.me.display_name}</span>`}
        ${v.isOwner && html`<span class="pill host">${v.me ? '주최자' : '주최자(참석 안 함)'}</span>`}
      </p>
    </header>
    <${Stepper} steps=${progressSteps(v)} />
    <nav class="tabs" aria-label="약속 메뉴">
      ${tabs.map((t) => html`<a href=${`#/m/${id}${t.key === 'home' ? '' : `/${t.key}`}`} class=${current === t.key ? 'on' : ''} aria-current=${current === t.key ? 'page' : null}>${t.label}</a>`)}
    </nav>
    <${Msg} m=${notice} />
    ${state.loadError && html`<${Msg} m=${{ type: 'warn', text: `최신 정보를 못 가져왔어요(${state.loadError}). 화면은 ${fmtTime(state.loadedAt.toISOString())} 기준이에요.` }} />`}
    ${current === 'home' && html`<${RoomHome} v=${v} reload=${load} />`}
    ${current === 'schedule' && html`<${ScheduleTab} v=${v} reload=${load} />`}
    ${current === 'place' && html`<${PlaceTab} v=${v} reload=${load} />`}
    ${current === 'host' && html`<${HostTab} v=${v} reload=${load} created=${created} />`}
  `;
}

function Top({ onReload, title, back = '#/', backLabel = '뒤로' }) {
  return html`<div class="topbar">
    <a class="back" href=${back} aria-label=${backLabel}><${PixelIcon} name="back" size=${14} /></a>
    <span class="top-title">${title || ''}</span>
    ${onReload ? html`<button class="icon-btn" aria-label="새로고침" title="새로고침" onClick=${onReload}><${PixelIcon} name="refresh" size=${16} /></button>` : html`<span class="top-gap"></span>`}
  </div>`;
}

// 약속 배너: 모임방 테마 배경 위에 참가자 캐릭터(미응답은 회색). 확정된 약속은 처음 볼 때 함께 축하한다.
// 캐릭터는 장식일 뿐 — 응답·참석 여부는 아래 '참가자 현황'의 글자로 안내한다.
function RoomBanner({ v, theme }) {
  return html`<${ThemeScene} theme=${theme || 'picnic'} people=${v.participants} height=${140}
    dim=${(p) => !v.selectedStart && schedState(v, p) === 'pending'} celebrate=${v.meeting.status === 'finalized' ? v.meeting.id : false} />`;
}

// 지금 할 일: 역할·응답 여부에 따라 하나만 제안한다.
function nextAction(v) {
  const id = v.meeting.id;
  const st = v.meeting.status;
  const pend = `${v.schedPending.length}명이 아직 응답하지 않았어요`;
  const rs = rsvpSummary(v);
  if (v.selectedStart && rs && v.me && rs.mine === 'none') return { icon: 'people', title: '참석 여부 알려주기', sub: '참석·불참·미정 중에서 골라 주세요(일정 투표와 따로예요)', run: () => { const el = document.getElementById('rsvp'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const b = el.querySelector('button'); if (b) b.focus({ preventScroll: true }); } } };
  if (st === 'finalized') return { icon: 'heart', title: '약속 완성! 안내 문구 공유하기', sub: '날짜·장소·지도 링크를 단체방에 붙여 넣어요', run: () => copyText(finalText(v)) };
  if (st === 'schedule_open') {
    if (v.me && !v.mySchedSubmitted) return { icon: 'cal', title: '내 일정 응답하기', sub: v.schedPending.length > 1 ? `나 포함 ${pend}` : '가능한 시간을 골라 주세요', href: `#/m/${id}/schedule` };
    if (v.isOwner && v.schedPending.length) return { icon: 'cal', title: '미응답자에게 다시 물어보기', sub: `${pend} · 요청 문구 복사`, href: `#/m/${id}/schedule` };
    if (v.isOwner) return { icon: 'crown', title: '일정 확정하기', sub: '모두 응답했어요. 시간을 골라 확정해 주세요', href: `#/m/${id}/schedule` };
    return { icon: 'cal', title: '응답 완료! 결과 보기', sub: '주최자가 확정할 때까지 기다려요 (아직 약속 확정 아님)', href: `#/m/${id}/schedule` };
  }
  const withCands = v.kinds.filter((k) => k.cands.length);
  if (v.me && withCands.some((k) => !k.mySubmitted)) return { icon: 'heart', title: '장소 선호 투표하기', sub: '마음에 드는 곳에 하트를 눌러요', href: `#/m/${id}/place` };
  if (v.isOwner) return { icon: 'crown', title: '방문 일정 정하고 최종 확정하기', sub: '필요한 장소만 담아요(장소 없이도 확정할 수 있어요)', href: `#/m/${id}/place` };
  if (!withCands.length) return { icon: 'pin', title: '장소 후보 올리기(선택)', sub: '가고 싶은 곳이 있으면 올려 주세요', href: `#/m/${id}/place` };
  return { icon: 'pin', title: '투표 완료! 장소 보기', sub: '주최자가 최종 확정할 때까지 기다려요', href: `#/m/${id}/place` };
}

function RoomHome({ v, reload }) {
  const act = nextAction(v);
  const st = v.meeting.status;

  const body = html`
    <span class="todo-icon" aria-hidden="true"><${PixelIcon} name=${act.icon} size=${20} /></span>
    <span class="todo-text"><strong>${act.title}</strong><span>${act.sub}</span></span>
    <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span>`;
  return html`
    ${st === 'finalized' && html`<${FinalCard} v=${v} />`}
    <h2 class="section-title">지금 할 일</h2>
    ${act.href ? html`<a class="todo-card" href=${act.href}>${body}</a>` : html`<button type="button" class="todo-card" onClick=${act.run}>${body}</button>`}

    ${v.selectedStart ? html`<${ConfirmedPeople} v=${v} reload=${reload} />` : html`
    <h2 class="section-title">일정 응답 현황 <span class="muted small">${v.meeting.join_mode === 'link' ? `링크로 참여한 사람 ${v.N}명 · 일정 응답 ${v.schedDone.length}/${v.N}명` : `초대 대상 ${v.N}명 · 링크 연결 ${v.participants.filter((p) => p.user_id).length}명 · 일정 응답 ${v.schedDone.length}/${v.N}명`}</span></h2>
    ${v.meeting.join_mode === 'link' && html`<p class="muted small">참여 링크로 들어온 사람만 보여요. 링크를 받고 아직 들어오지 않은 사람은 알 수 없어요.</p>`}
    <section class="card">
      <${ResponseAvatars} v=${v} />
      <p class="muted small">캐릭터 아래 글자는 ‘일정 투표 응답’이에요. 미응답은 불참이 아니에요.</p>
    </section>`}
    <section class="card summary">
      <a href=${`#/m/${v.meeting.id}/schedule`} class="sum-row">
        <span class="row-label"><${PixelIcon} name="cal" size=${14} /> 일정</span>
        <span>${v.selectedStart ? html`<strong>${fmtRange(v.selectedStart, v.selectedEnd)}</strong>` : `조사 중 · ${v.schedDone.length}/${v.N}명 응답`}</span>
      </a>
      <a href=${`#/m/${v.meeting.id}/place`} class="sum-row">
        <span class="row-label"><${PixelIcon} name="pin" size=${14} /> 장소</span>
        <span>${v.stops.length ? html`<strong class="stop-line">${v.stops.map((s, i) => html`${i ? ' → ' : ''}<${KindIcon} kind=${s.kind} size=${12} /> ${s.name}`)}</strong>`
          : v.legacyFinals.length ? html`<strong class="stop-line">${v.legacyFinals.map((p, i) => html`${i ? ' · ' : ''}<${KindIcon} kind=${p.kind} size=${12} /> ${p.name}`)}</strong>`
            : placeState(v) === 'skipped' ? '장소 생략'
              : placeState(v) === 'voting' ? `후보 ${v.kinds.reduce((n, k) => n + k.cands.length, 0)}곳 · 조율 중`
                : st === 'finalized' ? '장소 미정(정하지 않고 확정)' : '아직 없음(선택)'}</span>
      </a>
    </section>`;
}

// 일정 응답 상태 캐릭터 목록(조율 중 화면 · 확정 후 「조율 결과」 공용)
function ResponseAvatars({ v }) {
  return html`<div class="avatars">
      ${v.participants.map((p) => {
        const ps = participantStatus(v, p);
        return html`<${Avatar} person=${p} state=${ps.response} you=${v.me && v.me.id === p.id} host=${ps.role === 'host'}
          extra=${[ps.pick && PICK_TEXT[ps.pick], !ps.joined && '링크 연결 전']} />`;
      })}
    </div>
    <p class="legend-row small">
      <span class="st-done"><i class="dot"></i>${RESPONSE_TEXT.done}</span><span class="st-pending"><i class="dot"></i>${RESPONSE_TEXT.pending}</span><span class="st-none"><i class="dot"></i>${RESPONSE_TEXT.none}</span>
    </p>`;
}

// 일정 확정 후: 참여자 목록(역할·초대 상태만) + 접힌 「조율 결과」(지난 일정 투표 응답)
// 참석 여부는 저장하는 기능이 없어서 표시하지 않는다. 미응답을 불참으로 바꾸지 않는다.
function ConfirmedPeople({ v, reload }) {
  const picks = v.participants.map((p) => participantStatus(v, p));
  const rs = rsvpSummary(v);
  const yes = picks.filter((x) => x.pick === 'yes').length;
  return html`
    <h2 class="section-title">${v.meeting.join_mode === 'link' ? '참여한 사람' : '초대 대상'} <span class="muted small">${v.N}명${v.meeting.join_mode === 'link' ? '' : ` · 링크 연결 ${picks.filter((x) => x.joined).length}명`}</span></h2>
    <section class="card">
      <div class="avatars">
        ${v.participants.map((p, i) => html`<${Avatar} person=${p} state="neutral" you=${v.me && v.me.id === p.id} host=${picks[i].role === 'host'}
          extra=${[rs && (rs.of(p) === 'none' ? '참석 미응답' : RSVP_TEXT[rs.of(p)]), v.meeting.join_mode !== 'link' && !picks[i].joined && '링크 연결 전']} />`)}
      </div>
      ${rs ? html`<p class="muted small">참석 여부는 확정된 일정(${fmtRange(v.selectedStart, v.selectedEnd)})에 대한 응답이에요. 일정 투표와 따로예요.</p>`
        : html`<p class="muted small">이 약속에 초대된 사람이에요. <strong>참석 여부는 미확인</strong> — 모이딱은 참석 확인을 따로 받지 않아요.</p>`}
    </section>
    ${rs && html`<${RsvpCard} v=${v} rs=${rs} reload=${reload} />`}
    <details class="fold">
      <summary><span class="fold-title">조율 결과</span>
        <span class="fold-sub">지난 일정 투표 · 응답 ${v.schedDone.length}/${v.N}명 · 확정 시간 가능 ${yes}명</span></summary>
      <div class="fold-body">
        <p class="small muted">확정 당시 일정 조율 기록이며 참석 여부와 달라요. 확정 뒤에는 일정 응답을 바꿀 수 없어서 지금 보이는 값이 확정 당시 그대로예요. 미응답은 불참이 아니에요.</p>
        <${ResponseAvatars} v=${v} />
      </div>
    </details>`;
}

// 참석 확인(011): 확정된 일정에 대한 참석·불참·미정. 고르지 않으면 '미응답'(미정과 다름). 본인 것만 저장(서버 검사).
function RsvpCard({ v, rs, reload }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  async function set(status) {
    if (busy) return;
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc('set_my_rsvp', { p_meeting_id: v.meeting.id, p_status: status });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    setMsg({ type: 'ok', text: status ? `‘${RSVP_TEXT[status]}’(으)로 알렸어요.` : '선택을 지웠어요(미응답).' });
    reload();
  }
  const c = rs.count;
  return html`<section class="card rsvp-card" id="rsvp" aria-labelledby="rsvp-h">
    <h3 id="rsvp-h">참석 여부</h3>
    <p class="rsvp-count" role="status">참석 ${c.yes} · 불참 ${c.no} · 미정 ${c.maybe} · 미응답 ${c.none} <span class="muted small">(${v.N}명 중)</span></p>
    ${v.me ? html`
      <p class="small">내 참석 여부: <strong>${RSVP_TEXT[rs.mine]}</strong></p>
      <div class="btn-row rsvp-btns" role="group" aria-label="내 참석 여부 고르기">
        ${['yes', 'no', 'maybe'].map((s) => html`<button type="button" class=${`chip-btn ${rs.mine === s ? 'on' : ''}`} aria-pressed=${rs.mine === s} disabled=${busy} onClick=${() => set(s)}>${RSVP_TEXT[s]}</button>`)}
        ${rs.mine !== 'none' && html`<button type="button" class="btn ghost small" disabled=${busy} onClick=${() => set(null)}>선택 지우기</button>`}
      </div>` : html`<p class="muted small">이 약속에 참여자로 들어 있지 않아서 참석 여부를 고를 수 없어요(주최만 해요).</p>`}
    <${Msg} m=${msg} />
  </section>`;
}
