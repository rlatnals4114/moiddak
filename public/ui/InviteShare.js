// 초대 링크 공유 버튼 묶음(모임방 초대 · 약속 초대 공통).
// 순서: 카카오톡으로 공유(카드) → 초대 링크 복사 → (지원 기기만) 다른 앱으로 공유.
// 카카오 공유가 안 되면 다른 앱 공유 → 복사로 대신하고, 이유를 짧게 알려 준다. 공유 창을 닫는 건 실패가 아니다.
import { html, useState } from '../lib/deps.js';
import { copyText, shareOrCopy, toast } from '../lib/util.js';
import { shareToKakao, shareCard } from '../lib/kakaoShare.js';
import { PixelIcon } from './Pixel.js';

export function InviteShare({ kind, name, url, confirmed = false, label = '초대 링크' }) {
  const [busy, setBusy] = useState(false);
  const text = kind === 'group'
    ? `[${name}] 모이딱 모임방 초대예요. 링크를 열고 ‘참여하기’를 눌러 주세요.`
    : `[${name}] 모이딱 약속이에요. 링크를 열고 이름을 쓴 뒤 ‘참여하기’를 눌러 주세요.`;
  async function kakao() {
    if (busy) return;
    setBusy(true);
    try {
      await shareToKakao(shareCard({ kind, name, url, origin: location.origin, confirmed }));
    } catch (e) {
      // 키 없음·SDK 로드 실패·도메인 미등록 등 → 대신 공유/복사
      const r = await shareOrCopy({ title: name, text, url }, `카카오톡 공유를 쓸 수 없어 ${label}를 복사했어요. 카카오톡에 붙여 넣어 주세요.`);
      if (r === 'shared') toast('공유했어요.');
    } finally { setBusy(false); }
  }
  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  return html`<div class="invite-share">
    <button type="button" class="btn kakao block" disabled=${busy} onClick=${kakao}><${PixelIcon} name="chat" size=${16} /> 카카오톡으로 공유</button>
    <div class="btn-row">
      <button type="button" class="btn ghost grow" onClick=${() => copyText(`${text}\n${url}`, '링크를 복사했어요.')}>${label} 복사</button>
      ${canShare && html`<button type="button" class="btn ghost grow" onClick=${async () => { if ((await shareOrCopy({ title: name, text, url }, '링크를 복사했어요.')) === 'shared') toast('공유했어요.'); }}>다른 앱으로 공유</button>`}
    </div>
  </div>`;
}
