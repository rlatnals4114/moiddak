// 도트 캐릭터 에셋 목록. 기본 4종(민트·핑크·블루·옐로우) — 아래 코드로 그린 12×16 도트를 사용한다.
// (픽셀 키트 v1.1 의 24×32 PNG 는 design/pixel-kit-v1.1/app-export 에 보관하고 앱에서는 쓰지 않는다.)
// 이미지로 바꾸고 싶으면 IMAGE_OVERRIDES 에 { type: '경로' } 를 넣으면 된다.
export const IMAGE_OVERRIDES = {};

// 공통 몸통·얼굴. K 외곽선 · S 피부 · E 눈 · M 볼 · T/t 상의 · P 하의 · B 신발
const FACE = [
  '.KSSSSSSSSK.',
  '.KSESSSSESK.',
  '.KSMSSSSMSK.',
  '..KSSSSSSK..',
];
const BODY = [
  '...KKTTKK...',
  '..KTTTTTTK..',
  '.KTTTtTTTTK.',
  '.KSTTTTTTSK.',
  '..KPPPPPPK..',
  '..KPPKKPPK..',
  '..KBBK.KBBK.',
];

const BASE = { K: '#2A2540', S: '#FFDDC1', E: '#242338', M: '#FF9E8A', B: '#242338', W: '#FFFFFF' };

export const CHARACTER_TYPES = {
  mint: {
    label: '민트', note: '활발한 타입',
    head: ['...H.HH.H...', '..HHHHHHHH..', '.KHHHHHHHHK.', '.KHHhHHhHHK.', '.KHSSSSSSHK.'],
    colors: { H: '#2FB5A2', h: '#1E8A7A', T: '#3B55E8', t: '#2C41B8', P: '#242338' },
  },
  pink: {
    label: '핑크', note: '사랑스러운 타입',
    head: ['RRK.KKKK.KRR', 'RKHKHHHHKHKR', 'KHHHHHHHHHHK', 'KHHhHHHHhHHK', 'KHHSSSSSSHHK'],
    colors: { H: '#F58BB0', h: '#D9668F', R: '#FF4F7A', T: '#FFD6E5', t: '#F5B3CB', P: '#6B6BD6' },
  },
  blue: {
    label: '블루', note: '차분한 타입',
    head: ['...KKKKKK...', '..KCCCCCCK..', '.KCCCWCCCCK.', '.KcccccccccK', '.KHSSSSSSHK.'],
    colors: { C: '#3B55E8', c: '#2C41B8', H: '#4A3A33', T: '#3A3955', t: '#242338', P: '#5C7CFA' },
  },
  yellow: {
    label: '옐로우', note: '귀여운 타입',
    head: ['...KKKKKK...', '..KYYYYYYK..', '.KYYYYYYYYK.', '.KYHHHHHHYK.', '.KYSSSSSSYK.'],
    colors: { Y: '#FFCF3D', H: '#7A4E2D', T: '#FFCF3D', t: '#E5B21F', P: '#3B55E8' },
  },
};
export const TYPE_KEYS = Object.keys(CHARACTER_TYPES);

export function spriteOf(type) {
  const t = CHARACTER_TYPES[type] || CHARACTER_TYPES.mint;
  return { rows: [...t.head, ...FACE, ...BODY], colors: { ...BASE, ...t.colors } };
}

// 캐릭터 결정 순서: ① 본인이 고른 캐릭터(avatar.base, 프로필에서 저장 → 참가자 행에 복사)
// ② 모임 안 참가 순서로 4종을 돌아가며 배정(4명까지 서로 다름) ③ 이름으로 정함.
// avatar 는 { v:1, base, hair, skin, face, top, bottom, accessory } 로 확장한다(지금은 base 만 사용).
export function typeOf(person) {
  const base = person && person.avatar && person.avatar.base;
  if (base && CHARACTER_TYPES[base]) return base;
  if (person && Number.isInteger(person.sort_order)) return TYPE_KEYS[(person.sort_order - 1 + TYPE_KEYS.length) % TYPE_KEYS.length];
  const s = [...String(person ? person.display_name : '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return TYPE_KEYS[s % TYPE_KEYS.length];
}
