// 주최자 관리 탭: 공유 링크 · 참가자별 개인 초대 링크 · 관리자 복구 링크(주소는 화면에 펼치지 않고 복사만)
import { PixelIcon } from '../ui/Pixel.js';
import { html, useState } from '../lib/deps.js';
import { sb } from '../lib/sb.js';
import { readHost, writeHost, copyText, toast, meetingLink, inviteLink, adminLink, meetingJoinLink, MODE_LABEL } from '../lib/util.js';
import { askConfirm, Msg } from '../ui/common.js';
import { InviteShare } from '../ui/InviteShare.js';

export function HostTab({ v, reload, created }) {
  const [cache, setCache] = useState(() => readHost(v.meeting.id));
  const [busyId, setBusyId] = useState(null);
  const inviteMsg = (p, token) => `${p.display_name}님, [${v.meeting.title}] 모이딱 초대 링크예요.\n`
    + `본인만 쓰는 링크라 다른 사람에게 보내지 말아 주세요 🙏\n${inviteLink(v.meeting.id, token)}`;

  async function reissue(p) {
    if (p.user_id && !confirm(`${p.display_name}님은 이미 연결돼 있어요.\n새 링크를 만들면 지금 연결된 기기는 응답할 수 없고 새 링크로만 들어올 수 있어요. (이미 낸 응답은 남아요)\n계속할까요?`)) return;
    setBusyId(p.id);
    const { data, error } = await sb.rpc('reissue_invite', { p_participant_id: p.id });
    setBusyId(null);
    if (error) { toast(error.message); return; }
    writeHost(v.meeting.id, { invites: { [p.id]: data.token } });
    setCache(readHost(v.meeting.id));
    await copyText(inviteMsg(p, data.token), '새 초대 링크를 복사했어요. 이전 링크는 이제 안 돼요.');
    reload();
  }

  const linkMode = v.meeting.join_mode === 'link';
  const others = v.participants.filter((p) => p.id !== v.meeting.host_participant_id);
  return html`
    <section class="card" aria-labelledby="host-h">
      <h2 id="host-h"><${PixelIcon} name="crown" size=${16} /> 주최자 관리</h2>
      <p class="muted small">주최자에게만 보이는 화면이에요.</p>
      ${created && html`<div class="msg ok" role="status">약속을 만들었어요! (${MODE_LABEL[v.mode]}) 아래 초대 링크로 친구를 불러 주세요.</div>`}

      ${linkMode ? html`<${MeetingLinkCard} v=${v} cache=${cache} setCache=${setCache} />`
        : v.group ? html`<div class="host-box">
            <h3>약속 초대</h3>
            <p class="small">이 약속은 <strong>${v.group.name}</strong> 모임방 멤버 중 고른 사람이 참여해요. 모임방에 들어온 멤버는 링크 없이 바로 연결돼요.</p>
            <p class="small">새 친구는 먼저 <a href=${`#/g/${v.group.id}?invite_open=1`}>모임방 초대 링크</a>로 모임방에 들어와야 해요.</p>
            ${others.some((p) => !p.user_id) && html`<${PersonInvites} v=${v} cache=${cache} people=${others.filter((p) => !p.user_id)} reissue=${reissue} busyId=${busyId} />`}
          </div>`
        : html`<div class="host-box">
            <h3>약속 초대 링크 <span class="muted small">(사람별)</span></h3>
            <p class="small">이름을 미리 넣은 약속이라 사람마다 링크가 달라요. 각자에게 1:1로 보내 주세요.</p>
            <${PersonInvites} v=${v} cache=${cache} people=${others} reissue=${reissue} busyId=${busyId} />
          </div>`}
      <ol class="howto short">
        <li>초대 링크를 카카오톡으로 보내기</li>
        <li>친구가 링크를 열고 응답하기</li>
        <li>응답이 모이면 <strong>일정 탭</strong>에서 확정하기</li>
      </ol>

      <details class="fold">
        <summary><span class="fold-title">고급 링크·복구</span><span class="fold-sub">링크 다시 만들기·끄기, 다른 기기 연결, 약속 주소, 주최자 복구</span></summary>
        <div class="fold-body small">
          ${linkMode && html`<${MeetingLinkAdmin} v=${v} cache=${cache} setCache=${setCache} />`}
          <h3>${linkMode ? '참여한 사람 다른 기기로 옮기기' : '사람별 링크 다시 만들기'}</h3>
          <p class="muted small">새 링크를 만들면 그 사람의 이전 링크와 이전 기기 연결은 끊기고 새 링크를 연 기기가 연결돼요(이미 낸 응답은 남아요).</p>
          <ul class="people">
            ${others.map((p) => html`<li>
              <span><strong>${p.display_name}</strong> ${p.user_id ? html`<span class="tag ok">✓ 연결됨</span>` : html`<span class="tag">아직 안 들어옴</span>`}</span>
              <button class="btn ghost small" disabled=${busyId === p.id} onClick=${() => reissue(p)}>${cache.invites[p.id] || p.user_id ? '새 링크 발급' : '링크 만들기'}</button>
            </li>`)}
          </ul>
          <h3>약속 주소 <span class="muted small">(초대 링크 아님)</span></h3>
          <p class="muted small">이미 들어온 사람이 약속을 다시 여는 주소예요. 새 친구는 이 주소로 참여할 수 없어요.</p>
          <button class="btn ghost small" onClick=${() => copyText(meetingLink(v.meeting.id), '약속 주소를 복사했어요.')}>약속 주소 복사</button>
          <h3>다른 기기에서 주최자로 들어가기</h3>
          ${cache.admin
            ? html`<p class="muted small"><strong>주의:</strong> 이 링크를 연 기기가 주최자가 돼요. 아무에게도 보내지 말고 나에게만 보관해 주세요.</p>
                   <button class="btn ghost small" onClick=${() => copyText(adminLink(v.meeting.id, cache.admin), '관리자 복구 링크를 복사했어요. 나만 보관해 주세요.')}>관리자 복구 링크 복사</button>`
            : html`<p class="muted small">관리자 복구 링크는 약속을 만든 기기에만 저장돼 있어요.</p>`}
        </div>
      </details>
    </section>`;
}

// 사람별 약속 초대 링크(명단형·모임방 약속의 미연결 멤버): 카카오톡 공유·복사. 링크 원문은 만든 기기에만 있다.
function PersonInvites({ v, cache, people, reissue, busyId }) {
  return html`<ul class="people person-invites">${people.map((p) => {
    const token = cache.invites[p.id];
    return html`<li>
      <span><strong>${p.display_name}</strong> ${p.user_id ? html`<span class="tag ok">✓ 연결됨</span>` : html`<span class="tag">아직 안 들어옴</span>`}</span>
      ${p.user_id ? null : token ? html`<${InviteShare} kind="meeting" name=${`${v.meeting.title} (${p.display_name}님 전용)`} url=${inviteLink(v.meeting.id, token)} label="초대 링크" />`
        : html`<button class="btn ghost small" disabled=${busyId === p.id} onClick=${() => reissue(p)}>초대 링크 만들기</button>`}
    </li>`;
  })}</ul>`;
}

// 약속 초대 링크(010, 링크 참여형): 카카오톡 공유·복사. 원문은 만든 기기에만 저장(서버는 해시만).
function MeetingLinkCard({ v, cache, setCache }) {
  const token = cache.joinToken || null;
  const fin = v.meeting.status === 'finalized';
  return html`<div class="host-box link-box">
    <h3>약속 초대 링크</h3>
    <p class="small">링크로 참여한 사람 <strong>${v.N}명</strong>(최대 30명) · 일정 응답 ${v.schedDone.length}/${v.N}명</p>
    <p class="muted small">링크를 받고 아직 들어오지 않은 사람은 알 수 없어요.</p>
    ${fin ? html`<p class="muted small">최종 확정된 약속이라 새로 참여할 수 없어요.</p>`
      : token ? html`<${InviteShare} kind="meeting" name=${v.meeting.title} url=${meetingJoinLink(token)} confirmed=${!!v.selectedStart} />`
        : html`<p class="muted small">초대 링크는 약속을 만든 기기에만 저장돼요. 이 기기에서 보내려면 아래 ‘고급 링크·복구’에서 새 링크를 만들어 주세요(이전 링크는 꺼져요).</p>`}
  </div>`;
}

// 고급: 약속 초대 링크 새로 만들기·끄기
function MeetingLinkAdmin({ v, cache, setCache }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const token = cache.joinToken || null;
  if (v.meeting.status === 'finalized') return null;
  async function rotate() {
    if (busy) return;
    if (token && !(await askConfirm({ title: '새 초대 링크로 바꿀까요?', ok: '바꾸기', body: ['지금 링크로는 더 이상 참여할 수 없어요.', '이미 참여한 사람은 그대로예요.'] }))) return;
    setBusy(true); setMsg(null);
    const { data, error } = await sb.rpc('rotate_meeting_join_link', { p_meeting_id: v.meeting.id });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    writeHost(v.meeting.id, { joinToken: data.token }); setCache(readHost(v.meeting.id));
    setMsg({ type: 'ok', text: '새 초대 링크를 만들었어요(14일 동안 사용 가능). 위에서 공유해 주세요.' });
  }
  async function revoke() {
    if (busy || !(await askConfirm({ title: '초대 링크를 끌까요?', ok: '끄기', danger: true, body: ['이 링크로는 더 이상 참여할 수 없어요. 이미 참여한 사람은 그대로예요.'] }))) return;
    setBusy(true);
    const { error } = await sb.rpc('revoke_meeting_join_link', { p_meeting_id: v.meeting.id });
    setBusy(false);
    if (error) { setMsg({ type: 'error', text: error.message }); return; }
    writeHost(v.meeting.id, { joinToken: null }); setCache(readHost(v.meeting.id));
    setMsg({ type: 'ok', text: '초대 링크를 껐어요.' });
  }
  return html`<h3>약속 초대 링크 다시 만들기·끄기</h3>
    <div class="btn-row">
      <button class="btn ghost small" disabled=${busy} onClick=${rotate}>${token ? '새 링크로 바꾸기' : '새 초대 링크 만들기'}</button>
      ${token && html`<button class="btn danger small" disabled=${busy} onClick=${revoke}>링크 끄기</button>`}
    </div>
    <${Msg} m=${msg} />`;
}
