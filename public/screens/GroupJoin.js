// 공용 초대 링크로 모임방 참여(#/join?t=…). 링크를 열기만 해서는 가입되지 않는다 — '참여하기'를 눌러야 한다.
// 보이는 정보: 모임방 이름·테마·링크 상태뿐(멤버·약속·설명은 가입 후). 서버(007 RPC)가 토큰·권한·중복·정원·속도 제한을 검사한다.
import { html, useState, useEffect } from '../lib/deps.js';
import { PixelIcon } from '../ui/Pixel.js';
import { sb, friendly } from '../lib/sb.js';
import { cleanUrl, go } from '../lib/util.js';
import { joinNotReady } from '../lib/groups.js';
import { useMe, saveMe } from '../lib/me.js';
import { ThemeScene } from '../ui/ThemeScene.js';
import { Msg } from '../ui/common.js';

const STATE_MSG = {
  invalid: '초대 링크가 올바르지 않아요. 받은 링크를 다시 확인해 주세요.',
  revoked: '이 초대 링크는 새 링크로 바뀌었어요. 관리자에게 새 링크를 받아 주세요.',
  expired: '초대 링크가 만료됐어요. 관리자에게 새 링크를 받아 주세요.',
  archived: '종료된 모임방이에요.',
  full: '모임방 정원이 다 찼어요.',
};

export function GroupJoinPage({ params }) {
  const [token] = useState(() => params.get('t') || '');
  const [st, setSt] = useState({ phase: 'loading' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const me = useMe();
  useEffect(() => { if (me && me.nickname && !name) setName(me.nickname); }, [me && me.nickname]);

  useEffect(() => {
    cleanUrl('/join'); // 토큰을 주소창·방문 기록에 오래 남기지 않는다(화면 상태에만 보관)
    (async () => {
      if (!token) { setSt({ phase: 'done', info: { state: 'invalid' } }); return; }
      const { data, error } = await sb.rpc('preview_group_join_link', { p_token: token });
      if (error) { setSt({ phase: joinNotReady(error) ? 'notready' : 'error', error: friendly(error.message) }); return; }
      setSt({ phase: 'done', info: data });
    })();
  }, []);

  async function join() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('join_group_with_link', { p_token: token, p_display_name: name.trim() });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: friendly(error.message) }); return; }
    if (data && data.state === 'invalid') { setMsg({ type: 'error', text: STATE_MSG.invalid }); return; }
    if (me && !me.nickname) await saveMe(name.trim(), null); // 다음 참여 때 다시 쓰지 않게(캐릭터는 그대로)
    go(`/g/${data.group_id}`);
  }

  const info = st.info || {};
  return html`
    <div class="topbar"><a class="back" href="#/" aria-label="홈으로"><${PixelIcon} name="back" size=${14} /></a><span class="top-title">모임방 초대</span><span class="top-gap"></span></div>
    ${st.phase === 'loading' && html`<p class="muted center">초대 링크를 확인하는 중…</p>`}
    ${st.phase === 'notready' && html`<div class="card"><h1>아직 준비 중인 기능이에요</h1><p>공용 초대 링크는 아직 열리지 않았어요. 관리자에게 개인 초대 링크를 받아 주세요.</p></div>`}
    ${st.phase === 'error' && html`<div class="card"><h1>초대 링크를 확인하지 못했어요</h1><p>${st.error}</p><button class="btn" onClick=${() => location.reload()}>다시 시도</button></div>`}
    ${st.phase === 'done' && info.name && html`<${ThemeScene} theme=${info.theme} people=${[]} height=${110} small=${false} />`}
    ${st.phase === 'done' && info.state === 'member' && html`<div class="card"><h1>${info.name}</h1><p>이미 이 모임방 멤버예요.</p>
      <a class="btn block" href=${`#/g/${info.group_id}`}>모임방으로 가기</a></div>`}
    ${st.phase === 'done' && STATE_MSG[info.state] && html`<div class="card"><h1>${info.name || '모임방 초대'}</h1><p>${STATE_MSG[info.state]}</p></div>`}
    ${st.phase === 'done' && info.state === 'ok' && html`<section class="card">
      <h1>${info.name}</h1>
      ${info.description && html`<p class="muted">${info.description}</p>`}
      <p>이 모임방에 참여할까요? 참여하면 멤버들과 다음 약속을 함께 정할 수 있어요.</p>
      <label for="join-name">모임방에서 쓸 내 이름</label>
      <input id="join-name" type="text" maxLength="20" placeholder="예: 구름빵" value=${name} onInput=${(e) => setName(e.target.value)} />
      <p class="muted small">참여 전에는 멤버 목록·약속이 보이지 않아요. 참여해도 지난 약속에 자동으로 응답되지 않아요.
        이 기기(브라우저)에 저장되는 익명 계정이라, 다른 기기에서는 다시 초대받아야 해요.</p>
      <${Msg} m=${msg} />
      <button class="btn cta block" disabled=${busy || !name.trim()} onClick=${join}>${busy ? '참여하는 중…' : '참여하기'}</button>
    </section>`}`;
}

// 일회성 약속 참여 링크(#/join-m?t=…, 010). 보이는 정보: 약속 제목·상태뿐. '참여하기'를 눌러야 참여자가 된다.
const M_STATE = {
  invalid: '참여 링크가 올바르지 않아요. 받은 링크를 다시 확인해 주세요.',
  revoked: '이 참여 링크는 꺼졌어요. 주최자에게 새 링크를 받아 주세요.',
  expired: '참여 링크가 만료됐어요. 주최자에게 새 링크를 받아 주세요.',
  closed: '이미 최종 확정된 약속이라 새로 참여할 수 없어요.',
  full: '참여 인원(최대 30명)이 다 찼어요.',
};
export function MeetingJoinPage({ params }) {
  const [token] = useState(() => params.get('t') || '');
  const [st, setSt] = useState({ phase: 'loading' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const me = useMe();
  useEffect(() => { if (me && me.nickname && !name) setName(me.nickname); }, [me && me.nickname]);
  useEffect(() => {
    cleanUrl('/join-m');
    (async () => {
      if (!token) { setSt({ phase: 'done', info: { state: 'invalid' } }); return; }
      const { data, error } = await sb.rpc('preview_meeting_join_link', { p_token: token });
      if (error) { setSt({ phase: /preview_meeting_join|schema cache|Could not find the function/i.test(error.message) ? 'notready' : 'error', error: friendly(error.message) }); return; }
      setSt({ phase: 'done', info: data });
    })();
  }, []);
  async function join() {
    if (busy) return;
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('join_meeting_with_link', { p_token: token, p_display_name: name.trim() });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: friendly(error.message) }); return; }
    if (data && data.state === 'invalid') { setMsg({ type: 'error', text: M_STATE.invalid }); return; }
    if (me && !me.nickname) await saveMe(name.trim(), null);
    go(`/m/${data.meeting_id}/schedule`);
  }
  const info = st.info || {};
  return html`
    <div class="topbar"><a class="back" href="#/" aria-label="홈으로"><${PixelIcon} name="back" size=${14} /></a><span class="top-title">약속 초대</span><span class="top-gap"></span></div>
    ${st.phase === 'loading' && html`<p class="muted center">참여 링크를 확인하는 중…</p>`}
    ${st.phase === 'notready' && html`<div class="card"><h1>아직 준비 중인 기능이에요</h1><p>주최자에게 개인 초대 링크를 받아 주세요.</p></div>`}
    ${st.phase === 'error' && html`<div class="card"><h1>참여 링크를 확인하지 못했어요</h1><p>${st.error}</p><button class="btn" onClick=${() => location.reload()}>다시 시도</button></div>`}
    ${st.phase === 'done' && info.state === 'member' && html`<div class="card"><h1>${info.title}</h1><p>이미 이 약속에 참여했어요.</p>
      <a class="btn block" href=${`#/m/${info.meeting_id}`}>약속으로 가기</a></div>`}
    ${st.phase === 'done' && M_STATE[info.state] && html`<div class="card"><h1>${info.title || '약속 초대'}</h1><p>${M_STATE[info.state]}</p></div>`}
    ${st.phase === 'done' && info.state === 'ok' && html`<section class="card">
      <h1>${info.title}</h1>
      <p>이 약속에 참여할까요? 참여하면 가능한 시간을 알려 줄 수 있어요.</p>
      <label for="join-m-name">약속에서 쓸 내 이름</label>
      <input id="join-m-name" type="text" maxLength="20" placeholder="예: 구름빵" value=${name} onInput=${(e) => setName(e.target.value)} />
      <p class="muted small">참여 전에는 다른 참여자·후보 시간이 보이지 않아요. 이 기기(브라우저)에 저장되는 익명 계정이라, 다른 기기에서는 이 링크로 다시 참여해야 해요(새 참여자로 들어가요).</p>
      <${Msg} m=${msg} />
      <button class="btn cta block" disabled=${busy || !name.trim()} onClick=${join}>${busy ? '참여하는 중…' : '참여하기'}</button>
    </section>`}`;
}
