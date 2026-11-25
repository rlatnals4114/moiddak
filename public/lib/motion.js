// 배너 캐릭터 움직임 규칙(순수 함수). 화면 그리기는 ui/ThemeScene.js.
// - 캐릭터마다 겹치지 않는 '레인'(배너 가로를 n등분한 구간)을 주고, 그 안에서만 걷는다 → 서로 지나치게 겹치거나 밖으로 나가지 않는다.
// - 위치 단위는 배너 너비의 %(캐릭터 가운데 기준).

export const MAX_ACTORS = 8;

export function lanes(n, edge = 6) {
  const count = Math.max(1, Math.min(n, MAX_ACTORS));
  const w = (100 - edge * 2) / count;
  return Array.from({ length: count }, (_, i) => {
    const start = edge + i * w;
    const pad = Math.min(w * 0.2, 4);
    return { min: start + pad, max: start + w - pad, home: start + w / 2 };
  });
}

// 다음 행동: 대기(가장 자주) · 걷기 · 짧게 뛰기
export function pickAction(r) {
  if (r < 0.5) return 'idle';
  if (r < 0.85) return 'walk';
  return 'jump';
}

export const pickTarget = (lane, r) => lane.min + (lane.max - lane.min) * r;
export const clampToLane = (lane, x) => Math.min(lane.max, Math.max(lane.min, x));

// 걷는 시간: 거리 비례(너무 빠르거나 느리지 않게)
export const walkMs = (from, to) => Math.round(Math.min(3200, Math.max(700, Math.abs(to - from) * 160)));

// 다음 행동까지 기다리는 시간(ms)
export const restMs = (r) => Math.round(1800 + r * 3200);
