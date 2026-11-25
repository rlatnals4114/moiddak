// 카카오 공유 카드 내용 단위 테스트: node tests/share.test.mjs
import assert from 'node:assert/strict';
import { shareCard, OG_IMAGE_PATH } from '../public/lib/kakaoShare.js';

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };
const origin = 'https://moiddak.hackathon-kit.workers.dev';

t('모임방 카드: “○○에 초대해요” + 모임방 참여하기 버튼, 링크는 받은 초대 주소 그대로', () => {
  const url = `${origin}/#/join?t=abc`;
  const c = shareCard({ kind: 'group', name: '우리 독서모임', url, origin });
  assert.equal(c.objectType, 'feed');
  assert.equal(c.content.title, '우리 독서모임에 초대해요');
  assert.equal(c.buttons[0].title, '모임방 참여하기');
  assert.equal(c.content.link.mobileWebUrl, url);
  assert.equal(c.buttons[0].link.webUrl, url);
  assert.equal(c.content.imageUrl, `${origin}${OG_IMAGE_PATH}`);
});
t('약속 카드: 확정 전 “날짜를 함께 정해요” / 확정 후 “함께해요” + 약속 참여하기', () => {
  assert.equal(shareCard({ kind: 'meeting', name: '12월 정기모임', url: 'u', origin }).content.title, '12월 정기모임, 날짜를 함께 정해요');
  const c = shareCard({ kind: 'meeting', name: '12월 정기모임', url: 'u', origin, confirmed: true });
  assert.equal(c.content.title, '12월 정기모임에 함께해요');
  assert.equal(c.buttons[0].title, '약속 참여하기');
});
t('카드에 들어가는 글자는 제목·고정 안내뿐(참가자·일정·관리자 링크 없음), 긴 이름은 잘림', () => {
  const c = shareCard({ kind: 'group', name: 'x'.repeat(200), url: 'u', origin });
  const all = JSON.stringify(c);
  assert.ok(!/admin=|invite=/.test(all));
  assert.ok(c.content.title.length <= 46);
  assert.deepEqual(Object.keys(c.content).sort(), ['description', 'imageHeight', 'imageUrl', 'imageWidth', 'link', 'title']);
});

console.log(`\n${pass}개 통과`);
