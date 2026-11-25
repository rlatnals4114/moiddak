// 지속형 모임방: 목록 · 만들기 · 메인 · 설정 · 모임방에서 새 약속
// 모임방 멤버(group_members)와 약속 참여자(participants)는 다르다. 배너 캐릭터 = 멤버, 응답 상태는 약속 화면에서만.
import { html, useState, useEffect, useCallback, useRef } from '../lib/deps.js';
import { sb } from '../lib/sb.js';
import { go, cleanUrl, copyText, toast, writeHost, shareOrCopy, STATUS_LABEL } from '../lib/util.js';
import { fmtRange, dDay } from '../lib/time.js';
import { THEMES, THEME_KEYS, loadMyGroups, loadGroup, readGroupHost, writeGroupInvites, groupLink, groupInviteLink, joinLink, readJoinToken, writeJoinToken, joinNotReady } from '../lib/groups.js';
import { ThemeScene } from '../ui/ThemeScene.js';
import { Sprite } from '../ui/Avatar.js';
import { PixelIcon } from '../ui/Pixel.js';
import { Msg, EmptyState, askConfirm } from '../ui/common.js';
import { InviteShare } from '../ui/InviteShare.js';
import { useMe } from '../lib/me.js';
import { ModePicker, PollSetup, GridSetup, scheduleInput } from './Create.js';

const NOT_READY = html`<div class="msg warn">모임방 기능을 쓰려면 DB 추가 설정(004 SQL)이 필요해요.</div>`;

function Top({ title, back = '#/' }) {
  return html`<div class="topbar">${back ? html`<a class="back" href=${back} aria-label="뒤로"><${PixelIcon} name="back" size=${14} /></a>` : html`<span class="top-gap"></span>`}<span class="top-title">${title}</span><span class="top-gap"></span></div>`;
}

// ───────── 목록 (#/groups) ─────────
export function GroupListPage() {
  const [st, setSt] = useState(null);
  useEffect(() => { loadMyGroups().then(setSt); }, []);
  return html`
    <${Top} title="내 모임방" back=${null} />
    ${st && !st.ready && NOT_READY}
    ${st && st.error && html`<${Msg} m=${{ type: 'error', text: st.error }} />`}
    ${st === null && html`<p class="muted">불러오는 중…</p>`}
    ${st && st.ready && st.list.length === 0 && html`<${EmptyState} icon="house" title="아직 모임방이 없어요"
      text="모임방을 만들면 같은 멤버와 여러 번의 약속을 계속 이어서 정할 수 있어요." />`}
    <ul class="group-list">${st && st.list.map((g) => html`<${GroupCard} g=${g} />`)}</ul>
    <div class="fixed-cta"><a class="btn cta block" href="#/groups/new">+ 새 모임방 만들기</a></div>`;
}

export function GroupCard({ g }) {
  return html`<li><a class="group-card" href=${`#/g/${g.id}`}>
    <${ThemeScene} theme=${g.theme} people=${g.members || []} height=${76} small=${true} />
    <span class="gc-body">
      <strong>${g.name}</strong>
      <span class="small muted">멤버 ${(g.members || []).length}명 · 진행 중 약속 ${g.open_count || 0}개${g.my_role === 'admin' ? ' · 관리자' : ''}</span>
      ${g.next ? html`<span class="small gc-next">다음 약속: ${g.next.title} · ${fmtRange(g.next.selected_start)} <b>${dDay(g.next.selected_start)}</b></span>`
        : html`<span class="small muted">확정된 다음 약속 없음</span>`}
      ${g.archived_at && html`<span class="pill mode">종료됨</span>`}
    </span>
    <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span>
  </a></li>`;
}

// ───────── 만들기 (#/groups/new) ─────────
export function ThemePicker({ value, onChange }) {
  return html`<div class="theme-grid" role="radiogroup" aria-label="배경 테마">
    ${THEME_KEYS.map((k) => html`<button type="button" role="radio" aria-checked=${value === k} class=${value === k ? 'theme-opt on' : 'theme-opt'} onClick=${() => onChange(k)}>
      <${ThemeScene} theme=${k} height=${56} small=${true} />
      <strong>${THEMES[k].label}</strong><span class="small muted">${THEMES[k].note}</span>
    </button>`)}
  </div>`;
}

export function GroupCreatePage() {
  const me = useMe();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [theme, setTheme] = useState('picnic');
  const [myName, setMyName] = useState('');
  const [others, setOthers] = useState([]); // 미리 넣을 멤버(선택)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (me && me.nickname && !myName) setMyName(me.nickname); }, [me && me.nickname]);
  const setOther = (i, v) => setOthers((a) => a.map((x, j) => (j === i ? v : x)));

  // 연타·중복 요청 방지: 상태(busy)가 반영되기 전 두 번째 클릭도 막는다
  const createLock = useRef(false);
  async function create() {
    if (createLock.current) { return; }
    createLock.current = true;
    try { await createInner(); } finally { createLock.current = false; }
  }
  async function createInner() {
    if (busy) return;
    const fail = (text) => setMsg({ type: 'error', text });
    if (!name.trim()) return fail('모임방 이름을 적어 주세요.');
    if (!myName.trim()) return fail('모임방에서 쓸 내 이름을 적어 주세요.');
    const kept = [myName.trim(), ...others.map((n) => n.trim()).filter(Boolean)];
    if (new Set(kept.map((n) => n.toLowerCase())).size !== kept.length) return fail('같은 이름이 있어요.');
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('create_group', { p_name: name.trim(), p_description: desc.trim() || null, p_theme: theme, p_names: kept, p_my_index: 1 });
    if (error) { setBusy(false); return fail(`만들지 못했어요: ${error.message}`); }
    writeGroupInvites(data.group_id, data.invites);
    // 만든 뒤 홈으로: 홈 ‘내 모임방’에 바로 보이고, 위쪽 알림에서 원하면 ‘친구 초대하기’로 이어 간다(강제 아님)
    try { sessionStorage.setItem('moiddak:justCreatedGroup', JSON.stringify({ id: data.group_id, name: name.trim() })); } catch { /* 없어도 동작 */ }
    go('/');
  }

  return html`
    <${Top} title="새 모임방" back="#/groups" />
    <section class="card">
      <label for="g-name">모임방 이름</label>
      <input id="g-name" type="text" maxLength="40" placeholder="예: 우리 독서모임" value=${name} onInput=${(e) => setName(e.target.value)} />
      <label for="g-desc">설명 <span class="muted small">(선택)</span></label>
      <input id="g-desc" type="text" maxLength="200" placeholder="예: 매달 한 권, 둘째 주 토요일" value=${desc} onInput=${(e) => setDesc(e.target.value)} />
      <label for="g-me">모임방에서 쓸 내 이름</label>
      <input id="g-me" type="text" maxLength="20" placeholder="예: 구름빵" value=${myName} onInput=${(e) => setMyName(e.target.value)} />
      <p class="muted small">만든 나는 관리자가 돼요.</p>
    </section>
    <h2 class="section-title">배경 테마</h2>
    <${ThemePicker} value=${theme} onChange=${setTheme} />
    <details class="fold">
      <summary><span class="fold-title">멤버 이름 미리 넣기 (선택)</span><span class="fold-sub">안 넣어도 돼요. 만든 뒤 설정에서 언제든 추가할 수 있어요.</span></summary>
      <div class="fold-body">
        ${others.map((n, i) => html`<div class="name-row">
          <input type="text" maxLength="20" aria-label=${`멤버 ${i + 1} 이름`} placeholder=${`멤버 ${i + 1}`} value=${n} onInput=${(e) => setOther(i, e.target.value)} />
          <button type="button" class="icon-btn" aria-label=${`멤버 ${i + 1} 지우기`} onClick=${() => setOthers((a) => a.filter((_, j) => j !== i))}>×</button>
        </div>`)}
        ${others.length < 29 && html`<button type="button" class="btn ghost small" onClick=${() => setOthers((a) => [...a, ''])}>+ 멤버 이름 추가</button>`}
        <p class="muted small">미리 넣은 멤버에게는 이름별 개인 초대 링크를 1:1로 보내요(한 번 들어오면 다음 약속부터는 링크 없이 바로 보여요).</p>
      </div>
    </details>
    <${Msg} m=${msg} />
    <div class="fixed-cta"><button class="btn cta block" disabled=${busy} onClick=${create}>${busy ? '만드는 중…' : '모임방 만들기'}</button></div>`;
}

// ───────── 모임방 메인 (#/g/<id>) ─────────
function useGroup(id, params) {
  const [st, setSt] = useState({ phase: 'loading' });
  const [notice, setNotice] = useState(null);
  const load = useCallback(async () => setSt(await loadGroup(id)), [id]);
  useEffect(() => {
    (async () => {
      const invite = params && params.get('invite');
      if (invite) {
        cleanUrl(`/g/${id}`);
        const { error } = await sb.rpc('accept_group_invite', { p_token: invite });
        setNotice(error ? { type: 'error', text: error.message } : { type: 'ok', text: '모임방에 들어왔어요! 이 모임방의 약속에 내 응답을 할 수 있어요.' });
      }
      await load();
    })();
  }, [id]);
  return [st, load, notice];
}

// 설정·새 약속 화면: 준비 전 상태(불러오는 중·DB 준비 전·멤버 아님/없는 방·오류)를 각각 보여 준다(멤버가 아니면 '불러오는 중'에 멈추지 않게).
function notReadyBody(st) {
  if (st.phase === 'loading') return html`<p class="muted">불러오는 중…</p>`;
  if (st.phase === 'notready') return NOT_READY;
  if (st.phase === 'outsider') return html`<div class="card"><h2>${st.info ? st.info.name : '모임방을 찾을 수 없어요'}</h2>
    <p>${st.info ? '이 모임방의 멤버만 볼 수 있어요.' : '주소가 잘못됐거나 종료된 모임방일 수 있어요.'}</p><a class="btn ghost block" href="#/groups">내 모임방 목록으로</a></div>`;
  return html`<${Msg} m=${{ type: 'error', text: st.error || '모임방을 불러오지 못했어요.' }} />`;
}

const isPast = (m) => m.selected_start && Date.parse(m.selected_start) < Date.now() - 3 * 3600000;

export function GroupPage({ id, params }) {
  const [st, , notice] = useGroup(id, params);
  if (st.phase === 'loading') return html`<${Top} title="모임방" back="#/groups" /><p class="muted center">불러오는 중…</p>`;
  if (st.phase === 'notready') return html`<${Top} title="모임방" back="#/groups" />${NOT_READY}`;
  if (st.phase === 'error') return html`<${Top} title="모임방" back="#/groups" /><${Msg} m=${{ type: 'error', text: st.error }} />`;
  if (st.phase === 'outsider') {
    return html`<${Top} title="모임방" back="#/" /><${Msg} m=${notice} />
      <div class="card">${st.info ? html`<h2>${st.info.name}</h2><p>이 모임방은 멤버만 볼 수 있어요.</p>
        <p><strong>관리자가 보내 준 ‘내 이름이 적힌 모임방 초대 링크’를 열어 주세요.</strong></p>
        <p class="muted small">전에 들어온 적이 있다면 다른 브라우저(예: 카카오톡 안 브라우저)일 수 있어요.</p>`
        : html`<h2>모임방을 찾을 수 없어요</h2><p>주소가 잘못됐거나 종료된 모임방일 수 있어요.</p><a class="btn ghost block" href="#/groups">내 모임방 목록으로</a>`}</div>`;
  }
  const g = st.group;
  const meetings = st.meetings || [];
  const open = meetings.filter((m) => m.status !== 'finalized');
  const upcoming = meetings.filter((m) => m.status === 'finalized' && !isPast(m)).sort((a, b) => Date.parse(a.selected_start) - Date.parse(b.selected_start));
  const past = meetings.filter((m) => m.status === 'finalized' && isPast(m));
  return html`
    <${Top} title="모임방" back="#/groups" />
    <${ThemeScene} theme=${g.theme} people=${st.members} height=${150} />
    <header class="room-head">
      <h1>${g.name}</h1>
      ${g.description && html`<p class="muted">${g.description}</p>`}
      <p class="room-meta">
        <span class="pill mode">${THEMES[g.theme].label} 테마</span>
        <span class="pill">${st.members.length}명</span>
        ${st.me && st.me.role === 'admin' && html`<span class="pill host">관리자</span>`}
        ${st.me && html`<span class="muted small">나: ${st.me.display_name}</span>`}
        ${g.archived_at && html`<span class="pill mode">종료된 모임방</span>`}
      </p>
      <p class="muted small">배너의 캐릭터는 ‘모임방 멤버’예요. 각 약속의 응답 여부와는 달라요.</p>
    </header>
    <${Msg} m=${notice} />
    <div class="btn-row">
      ${!g.archived_at && html`<a class="btn cta grow" href=${`#/g/${id}/new`}>+ 새 약속 만들기</a>`}
      <a class="btn ghost" href=${`#/g/${id}/settings`}>${st.me && st.me.role === 'admin' ? '설정·멤버 관리' : '멤버 보기'}</a>
    </div>
    ${!g.archived_at && html`<${InvitePanel} id=${id} group=${g} admin=${!!(st.me && st.me.role === 'admin')} startOpen=${!!(params && params.get('invite_open'))} />`}
    <${MeetingSection} title="진행 중인 약속" list=${open} icon="clock" empty=${st.me && st.me.role === 'admin' ? '진행 중인 약속이 없어요. ‘+ 새 약속 만들기’로 시작해요.' : '나에게 보이는 진행 중인 약속이 없어요. 약속은 참여 대상에게만 보여요(가입 전에 만든 약속 포함). ‘+ 새 약속 만들기’로 시작할 수도 있어요.'} />
    <${MeetingSection} title="다가오는 약속" list=${upcoming} empty="확정된 다가오는 약속이 없어요." />
    <details class="past"><summary>지난 약속 ${past.length}개</summary><${MeetingSection} list=${past} icon="flag" empty="지난 약속이 없어요." /></details>`;
}

function MeetingSection({ title, list, empty, icon = 'cal' }) {
  return html`${title && html`<h2 class="section-title">${title} <span class="muted small">${list.length}</span></h2>`}
    ${list.length === 0 ? html`<${EmptyState} compact icon=${icon} text=${empty} />` : html`<ul class="meet-list">${list.map((m) => {
      const canOpen = m.i_participate || m.i_host;
      // 내 일정 응답 상태: 미응답이라도 조율이 끝났으면 '응답 필요'가 아니다(그리고 불참도 아니다)
      const state = m.admin_view ? '관리자에게만 보여요 · 참여 안 함' : !m.i_participate ? '참여하지 않는 약속'
        : m.my_state === 'pending' ? (m.status === 'schedule_open' ? '내 응답 필요' : '일정 투표 미응답')
          : m.my_state === 'none' ? '내 응답 · 가능 시간 없음' : '내 응답 완료';
      const body = html`<span class="mc-body">
        <span class="mc-title">${m.title}</span>
        <span class="mc-when">${m.selected_start ? html`${fmtRange(m.selected_start, m.selected_end)} · <b>${dDay(m.selected_start)}</b>` : '일정 조사 중'}</span>
        <span class="mc-tags"><span class="pill st-${m.status}">${STATUS_LABEL[m.status]}</span>
          <span class=${state === '내 응답 필요' ? 'pill need' : 'pill mode'}>${state}</span>
          ${m.counts && html`<span class="small muted">일정 응답 ${m.counts.done}/${m.counts.total}명</span>`}</span>
      </span>`;
      return html`<li>${canOpen ? html`<a class="meet-card slim" href=${`#/m/${m.id}`}>${body}<span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span></a>`
        : html`<div class="meet-card slim muted-card">${body}</div>`}</li>`;
    })}</ul>`}`;
}

// ───────── 설정·멤버 관리 (#/g/<id>/settings) ─────────
export function GroupSettingsPage({ id, params }) {
  const [st, load] = useGroup(id, null);
  const [created] = useState(params && params.get('created') === '1');
  const [cache, setCache] = useState(() => readGroupHost(id));
  const [form, setForm] = useState(null);
  const [adds, setAdds] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (created) cleanUrl(`/g/${id}/settings`); }, []);
  useEffect(() => { if (st.phase === 'ready') setForm({ name: st.group.name, desc: st.group.description || '', theme: st.group.theme }); }, [st.phase === 'ready' && st.group.version]);

  if (st.phase !== 'ready') return html`<${Top} title="모임방 설정" back=${`#/g/${id}`} />${notReadyBody(st)}`;
  const g = st.group;
  const admin = st.me && st.me.role === 'admin';
  const inviteMsg = (m, token) => `${m.display_name}님, [${g.name}] 모이딱 모임방 초대 링크예요.\n본인만 쓰는 링크라 다른 사람에게 보내지 말아 주세요 🙏\n${groupInviteLink(id, token)}`;
  async function run(fn, args, ok, confirmText) {
    if (busy || (confirmText && !confirm(confirmText))) return null;
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc(fn, args);
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); await load(); return null; }
    if (ok) toast(ok);
    await load();
    return data;
  }
  async function reissue(m) {
    const data = await run('reissue_group_invite', { p_member_id: m.id }, null,
      m.joined ? `${m.display_name}님은 이미 연결돼 있어요.\n새 링크를 만들면 지금 연결된 기기는 이 모임방과 그 약속들에서 응답할 수 없게 돼요(이미 낸 응답은 남아요). 계속할까요?` : null);
    if (data) { writeGroupInvites(id, [data]); setCache(readGroupHost(id)); await copyText(inviteMsg(m, data.token), '새 초대 링크를 복사했어요. 이전 링크는 이제 안 돼요.'); }
  }
  async function addMembers() {
    const names = adds.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    const data = await run('add_group_members', { p_group_id: id, p_names: names }, `${names.length}명을 추가했어요. 초대 링크를 보내 주세요.`);
    if (data) { writeGroupInvites(id, data.invites); setCache(readGroupHost(id)); setAdds(''); }
  }

  return html`
    <${Top} title="모임방 설정" back=${`#/g/${id}`} />
    ${created && html`<div class="msg ok" role="status">${st.members.length > 1 ? '모임방을 만들었어요! 아래에서 멤버마다 모임방 초대 링크를 1:1로 보내 주세요.' : '모임방을 만들었어요! 아래 ‘멤버 추가’에 이름을 넣으면 그 사람의 개인 초대 링크가 생겨요.'}</div>`}
    <${Msg} m=${msg} />

    ${admin && form && html`<h2 class="section-title">모임방 정보</h2>
    <section class="card">
      <label for="gs-name">이름</label>
      <input id="gs-name" type="text" maxLength="40" value=${form.name} onInput=${(e) => setForm({ ...form, name: e.target.value })} />
      <label for="gs-desc">설명</label>
      <input id="gs-desc" type="text" maxLength="200" value=${form.desc} onInput=${(e) => setForm({ ...form, desc: e.target.value })} />
      <label>배경 테마</label>
      <${ThemePicker} value=${form.theme} onChange=${(t) => setForm({ ...form, theme: t })} />
      <button class="btn block" disabled=${busy} onClick=${() => run('update_group', { p_group_id: id, p_name: form.name, p_description: form.desc || null, p_theme: form.theme, p_expected_version: g.version }, '모임방 정보를 저장했어요 ✓')}>저장</button>
    </section>`}

    <${JoinLinkCard} id=${id} groupName=${g.name} archived=${!!g.archived_at} />

    <h2 class="section-title">멤버 <span class="muted small">${st.members.length}명</span></h2>
    <section class="card">
      <ul class="people">${st.members.map((m) => html`<li>
          <span class="member-line"><${Sprite} person=${m} size=${24} /><strong>${m.display_name}${m.is_me ? ' (나)' : ''}</strong>
            ${m.role === 'admin' && html`<span class="pill host">관리자</span>`}
            <span class=${m.joined ? 'tag ok' : 'tag'}>${m.joined ? '✓ 연결됨' : '아직 안 들어옴'}</span></span>
          ${admin && !m.is_me && html`<span class="btn-row tight">
            ${m.joined && html`<button class="btn ghost small" disabled=${busy} onClick=${() => run('set_group_member_role', { p_member_id: m.id, p_role: m.role === 'admin' ? 'member' : 'admin' },
              '역할을 바꿨어요.', m.role === 'admin' ? `${m.display_name}님의 관리자 권한을 해제할까요?` : `${m.display_name}님을 관리자로 지정할까요?\n관리자는 멤버 관리·모임방 설정·종료를 할 수 있어요.`)}>${m.role === 'admin' ? '관리자 해제' : '관리자로 지정'}</button>`}
            <button class="btn danger small" disabled=${busy} onClick=${() => run('remove_group_member', { p_member_id: m.id }, `${m.display_name}님을 모임방에서 뺐어요.`,
              `${m.display_name}님을 모임방에서 뺄까요?\n지난 약속 기록과 이미 참여 중인 약속은 그대로 남고, 앞으로 만드는 약속에서는 빠져요.\n뺀 사람은 초대 링크로 스스로 다시 들어올 수 없어요(같은 기기 기준).`)}>빼기</button>
          </span>`}
        </li>`)}</ul>
      <p class="muted small">새 친구는 위 ‘모임방 초대 링크’로 불러요. 한 번 들어오면 이 모임방의 약속에 링크 없이 참여할 수 있어요.</p>
    </section>

    <details class="fold">
      <summary><span class="fold-title">고급 링크·복구</span><span class="fold-sub">${admin ? '이름별 개인 링크, 모든 초대 링크 관리·정원, 모임방 주소' : '모임방 주소'}</span></summary>
      <div class="fold-body small">
        ${admin && html`<h3>이름별 개인 초대 링크</h3>
          <p class="muted small">특정한 사람 전용 링크예요. 이름을 미리 넣어 두고 그 사람에게만 1:1로 보내요. 새 링크를 만들면 그 사람의 이전 링크·이전 기기 연결은 끊겨요.</p>
          <ul class="people">${st.members.filter((m) => !m.is_me).map((m) => {
            const token = cache.invites[m.id];
            return html`<li><span><strong>${m.display_name}</strong> <span class=${m.joined ? 'tag ok' : 'tag'}>${m.joined ? '✓ 연결됨' : '아직 안 들어옴'}</span></span>
              <span class="btn-row tight">
                ${!m.joined && token && html`<button class="btn small" onClick=${() => copyText(inviteMsg(m, token), `${m.display_name}님 초대 문구를 복사했어요.`)}>개인 링크 복사</button>`}
                <button class="btn ghost small" disabled=${busy} onClick=${() => reissue(m)}>${token || m.joined ? '새 링크 발급' : '링크 만들기'}</button>
              </span></li>`;
          })}</ul>
          <label for="gs-add">이름 미리 넣기 <span class="muted small">(쉼표나 줄바꿈으로 여러 명)</span></label>
          <textarea id="gs-add" rows="2" placeholder="예: 구름빵, 별사탕" value=${adds} onInput=${(e) => setAdds(e.target.value)}></textarea>
          <button class="btn ghost block" disabled=${busy || !adds.trim()} onClick=${addMembers}>이름 추가하고 개인 링크 만들기</button>
          <${AdminLinksCard} id=${id} group=${g} memberCount=${st.members.length} onChanged=${load} />`}
        <h3>모임방 주소 <span class="muted small">(초대 링크 아님)</span></h3>
        <p class="muted small">이미 멤버인 사람이 모임방을 바로 여는 주소예요. 새 친구는 이 주소로 들어올 수 없어요.</p>
        <button class="btn ghost small" onClick=${() => copyText(groupLink(id), '모임방 주소를 복사했어요.')}>모임방 주소 복사</button>
      </div>
    </details>

    <h2 class="section-title">그 밖의 작업</h2>
    <section class="card danger-zone">
      ${st.me && html`<button class="btn danger block" disabled=${busy} onClick=${async () => { const r = await run('leave_group', { p_group_id: id }, '모임방에서 나왔어요.', '이 모임방에서 나갈까요?\n지난 약속 기록은 남아요. 나중에 초대 링크로 다시 들어올 수 있어요.'); if (r) go('/groups'); }}>모임방 나가기</button>`}
      ${admin && html`<button class="btn ghost block" disabled=${busy} onClick=${() => run('archive_group', { p_group_id: id, p_archived: !g.archived_at },
        g.archived_at ? '모임방을 다시 열었어요.' : '모임방을 종료했어요.', g.archived_at ? null : '모임방을 종료할까요?\n데이터는 지워지지 않고, 새 약속을 만들 수 없게 돼요. 나중에 다시 열 수 있어요.')}>${g.archived_at ? '모임방 다시 열기' : '모임방 종료하기'}</button>`}
    </section>`;
}

// ───────── 모임방에서 새 약속 (#/g/<id>/new) ─────────
export function GroupNewMeetingPage({ id }) {
  const [st] = useGroup(id, null);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState(null);
  const [mode, setMode] = useState('poll');
  const [polls, setPolls] = useState([]);
  const [days, setDays] = useState({});
  const [common, setCommon] = useState({ start: 10 * 60, end: 22 * 60 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  if (st.phase !== 'ready') return html`<${Top} title="새 약속" back=${`#/g/${id}`} />${notReadyBody(st)}`;
  const sel = picked || new Set(st.members.map((m) => m.id));
  const toggle = (mid) => { const n = new Set(sel); if (n.has(mid)) n.delete(mid); else n.add(mid); setPicked(n); };

  const createLock = useRef(false);
  async function create() {
    if (createLock.current) return;
    createLock.current = true;
    try { await createInner(); } finally { createLock.current = false; }
  }
  async function createInner() {
    if (busy) return;
    const fail = (text) => setMsg({ type: 'error', text });
    if (!title.trim()) return fail('약속 이름을 적어 주세요.');
    if (sel.size < 2) return fail('참여할 멤버를 2명 이상 골라 주세요.');
    const sched = scheduleInput(mode, polls, days);
    if (sched.error) return fail(sched.error);
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('create_group_meeting', { p_group_id: id, p_title: title.trim(), p_member_ids: [...sel], p_mode: mode, p_times: sched.times, p_days: sched.surveys });
    setBusy(false);
    if (error) return fail(`만들지 못했어요: ${error.message}`);
    writeHost(data.meeting_id, { admin: data.admin_token, invites: Object.fromEntries(data.invites.map((i) => [i.participant_id, i.token])) });
    go(`/m/${data.meeting_id}/host?created=1`);
  }

  return html`
    <${Top} title="새 약속" back=${`#/g/${id}`} />
    <p class="muted small">${st.group.name}의 약속이에요.</p>
    <section class="card">
      <label for="gm-title">약속 이름</label>
      <input id="gm-title" type="text" maxLength="60" placeholder="예: 11월 정기모임" value=${title} onInput=${(e) => setTitle(e.target.value)} />
    </section>
    <h2 class="section-title">이번 약속에 참여할 멤버 <span class="muted small">${sel.size}/${st.members.length}명</span></h2>
    <section class="card">
      <div class="member-picks">${st.members.map((m) => html`<label class=${sel.has(m.id) ? 'mpick on' : 'mpick'}>
        <input type="checkbox" checked=${sel.has(m.id)} onChange=${() => toggle(m.id)} />
        <${Sprite} person=${m} size=${24} /><span>${m.display_name}${m.is_me ? ' (나)' : ''}</span>
        <span class="small muted">${m.joined ? '연결됨' : '초대 필요'}</span></label>`)}</div>
      <p class="muted small">모임방에 이미 들어온 멤버는 이 약속에 바로 연결돼요. ‘초대 필요’ 멤버에게만 약속 초대 링크를 보내면 돼요.</p>
    </section>
    <${ModePicker} mode=${mode} setMode=${setMode} />
    ${mode === 'poll' ? html`<${PollSetup} polls=${polls} setPolls=${setPolls} />` : html`<${GridSetup} days=${days} setDays=${setDays} common=${common} setCommon=${setCommon} />`}
    <${Msg} m=${msg} />
    <div class="fixed-cta"><button class="btn cta block" disabled=${busy} onClick=${create}>${busy ? '만드는 중…' : '약속 만들기'}</button></div>`;
}

// 공용 초대 링크(관리자). 007 SQL 이 DB 에 없으면 아무것도 보이지 않는다(동작하지 않는 버튼을 보이지 않기 위해).
// 링크 원문은 만들 때 한 번만 서버가 주고, 이 기기에만 저장해 다시 복사한다. 다른 기기에서는 '새 링크로 바꾸기'.
function JoinLinkCard({ id, groupName, archived }) {
  // 내 초대 링크(009): 관리자 30일 · 멤버 7일. 사람마다 1개, 새로 만들면 '내' 이전 링크만 꺼진다.
  const [st, setSt] = useState(null); // null 확인 중 · {state:'none'|'active'|'expired', is_admin, allow_member_invite, …}
  const [token, setToken] = useState(() => readJoinToken(id));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    const { data, error } = await sb.rpc('group_join_link_status', { p_group_id: id });
    if (error) { setSt(joinNotReady(error) ? { hidden: true } : { error: error.message }); return; }
    setSt(data);
  };
  useEffect(() => { load(); }, [id]);
  if (!st || st.hidden) return null;
  const isAdmin = !!st.is_admin;
  const life = isAdmin ? '30일' : '7일';

  async function make(rotate) {
    if (busy) return;
    if (rotate && !(await askConfirm({ title: '새 링크로 바꿀까요?', ok: '바꾸기',
      body: ['지금 내 초대 링크로는 더 이상 들어올 수 없어요.', '이미 들어온 멤버, 다른 사람이 만든 링크, 개인 초대 링크는 그대로예요.'] }))) return;
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('create_my_join_link', { p_group_id: id });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    writeJoinToken(id, data.token); setToken(data.token);
    setMsg({ type: 'ok', text: rotate ? '새 링크로 바꿨어요. 이전 링크는 이제 안 돼요.' : `초대 링크를 만들었어요(${life} 동안 사용 가능).` });
    load();
  }
  async function revoke() {
    if (busy || !(await askConfirm({ title: '내 초대 링크를 끌까요?', ok: '끄기', danger: true, body: ['이 링크로는 더 이상 들어올 수 없어요. 이미 들어온 멤버는 그대로예요.'] }))) return;
    setBusy(true);
    const { error } = await sb.rpc('revoke_my_join_link', { p_group_id: id });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    writeJoinToken(id, null); setToken(null); setMsg({ type: 'ok', text: '내 초대 링크를 껐어요.' }); load();
  }
  const text = `[${groupName}] 모이딱 모임방 초대예요. 링크를 열고 ‘참여하기’를 눌러 주세요.`;
  const active = st.state === 'active';
  const blocked = !isAdmin && st.allow_member_invite === false;
  return html`
    <h2 class="section-title">모임방 초대 링크</h2>
    <section class="card">
      <p class="small">여러 사람이 같은 링크로 들어올 수 있어요. 받은 사람이 ‘참여하기’를 눌러야 멤버가 돼요. 내가 만든 링크는 <strong>${life}</strong> 동안 쓸 수 있어요.</p>
      ${st.error && html`<${Msg} m=${{ type: 'error', text: st.error }} />`}
      ${blocked ? html`<p class="msg info small">관리자가 멤버 초대를 꺼 두었어요. 관리자에게 초대를 부탁해 주세요.</p>` : html`
      <p class="small"><strong>상태:</strong> ${active ? `사용 중 · ${st.use_count}명 참여 · ${new Date(st.expires_at).toLocaleDateString('ko-KR')}까지` : st.state === 'expired' ? '만료됨' : '아직 없음'}</p>
      ${active && token && html`<${InviteShare} kind="group" name=${groupName} url=${joinLink(token)} />`}
      ${active && !token && html`<p class="muted small">링크 원문은 만든 기기에만 저장돼요. 이 기기에서 보내려면 ‘새 링크로 바꾸기’를 눌러 주세요(내 이전 링크는 꺼져요).</p>`}
      ${!active && !archived && html`<button class="btn block" disabled=${busy} onClick=${() => make(false)}>초대 링크 만들기</button>`}
      ${active && html`<details class="mini-fold"><summary>링크 다시 만들기·끄기</summary>
        <p class="muted small">새로 만들면 지금 내 링크로는 더 이상 들어올 수 없어요. 이미 들어온 멤버는 그대로예요.</p>
        <div class="btn-row">
          ${!archived && html`<button class="btn ghost small" disabled=${busy} onClick=${() => make(true)}>새 링크로 바꾸기</button>`}
          <button class="btn danger small" disabled=${busy} onClick=${revoke}>내 링크 끄기</button>
        </div></details>`}`}
      <${Msg} m=${msg} />
    </section>`;
}

// 관리자: 모든 초대 링크(만든 사람·종류·만료·참여 수, 원문 없음) + 개별 취소·전체 끄기 + 멤버 초대 허용·정원
function AdminLinksCard({ id, group, memberCount, onChanged }) {
  const [list, setList] = useState(null);
  const [allow, setAllow] = useState(group.allow_member_invite !== false);
  const [cap, setCap] = useState(group.capacity || 50);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    const { data, error } = await sb.rpc('list_group_join_links', { p_group_id: id });
    setList(error ? (joinNotReady(error) ? 'hidden' : []) : data);
  };
  useEffect(() => { load(); }, [id]);
  if (list === null || list === 'hidden' || group.allow_member_invite === undefined) return null;
  const run = async (fn, args, ok) => {
    setBusy(true); setMsg(null);
    const { error } = await sb.rpc(fn, args);
    setBusy(false);
    setMsg(error ? { type: 'error', text: error.message } : { type: 'ok', text: ok });
    if (!error) { load(); if (onChanged) onChanged(); }
  };
  return html`
    <h3>모든 초대 링크·정원 <span class="muted small">관리자</span></h3>
    <section class="admin-links">
      ${list.length === 0 ? html`<p class="muted small">지금 쓸 수 있는 초대 링크가 없어요.</p>` : html`<ul class="people">${list.map((l) => html`<li>
        <span><strong>${l.created_by_name || '(나간 멤버)'}</strong> <span class=${l.kind === 'admin' ? 'pill host' : 'pill mode'}>${l.kind === 'admin' ? '관리자 링크' : '멤버 링크'}</span>
          <span class="small muted"> · ${l.state === 'expired' ? '만료됨' : `${new Date(l.expires_at).toLocaleDateString('ko-KR')}까지`} · ${l.use_count}명 참여</span></span>
        <button class="btn danger small" disabled=${busy} onClick=${async () => {
          if (await askConfirm({ title: '이 링크를 취소할까요?', ok: '취소하기', danger: true, body: [`${l.created_by_name || '나간 멤버'}님이 만든 링크로는 더 이상 들어올 수 없어요. 이미 들어온 멤버는 그대로예요.`] })) run('revoke_group_join_link_by_id', { p_link_id: l.id }, '링크를 취소했어요.');
        }}>취소</button></li>`)}</ul>`}
      ${list.length > 0 && html`<button class="btn ghost small" disabled=${busy} onClick=${async () => {
        if (await askConfirm({ title: '모든 초대 링크를 끌까요?', ok: '모두 끄기', danger: true, body: ['관리자·멤버가 만든 모든 공용 초대 링크로 더 이상 들어올 수 없어요.', '이미 들어온 멤버와 이름별 개인 초대 링크는 그대로예요.'] })) run('revoke_group_join_link', { p_group_id: id }, '모든 초대 링크를 껐어요.');
      }}>모든 링크 끄기</button>`}
      <label class="switch-row">
        <span><strong>멤버도 초대 링크 만들기</strong><span class="muted small">끄면 멤버가 만든 링크도 모두 꺼져요.</span></span>
        <input type="checkbox" role="switch" checked=${allow} disabled=${busy} onChange=${(e) => setAllow(e.currentTarget.checked)} />
      </label>
      <label for="gs-cap">정원 <span class="muted small">(지금 ${memberCount}명 · 최대 200명)</span></label>
      <input id="gs-cap" type="number" inputMode="numeric" min=${memberCount} max="200" value=${cap} onInput=${(e) => setCap(Number(e.target.value))} />
      <button class="btn block" disabled=${busy} onClick=${() => run('set_group_invite_policy', { p_group_id: id, p_allow_member: allow, p_capacity: cap }, '초대 설정을 저장했어요.')}>초대 설정 저장</button>
      <${Msg} m=${msg} />
    </section>`;
}

// 모임방 상세의 '친구 초대하기'(설정을 거치지 않음). 연결된 멤버라면 누구나 '내 초대 링크'를 만든다(관리자 30일·멤버 7일).
function InvitePanel({ id, group, admin, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  return html`<div class="invite-panel">
    <button type="button" class="btn ghost block" aria-expanded=${open} aria-controls="invite-body" onClick=${() => setOpen(!open)}>
      <${PixelIcon} name="people" size=${16} /> 친구 초대하기</button>
    ${open && html`<div id="invite-body">
      <${JoinLinkCard} id=${id} groupName=${group.name} archived=${!!group.archived_at} />
      ${admin && html`<p class="muted small">모든 링크 관리·특정한 사람 전용 링크(이름별 개인 초대 링크)는 <a href=${`#/g/${id}/settings`}>설정·멤버 관리</a>에 있어요.</p>`}
    </div>`}
  </div>`;
}
