import { html, useState, useEffect } from '../lib/deps.js';
import { sb, selectParticipants } from '../lib/sb.js';
import { useMe, myBase } from '../lib/me.js';
import { STATUS_LABEL, MODE_LABEL } from '../lib/util.js';
import { fmtRange, dDay } from '../lib/time.js';
import { Sprite, AvatarRow } from '../ui/Avatar.js';
import { Logo, PixelIcon, SkyDecor } from '../ui/Pixel.js';
import { EmptyState } from '../ui/common.js';
import { loadMyGroups } from '../lib/groups.js';
import { GroupCard } from './Groups.js';
import { loadCalendar } from '../lib/calendar.js';
import { upcomingAndNeed } from './CalendarPage.js';

// 내 모임 목록 + 모임별 응답 현황(읽기 조회만, RLS 로 내가 속한 모임만 보인다)
export async function loadMine() {
  const { data: meetings, error } = await sb.from('meetings')
    .select('*')
    .order('created_at', { ascending: false });
  if (error || !meetings || !meetings.length) return meetings || [];
  const ids = meetings.map((m) => m.id);
  const [ps, subs] = await Promise.all([
    selectParticipants((cols) => sb.from('participants').select(cols).in('meeting_id', ids).order('sort_order')),
    sb.from('schedule_submissions').select('meeting_id,participant_id').in('meeting_id', ids),
  ]);
  return meetings.map((m) => {
    const people = (ps.data || []).filter((p) => p.meeting_id === m.id);
    const done = new Set((subs.data || []).filter((s) => s.meeting_id === m.id).map((s) => s.participant_id));
    return { ...m, people, doneCount: people.filter((p) => done.has(p.id)).length, pendingIds: new Set(people.filter((p) => !done.has(p.id)).map((p) => p.id)) };
  });
}

export function HomePage({ uid }) {
  const [mine, setMine] = useState(null);
  // 방금 만든 모임방 알림(한 번만). 닫거나 다른 곳으로 가면 사라진다.
  const [created, setCreated] = useState(() => {
    try { const v = JSON.parse(sessionStorage.getItem('moiddak:justCreatedGroup') || 'null'); sessionStorage.removeItem('moiddak:justCreatedGroup'); return v; } catch { return null; }
  });
  const me = useMe();
  const [groups, setGroups] = useState(null);
  const [cal, setCal] = useState(null);
  useEffect(() => {
    loadMine().then(setMine).catch(() => setMine([]));
    loadMyGroups().then(setGroups);
    loadCalendar(new Date(Date.now() - 86400000), new Date(Date.now() + 270 * 86400000)).then(setCal);
  }, []);
  const { upcoming, need } = upcomingAndNeed((cal && cal.items) || []);
  const gname = Object.fromEntries(((groups && groups.list) || []).map((g) => [g.id, g.name]));
  return html`
    <header class="home-head">
      <${Logo} />
      <span class="head-actions">
      <a class="profile-btn" href="#/me" aria-label="내 정보·설정">
        <span class="pb-char"><${Sprite} type=${myBase(me)} size=${28} /></span>
        <span class="pb-name">${(me && me.nickname) || '내 정보'}</span>
      </a>
      </span>
    </header>
    <section class="hero-card">
      <${SkyDecor} />
      <div class="hero-char"><${Sprite} type=${myBase(me)} size=${64} /></div>
      <div class="bubble">친구들과 약속,<br /><strong>이번엔 한 번에 딱!</strong></div>
    </section>

    ${created && html`<section class="card created-note" role="status">
      <span class="hi-icon" aria-hidden="true"><${PixelIcon} name="house" size=${18} /></span>
      <span class="cn-body"><strong>‘${created.name}’ 모임방을 만들었어요</strong><span class="small muted">친구를 초대하면 같이 약속을 정할 수 있어요.</span></span>
      <span class="cn-actions"><a class="btn small" href=${`#/g/${created.id}?invite_open=1`}>친구 초대하기</a>
        <button type="button" class="icon-btn" aria-label="알림 닫기" onClick=${() => setCreated(null)}>×</button></span>
    </section>`}

    ${cal && cal.ready && need.length > 0 && html`
      <h2 class="sr-only">내 응답이 필요한 약속 ${need.length}개</h2><div class="home-gap" aria-hidden="true"></div>
      <ul class="cal-list">${need.map((it) => html`<li><a class="home-item need" href=${`#/m/${it.id}/schedule`}>
        <span class="hi-icon" aria-hidden="true"><${PixelIcon} name="question" size=${15} /></span>
        <span class="ci-body"><span class="hi-label">응답 필요</span><strong>${it.title}</strong><span class="small muted">${it.group ? it.group.name : '일회성 약속'}</span></span>
        <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span></a></li>`)}</ul>`}

    ${cal && cal.ready && html`
      <h2 class="sr-only">다가오는 약속</h2><div class="home-gap" aria-hidden="true"></div>
      ${upcoming.length === 0 ? html`<${EmptyState} compact icon="cal" title="다가오는 약속이 없어요" text="일정이 확정되면 여기에 날짜와 D-day가 보여요." />`
        : html`<ul class="cal-list">${upcoming.slice(0, 3).map((it) => html`<li><a class="home-item upcoming" href=${`#/m/${it.id}`}>
          <span class="hi-left"><span class="hi-icon" aria-hidden="true"><${PixelIcon} name="cal" size=${16} /></span><span class="hi-dday">${dDay(it.selected_start)}</span></span>
          <span class="ci-body"><strong>${it.title}</strong><span class="small muted">${fmtRange(it.selected_start, it.selected_end)} · ${it.group ? it.group.name : '일회성 약속'}</span></span>
          <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span></a></li>`)}</ul>`}`}

    ${groups && groups.ready && html`
      <div class="section-head"><h2>내 모임방</h2><a class="text-action" href="#/groups">전체 보기<${PixelIcon} name="chev" size=${6} /></a></div>
      ${groups.list.length === 0 ? html`<${EmptyState} icon="house" title="아직 모임방이 없어요" text="같은 멤버와 여러 번의 약속을 계속 이어서 정해요." action=${{ href: '#/groups/new', label: '+ 모임방 만들기' }} />`
        : html`<ul class="group-list">${groups.list.filter((g) => !g.archived_at).slice(0, 3).map((g) => html`<${GroupCard} g=${g} />`)}</ul>`}`}

    <div class="section-head"><h2>전체 약속</h2>${mine && mine.length > 0 && html`<span class="muted small">${mine.length}개</span>`}</div>
    ${mine === null && html`<p class="muted">불러오는 중…</p>`}
    ${mine && mine.length === 0 && html`<${EmptyState} icon="sparkle" title="아직 약속이 없어요"
      text="새 약속이나 모임방을 만들거나, 친구에게 받은 초대 링크를 열면 여기에 나타나요." />`}
    ${mine && mine.length > 0 && html`<ul class="meet-list">
      ${mine.map((m) => {
        const lead = m.people.find((p) => p.id === m.host_participant_id) || m.people[0];
        return html`<li><a class="meet-card" href=${`#/m/${m.id}`}>
          <span class="mc-char">${lead && html`<${Sprite} person=${lead} size=${40} />`}</span>
          <span class="mc-body">
            <span class="mc-title">${m.title}</span>
            <span class="mc-when">${m.selected_start
              ? html`${fmtRange(m.selected_start, m.selected_end)} · <b>${dDay(m.selected_start)}</b>`
              : `일정 조사 중 · ${MODE_LABEL[m.schedule_mode] || ''}`}</span>
            <span class="mc-foot">
              <span class="mc-count">일정 응답 ${m.doneCount}/${m.people.length}명</span>
              <${AvatarRow} people=${m.people} pendingIds=${m.pendingIds} />
            </span>
            <span class="mc-tags"><span class="pill st-${m.status}">${STATUS_LABEL[m.status]}</span>${m.owner_user_id === uid && html`<span class="pill host">주최</span>`}
              <span class="pill mode">${m.group_id ? (gname[m.group_id] || '모임방') : '일회성'}</span></span>
          </span>
          <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span>
        </a></li>`;
      })}
    </ul>`}
    <div class="fixed-cta two">
      ${groups && groups.ready && html`<a class="btn ghost" href="#/groups/new">+ 모임방</a>`}
      <a class="btn cta grow" href="#/new"><${PixelIcon} name="sparkle" size=${12} /> 일회성 약속 만들기</a>
    </div>`;
}
