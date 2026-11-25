// 확정 약속 → iCalendar(.ics, RFC 5545) 파일 내용(순수 함수). 화면: ui/AddToCalendar.js
// - DTSTART/DTEND 는 DB 에 저장된 확정 시각(절대 시각)을 UTC(…Z)로 적는다 → 어느 캘린더 앱에서도 같은 순간(한국 시간으로 보면 화면과 같은 시각).
// - 끝 시각이 없으면 만들지 않는다(임의 길이 금지) → 호출하는 쪽이 사용자에게 끝 시각을 고르게 한 뒤 end 로 넘긴다.
// - UID 는 약속마다 고정(같은 약속을 다시 내려받으면 같은 UID), SEQUENCE 는 확정 회차(일정이 바뀌면 증가). 자동 갱신은 앱마다 다르다.
// - 비밀 링크(초대 토큰·관리자 링크)는 넣지 않는다. DESCRIPTION 의 주소는 토큰 없는 약속 주소만.

const pad = (n) => String(n).padStart(2, '0');
export function icsDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('잘못된 시각');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// TEXT 값 이스케이프(RFC 5545 3.3.11): \ ; , 줄바꿈
export const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

// 줄 접기(3.1): 한 줄 75 옥텟(UTF-8 바이트) 이하, 이어지는 줄은 공백 하나로 시작. 한글(3바이트)이 중간에 잘리지 않게 문자 단위로 자른다.
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

// meeting: { id, title, start, end, location?, description?, url?, sequence? } → .ics 문자열(CRLF)
export function buildIcs({ id, title, start, end, location = '', description = '', url = '', sequence = 0, now = new Date() }) {
  if (!id || !start) throw new Error('확정된 시작 시각이 없어요.');
  if (!end) throw new Error('끝 시각이 필요해요.');
  if (Date.parse(end) <= Date.parse(start)) throw new Error('끝 시각은 시작보다 늦어야 해요.');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MOIDDAK//Moiddak 2.0//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:moiddak-${id}@moiddak.hackathon-kit.workers.dev`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SEQUENCE:${Math.max(0, Number(sequence) || 0)}`,
    `SUMMARY:${icsText(title || '모이딱 약속')}`,
    location && `LOCATION:${icsText(location)}`,
    description && `DESCRIPTION:${icsText(description)}`,
    url && `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// 안전한 파일 이름(약속 id 만 사용)
export const icsFileName = (id) => `moiddak-${String(id).replace(/[^0-9a-zA-Z-]/g, '').slice(0, 64) || 'meeting'}.ics`;

// 구글 캘린더 '일정 추가' 주소(파일을 열 수 없는 브라우저용 대안). 비밀 토큰 없음.
export function googleCalendarUrl({ title, start, end, location = '', description = '' }) {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title || '모이딱 약속', dates: `${icsDate(start)}/${icsDate(end)}`, details: description, location });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
