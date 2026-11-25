// 모이딱 — 모바일 웹. 빌드 없이 ES 모듈로 동작한다.
// lib/  데이터·규칙(Supabase, 시간, 집계)   ui/  부품(달력·시간표·지도·캐릭터)   screens/  화면
// 읽기는 표 조회(RLS 로 같은 모임 사람만), 쓰기는 전부 Supabase RPC 함수로 한다.
import { html, render, useState, useEffect, useRef } from './lib/deps.js';
import { sb } from './lib/sb.js';
import { useRoute } from './lib/util.js';
import { ensureCharacter } from './lib/me.js';
import { Overlays } from './ui/common.js';
import { TabBar, tabOf } from './ui/TabBar.js';
import { HomePage } from './screens/Home.js';
import { CreatePage } from './screens/Create.js';
import { MeetingPage } from './screens/Meeting.js';
import { ProfilePage } from './screens/Profile.js';
import { GroupJoinPage, MeetingJoinPage } from './screens/GroupJoin.js';
import { CalendarPage } from './screens/CalendarPage.js';
import { GroupListPage, GroupCreatePage, GroupPage, GroupSettingsPage, GroupNewMeetingPage } from './screens/Groups.js';

function App() {
  const route = useRoute();
  const [session, setSession] = useState(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      let s = data.session;
      if (!s) {
        const { data: d2, error } = await sb.auth.signInAnonymously();
        if (error) { setAuthError(error.message); return; }
        s = d2.session;
      }
      // 캐릭터를 아직 안 고른 사람은 무작위 캐릭터를 먼저 정한다(약속 참여 전에 프로필에 있어야 참가자 캐릭터로 복사됨).
      try { await ensureCharacter(); } catch { /* 실패해도 화면은 연다 */ }
      setSession(s);
    })();
  }, []);
  // 화면이 바뀌면: 맨 위로, 탭 제목을 화면 제목으로, (첫 화면이 아니면) 화면 읽기 프로그램이 새 화면부터 읽도록 본문에 포커스.
  const first = useRef(true);
  useEffect(() => {
    window.scrollTo(0, 0);
    const setTitle = () => {
      const h = document.querySelector('main h1, main .top-title:not(:empty), main h2');
      document.title = h && h.textContent.trim() ? `${h.textContent.trim().slice(0, 40)} · 모이딱` : '모이딱 — 모임을 한 번에 딱!';
    };
    const t = setTimeout(() => {
      setTitle();
      if (!first.current) { const m = document.querySelector('main'); if (m) m.focus({ preventScroll: true }); }
      first.current = false;
    }, 700);
    const t2 = setTimeout(setTitle, 2500); // 데이터를 늦게 불러오는 화면(약속·모임방)
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [route.name, route.id, route.tab, route.sub]);

  let body;
  if (authError) {
    body = html`<div class="card"><h2>접속 준비를 못 했어요</h2>
      <p>잠시 후 새로고침해 주세요. 계속 안 되면 주최자에게 알려 주세요.</p><p class="muted small">${authError}</p></div>`;
  } else if (!session) {
    body = html`<p class="muted center">접속 준비 중…</p>`;
  } else if (route.name === 'meeting') {
    body = html`<${MeetingPage} key=${route.id} id=${route.id} tab=${route.tab} params=${route.params} uid=${session.user.id} />`;
  } else if (route.name === 'join-meeting') {
    body = html`<${MeetingJoinPage} params=${route.params} />`;
  } else if (route.name === 'join') {
    body = html`<${GroupJoinPage} params=${route.params} />`;
  } else if (route.name === 'calendar') {
    body = html`<${CalendarPage} />`;
  } else if (route.name === 'groups') {
    body = html`<${GroupListPage} />`;
  } else if (route.name === 'group-new') {
    body = html`<${GroupCreatePage} />`;
  } else if (route.name === 'group') {
    const G = route.sub === 'settings' ? GroupSettingsPage : route.sub === 'new' ? GroupNewMeetingPage : GroupPage;
    body = html`<${G} key=${`${route.id}-${route.sub}`} id=${route.id} params=${route.params} />`;
  } else if (route.name === 'me') {
    body = html`<${ProfilePage} uid=${session.user.id} sub=${route.sub} />`;
  } else if (route.name === 'new') {
    body = html`<${CreatePage} />`;
  } else {
    body = html`<${HomePage} uid=${session.user.id} />`;
  }
  const tab = session && !authError ? tabOf(route) : null;
  return html`<main tabindex="-1" class=${tab ? 'wrap has-tabbar' : 'wrap'}>${body}</main>${tab && html`<${TabBar} active=${tab} />`}<${Overlays} />`;
}

render(html`<${App} />`, document.getElementById('app'));
