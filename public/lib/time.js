// 시각은 UTC 로 저장하고, 화면에는 모임 시간대(KST, 일광절약시간 없음)로 보여 준다.
// '날짜 키'는 KST 기준 'YYYY-MM-DD' 문자열이다.
export const TZ = 'Asia/Seoul';
export const SLOT = 30;
export const pad = (n) => String(n).padStart(2, '0');

const fmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export const parts = (iso) => Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));

export const dayKey = (iso) => { const p = parts(iso); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
export const todayKey = () => dayKey(new Date().toISOString());
export const midnight = (day) => Date.parse(`${day}T00:00:00+09:00`);
export const kstISO = (day, minute) => new Date(midnight(day) + minute * 60000).toISOString();
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const weekday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();
const WD = ['일', '월', '화', '수', '목', '금', '토'];

export const minuteLabel = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const dayLabel = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${WD[weekday(day)]})`;
export const dayLabelLong = (day) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일(${WD[weekday(day)]})`;
export const fmtTime = (iso) => { const p = parts(iso); return `${p.hour}:${p.minute}`; };
export const fmtStart = (iso) => `${dayLabel(dayKey(iso))} ${fmtTime(iso)}`;

// '11/14(토) 18:00~20:00'. 끝이 그날 24:00 이면 '~24:00' 으로 쓴다.
export function fmtRange(start, end) {
  if (!end) return fmtStart(start);
  const d = dayKey(start);
  const endMin = (Date.parse(end) - midnight(d)) / 60000;
  const tail = dayKey(end) === d ? fmtTime(end) : endMin === 1440 ? '24:00' : fmtStart(end);
  return `${fmtStart(start)}~${tail}`;
}

// '11월 16일(월) 18:00~20:00' (확정 일시 강조용, 한국 시간)
export function fmtRangeLong(start, end) {
  const d = dayKey(start);
  if (!end) return `${dayLabelLong(d)} ${fmtTime(start)}`;
  const endMin = (Date.parse(end) - midnight(d)) / 60000;
  const tail = dayKey(end) === d ? fmtTime(end) : endMin === 1440 ? '24:00' : `${dayLabelLong(dayKey(end))} ${fmtTime(end)}`;
  return `${dayLabelLong(d)} ${fmtTime(start)}~${tail}`;
}

// 확정 일정까지 남은 날(KST 날짜 기준): 'D-3' · 'D-DAY' · '지난 약속'
export function dDay(iso) {
  const diff = Math.round((midnight(dayKey(iso)) - midnight(todayKey())) / 86400000);
  if (diff > 0) return `D-${diff}`;
  return diff === 0 ? 'D-DAY' : '지난 약속';
}

// 0:00 ~ 24:00 을 30분 간격으로
export const STEPS = Array.from({ length: 49 }, (_, i) => i * SLOT);

// 정렬된 분 목록 → 연속 구간 [{start, end}]
export function toRanges(minutes, slot = SLOT) {
  const out = [];
  for (const m of [...minutes].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last.end === m) last.end = m + slot; else out.push({ start: m, end: m + slot });
  }
  return out;
}
