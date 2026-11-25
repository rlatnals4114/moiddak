// 내 정보·설정: 프로필(닉네임)·내 캐릭터·참여 중인 모임·기기 연결 상태.
// 계정은 이 브라우저의 Supabase 익명 계정이다. 로그인·비밀번호·다른 기기 복구는 없으므로 있는 것처럼 보이지 않게 한다.
import { html, useState, useEffect } from '../lib/deps.js';
import { useMe, saveMe, myBase } from '../lib/me.js';
import { STATUS_LABEL } from '../lib/util.js';
import { CHARACTER_TYPES, TYPE_KEYS } from '../assets/characters/index.js';
import { Sprite } from '../ui/Avatar.js';
import { SkyDecor, PixelIcon } from '../ui/Pixel.js';
import { Msg } from '../ui/common.js';
import { getReduceMotionSetting, setReduceMotionSetting } from '../lib/prefs.js';
import { loadMine } from './Home.js';

function Top({ title, back }) {
  return html`<div class="topbar">
    ${back ? html`<a class="back" href=${back} aria-label="뒤로"><${PixelIcon} name="back" size=${14} /></a>` : html`<span class="top-gap"></span>`}
    <span class="top-title">${title}</span><span class="top-gap"></span>
  </div>`;
}

const NotReady = () => html`<div class="msg warn">내 정보 저장 기능을 쓰려면 DB 추가 설정(003 SQL)이 필요해요. 그 전에는 기본 캐릭터가 자동으로 정해져요.</div>`;

export function ProfilePage({ uid, sub }) {
  const me = useMe();
  if (sub === 'character') return html`<${CharacterPicker} me=${me} />`;
  return html`<${ProfileHome} me=${me} uid=${uid} />`;
}

function ProfileHome({ me, uid }) {
  const [nick, setNick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [mine, setMine] = useState(null);
  useEffect(() => { if (me && me.ready) setNick(me.nickname || ''); }, [me && me.nickname, me && me.ready]);
  useEffect(() => { loadMine().then(setMine).catch(() => setMine([])); }, []);
  const ready = !!(me && me.ready && !me.error);
  const base = myBase(me);

  async function saveNick(e) {
    e.preventDefault();
    if (busy || !ready) return;
    const n = nick.trim();
    if (n.length > 20) return setMsg({ type: 'error', text: '닉네임은 20자까지예요.' });
    setBusy(true); setMsg(null);
    const { error } = await saveMe(n || null, null);
    setBusy(false);
    setMsg(error ? { type: 'error', text: error.message } : { type: 'ok', text: '저장했어요 ✓' });
  }

  return html`
    <${Top} title="내 정보" back=${null} />
    <section class="profile-hero">
      <${SkyDecor} />
      <div class="ph-char"><${Sprite} type=${base} size=${72} /></div>
      <div class="ph-text">
        <strong>${(me && me.nickname) || '닉네임 없음'}</strong>
        <span>${CHARACTER_TYPES[base].label} · ${CHARACTER_TYPES[base].note}</span>
        <span class="pill mode">이 브라우저의 익명 계정</span>
      </div>
    </section>
    ${me && !me.ready && html`<${NotReady} />`}
    ${me && me.error && html`<${Msg} m=${{ type: 'error', text: me.error }} />`}

    <h2 class="section-title">내 프로필</h2>
    <form class="card" onSubmit=${saveNick}>
      <label for="nick">닉네임 <span class="muted small">(내 정보 화면에만 보여요)</span></label>
      <input id="nick" type="text" maxLength="20" placeholder="예: 구름빵" value=${nick} disabled=${!ready} onInput=${(e) => setNick(e.target.value)} />
      <p class="muted small">모임 안에서는 주최자가 정한 이름(명단 이름)으로 보여요.</p>
      <${Msg} m=${msg} />
      <button class="btn block" type="submit" disabled=${busy || !ready}>${busy ? '저장 중…' : '닉네임 저장'}</button>
    </form>

    <h2 class="section-title">내 캐릭터</h2>
    <a class="todo-card" href="#/me/character">
      <span class="todo-icon char-tile" aria-hidden="true"><${Sprite} type=${base} size=${24} /></span>
      <span class="todo-text"><strong>캐릭터 고르기</strong><span>지금: ${CHARACTER_TYPES[base].label}${me && me.avatar && me.avatar.base ? '' : ' (기본값)'} · 모든 모임에 같은 캐릭터로 보여요</span></span>
      <span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span>
    </a>

    <h2 class="section-title">바로 가기</h2>
    <section class="card summary">
      <a class="sum-row" href="#/calendar"><span class="row-label"><${PixelIcon} name="cal" size=${14} /> 내 캘린더</span><span class="muted small row-label">모든 모임의 약속 <${PixelIcon} name="chev" size=${7} /></span></a>
      <a class="sum-row" href="#/groups"><span class="row-label"><${PixelIcon} name="house" size=${14} /> 내 모임방</span><span class="muted small row-label">모임방 목록 <${PixelIcon} name="chev" size=${7} /></span></a>
    </section>

    <h2 class="section-title">내가 만든 약속 ${mine && html`<span class="muted small">${mine.filter((m) => m.owner_user_id === uid).length}개</span>`}</h2>
    <section class="card">
      ${mine && mine.filter((m) => m.owner_user_id === uid).length === 0 && html`<p class="muted small">아직 없어요.</p>`}
      ${mine && html`<ul class="list row-list">${mine.filter((m) => m.owner_user_id === uid).map((m) => html`<li><a class="row-link" href=${`#/m/${m.id}`}><span>${m.title}</span><span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span></a>
        <span class="small muted">${STATUS_LABEL[m.status]}</span></li>`)}</ul>`}
    </section>

    <h2 class="section-title">참여 중인 약속 ${mine && html`<span class="muted small">${mine.length}개</span>`}</h2>
    <section class="card">
      ${mine === null && html`<p class="muted">불러오는 중…</p>`}
      ${mine && mine.length === 0 && html`<p class="muted small">아직 없어요. 개인 초대 링크를 열거나 새 모임을 만들면 여기에 나타나요.</p>`}
      ${mine && mine.length > 0 && html`<ul class="list row-list">
        ${mine.map((m) => {
          const mineP = m.people.find((p) => p.user_id === uid);
          return html`<li><a class="row-link" href=${`#/m/${m.id}`}><span>${m.title}</span><span class="chev" aria-hidden="true"><${PixelIcon} name="chev" size=${7} /></span></a>
            <span class="small muted">${mineP ? `나: ${mineP.display_name}` : '참석 안 함'}${m.owner_user_id === uid ? ' · 주최' : ''} · ${STATUS_LABEL[m.status]}</span></li>`;
        })}
      </ul>`}
    </section>

    <h2 class="section-title">앱 설정</h2>
    <${MotionSetting} />

    <h2 class="section-title">계정·기기 연결 상태</h2>
    <section class="card device-card">
      <p><strong><${PixelIcon} name="pin" size=${12} /> 이 브라우저에 저장된 익명 계정으로 사용 중이에요.</strong></p>
      <ul class="howto">
        <li>로그인·비밀번호가 없어요. 회원가입 없이 쓰는 대신, <strong>다른 브라우저·기기에서는 이 정보(닉네임·캐릭터·모임 목록)가 보이지 않아요.</strong></li>
        <li>카카오톡 안 브라우저와 사파리/크롬도 서로 다른 브라우저예요.</li>
        <li>브라우저의 방문 기록·사이트 데이터를 지우면 이 계정이 사라질 수 있어요.</li>
        <li>다른 기기로 옮기려면: 참가자는 주최자에게 <strong>새 개인 초대 링크</strong>를, 주최자는 <strong>관리자 복구 링크</strong>를 그 기기에서 열어요. 닉네임·캐릭터는 그 기기에서 다시 정해야 해요.</li>
      </ul>
      <p class="muted small">기기 식별값: ${uid.slice(0, 8)}… (문의할 때만 사용)</p>
    </section>`;
}

function CharacterPicker({ me }) {
  const current = myBase(me);
  const [pick, setPick] = useState(null);
  const chosen = pick || current;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const ready = !!(me && me.ready && !me.error);

  async function save() {
    if (busy || !ready) return;
    setBusy(true); setMsg(null);
    const avatar = { ...((me && me.avatar) || {}), v: 1, base: chosen };
    const { data, error } = await saveMe(me.nickname || null, avatar);
    setBusy(false);
    setMsg(error ? { type: 'error', text: error.message }
      : { type: 'ok', text: `저장했어요 ✓ ${data && data.meetings_updated ? `참여 중인 모임 ${data.meetings_updated}곳에도 반영했어요.` : ''}` });
  }

  return html`
    <${Top} title="캐릭터 고르기" back="#/me" />
    <section class="profile-hero big">
      <${SkyDecor} />
      <div class="ph-char"><${Sprite} type=${chosen} size=${96} /></div>
      <div class="ph-text"><strong>${CHARACTER_TYPES[chosen].label}</strong><span>${CHARACTER_TYPES[chosen].note}</span></div>
    </section>
    ${me && !me.ready && html`<${NotReady} />`}
    <div class="char-grid" role="radiogroup" aria-label="기본 캐릭터 4종">
      ${TYPE_KEYS.map((k) => html`<button type="button" role="radio" aria-checked=${chosen === k} class=${chosen === k ? 'char-opt on' : 'char-opt'} onClick=${() => setPick(k)}>
        <span class="co-stage"><${Sprite} type=${k} size=${48} /></span>
        <strong>${CHARACTER_TYPES[k].label}</strong>
        <span class="small muted">${CHARACTER_TYPES[k].note}</span>
        ${current === k && html`<span class="pill mode">지금 캐릭터</span>`}
      </button>`)}
    </div>
    <p class="muted small">고른 캐릭터는 내가 참여한 모든 모임에서 같은 모습으로 보여요. 응답 상태(완료·미응답·가능 시간 없음)는 캐릭터와 따로 표시돼요.</p>
    <div class="card soon">
      <p><strong>머리·표정·옷·액세서리 꾸미기</strong> <span class="pill mode">준비 중</span></p>
      <p class="muted small">다음 업데이트에서 파츠를 골라 조합할 수 있게 할 예정이에요. 지금은 기본 캐릭터 4종 중에서 골라요.</p>
    </div>
    <${Msg} m=${msg} />
    <div class="fixed-cta">
      <button class="btn block" disabled=${busy || !ready || chosen === (me && me.avatar && me.avatar.base)} onClick=${save}>
        ${busy ? '저장 중…' : chosen === (me && me.avatar && me.avatar.base) ? '저장된 캐릭터예요' : `${CHARACTER_TYPES[chosen].label}로 저장`}
      </button>
    </div>`;
}

// 움직임 줄이기: 이 기기에만 저장. 시스템 '동작 줄이기'가 켜져 있으면 이 설정과 상관없이 멈춘다.
function MotionSetting() {
  const [on, setOn] = useState(getReduceMotionSetting());
  const sys = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return html`<section class="card setting-row">
    <label class="switch-row">
      <span><strong>움직임 줄이기</strong><span class="muted small">모임방 캐릭터·배경이 움직이지 않고 멈춘 그림으로 보여요.</span></span>
      <input type="checkbox" role="switch" checked=${on || sys} disabled=${sys}
        onChange=${(e) => { setOn(e.currentTarget.checked); setReduceMotionSetting(e.currentTarget.checked); }} />
    </label>
    ${sys && html`<p class="muted small">기기 설정에서 '동작 줄이기'가 켜져 있어서 항상 멈춘 그림으로 보여요.</p>`}
  </section>`;
}
