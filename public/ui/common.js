import { html, useState, useEffect, useRef } from '../lib/deps.js';
import { PixelIcon } from './Pixel.js';

// 확인 창(버튼 이름을 정할 수 있는 접근 가능한 대화상자). 결과: true = 확인 버튼, false = 돌아가기·Esc·바깥 누름
export function askConfirm({ title, body = [], ok = '확인', cancel = '돌아가기', danger = false }) {
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent('moiddak:confirm', { detail: { title, body, ok, cancel, danger, resolve } })));
}

function ConfirmDialog({ d, onDone }) {
  const cancelRef = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    if (cancelRef.current) cancelRef.current.focus(); // 안전한 선택(돌아가기)에 먼저 초점
    const onKey = (e) => { if (e.key === 'Escape') onDone(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => { if (e.target === e.currentTarget) onDone(false); }}>
    <div class="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-body">
      <h2 id="cf-title">${d.title}</h2>
      <div id="cf-body">${d.body.filter(Boolean).map((t) => html`<p>${t}</p>`)}</div>
      <div class="btn-row">
        <button type="button" class="btn ghost grow" ref=${cancelRef} onClick=${() => onDone(false)}>${d.cancel}</button>
        <button type="button" class=${`btn grow ${d.danger ? 'danger' : ''}`} onClick=${() => onDone(true)}>${d.ok}</button>
      </div>
    </div>
  </div>`;
}

// 빈 화면: 픽셀 아이콘 + 상황 설명 + (있으면) 다음 행동. 아이콘은 장식이라 화면 읽기에서 숨긴다.
export function EmptyState({ icon = 'star', title, text, action, compact = false }) {
  return html`<div class=${`empty-state ${compact ? 'compact' : ''}`}>
    <span class="es-icon" aria-hidden="true"><${PixelIcon} name=${icon} size=${compact ? 20 : 28} /></span>
    ${title && html`<p><strong>${title}</strong></p>`}
    ${text && html`<p class="muted small">${text}</p>`}
    ${action && html`<a class="btn small" href=${action.href}>${action.label}</a>`}
  </div>`;
}

export const Msg = ({ m }) => (m ? html`<div class="msg ${m.type}" role=${m.type === 'error' ? 'alert' : 'status'}>${m.text}</div>` : null);

export function Overlays() {
  const [msg, setMsg] = useState('');
  const [manual, setManual] = useState(null);
  const [ask, setAsk] = useState(null);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => {
    let timer;
    const onToast = (e) => { setMsg(e.detail); clearTimeout(timer); timer = setTimeout(() => setMsg(''), 2600); };
    const onManual = (e) => setManual(e.detail);
    const onAsk = (e) => setAsk(e.detail);
    window.addEventListener('moiddak:confirm', onAsk);
    window.addEventListener('moiddak:toast', onToast);
    window.addEventListener('moiddak:manual-copy', onManual);
    return () => { window.removeEventListener('moiddak:toast', onToast); window.removeEventListener('moiddak:manual-copy', onManual); window.removeEventListener('moiddak:confirm', onAsk); };
  }, []);
  return html`
    ${offline && html`<div class="offline-bar" role="alert">인터넷 연결이 끊겼어요. 연결되면 다시 눌러 주세요. (화면에 고른 내용은 그대로 있어요)</div>`}
    ${msg && html`<div class="toast" role="status">${msg}</div>`}
    ${ask && html`<${ConfirmDialog} d=${ask} onDone=${(v) => { ask.resolve(v); setAsk(null); }} />`}
    ${manual !== null && html`
      <div class="modal-bg" role="dialog" aria-modal="true" aria-label="직접 복사하기">
        <div class="modal">
          <h2>직접 복사해 주세요</h2>
          <p class="muted">이 브라우저에서는 자동 복사가 안 돼요. 아래 글을 길게 눌러 전체 선택 후 복사해 주세요.</p>
          <textarea readonly onFocus=${(e) => e.target.select()} ref=${(el) => el && setTimeout(() => el.select(), 50)}>${manual}</textarea>
          <div class="btn-row"><button class="btn block" onClick=${() => setManual(null)}>닫기</button></div>
        </div>
      </div>`}
  `;
}

// 응답 현황: 완료 n/N + 완료·미응답 이름(색 + 기호 + 글자)
// closed: 조율이 끝난 뒤의 기록(‘아직’·⏰ 처럼 진행 중인 것처럼 보이지 않게)
export function Progress({ label, done, pending, total, none = [], onRequest, closed = false }) {
  return html`
    <div class="progress">
      <div><span class="big">${done.length}/${total}명</span> ${label} 완료</div>
      ${done.length > 0 && html`<ul class="chips" aria-label="응답 완료">${done.map((p) => html`
        <li class="chip done">✓ ${p.display_name}${none.includes(p) ? ' (가능 시간 없음)' : ''}</li>`)}</ul>`}
      ${pending.length > 0
        ? html`<p class="small">${closed ? '투표에 응답하지 않음' : '아직 응답 안 함'} ${pending.length}명</p>
               <ul class="chips" aria-label="미응답">${pending.map((p) => html`<li class=${closed ? 'chip' : 'chip pending'}>${!closed && html`<${PixelIcon} name="clock" size=${11} /> `}${p.display_name}</li>`)}</ul>`
        : html`<p class="small"><${PixelIcon} name="sparkle" size=${11} /> 모두 응답했어요.</p>`}
      ${onRequest && pending.length > 0 && html`
        <button class="btn ghost small" onClick=${onRequest}>미응답 ${pending.length}명에게 보낼 문구 복사</button>`}
    </div>`;
}

// 세그먼트 탭(입력/결과 분리 등)
export function Segmented({ value, options, onChange, label }) {
  return html`<div class="segmented" role="tablist" aria-label=${label}>
    ${options.map((o) => html`<button type="button" role="tab" aria-selected=${value === o.value}
      class=${value === o.value ? 'on' : ''} onClick=${() => onChange(o.value)}>${o.label}</button>`)}
  </div>`;
}

export function TimeSelect({ value, onChange, steps, label, id }) {
  return html`<select id=${id} aria-label=${label} value=${value} onChange=${(e) => onChange(Number(e.target.value))}>
    ${steps.map((m) => html`<option value=${m}>${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</option>`)}
  </select>`;
}
