// 카카오톡 공유(Kakao JavaScript SDK 2.8.4, Kakao.Share.sendDefault 피드 메시지).
// 공식 문서 기준 필요한 설정(개발자 콘솔): ① JavaScript 키 ② [JavaScript SDK 도메인]에 이 사이트 주소(지도와 같은 설정)
//   ③ [제품 링크 관리 > 웹 도메인]에 메시지 링크 도메인 — 없으면 카드는 가도 링크가 열리지 않거나 4002 오류.
// 실패하면(키 없음·SDK 로드 실패·도메인 미등록·PC 등) 호출한 쪽이 다른 공유/복사로 대신한다.
// 카드에는 받는 사람에게 보여도 되는 정보만 넣는다: 모임방 이름/약속 제목, 짧은 안내, 공통 이미지, 초대 링크. (참가자 이름·일정·관리자 링크 없음)
import { KAKAO_JS_KEY } from '../config.js';

const SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js';
// SRI: 2026-11-08 공식 CDN 파일을 내려받아 계산한 sha384(파일이 바뀌면 로드가 막혀 안전하게 실패 → 복사로 대체)
const SDK_INTEGRITY = 'sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w';
export const OG_IMAGE_PATH = '/assets/og/moiddak-og.png';

let loading = null;
export function loadKakaoShare() {
  if (!KAKAO_JS_KEY) return Promise.reject(new Error('no-key'));
  if (window.Kakao && window.Kakao.init) return Promise.resolve(init(window.Kakao));
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL; s.integrity = SDK_INTEGRITY; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => { try { resolve(init(window.Kakao)); } catch (e) { reject(e); } };
      s.onerror = () => reject(new Error('sdk-load'));
      setTimeout(() => reject(new Error('sdk-timeout')), 10000);
      document.head.appendChild(s);
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}
// v2 SDK 는 init 을 부른 뒤에 Share 모듈이 붙는다
function init(Kakao) {
  if (!Kakao || !Kakao.init) throw new Error('sdk-missing');
  if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
  if (!Kakao.Share) throw new Error('share-missing');
  return Kakao;
}

// 피드 카드 내용(순수 함수 — 테스트용). kind: 'group' | 'meeting'
export function shareCard({ kind, name, url, origin, confirmed = false }) {
  const safe = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const title = kind === 'group' ? `${safe(name, 40)}에 초대해요` : confirmed ? `${safe(name, 60)}에 함께해요` : `${safe(name, 60)}, 날짜를 함께 정해요`;
  return {
    objectType: 'feed',
    content: {
      title,
      description: '모이딱에서 링크를 열고 이름을 쓴 뒤 ‘참여하기’를 눌러 주세요.',
      imageUrl: `${origin}${OG_IMAGE_PATH}`,
      imageWidth: 1200, imageHeight: 630,
      link: { mobileWebUrl: url, webUrl: url },
    },
    buttons: [{ title: kind === 'group' ? '모임방 참여하기' : '약속 참여하기', link: { mobileWebUrl: url, webUrl: url } }],
  };
}

// 성공: 'sent' (카카오톡 공유 창을 띄움 — 실제 전송·취소 여부는 SDK 가 알려 주지 않음) / 실패: Error
export async function shareToKakao(card) {
  const Kakao = await loadKakaoShare();
  Kakao.Share.sendDefault(card);
  return 'sent';
}
