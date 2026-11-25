// .ics 생성 단위 테스트: node tests/ics.test.mjs
import assert from 'node:assert/strict';
import { buildIcs, icsDate, icsText, foldLine, icsFileName, googleCalendarUrl } from '../public/lib/ics.js';

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log(`PASS ${name}`); };
const base = { id: '6f1c2a90-0000-4000-8000-000000000001', title: '12월 정기모임', start: '2026-12-12T18:00:00+09:00', end: '2026-12-12T20:00:00+09:00', now: new Date('2026-11-08T03:00:00Z') };
const unfold = (s) => s.replace(/\r\n /g, '');

t('KST 18:00~20:00 → UTC 09:00~11:00 (Z), 다른 앱에서 같은 순간', () => {
  const s = buildIcs(base);
  assert.match(s, /DTSTART:20261212T090000Z\r\n/);
  assert.match(s, /DTEND:20261212T110000Z\r\n/);
  assert.match(s, /DTSTAMP:20261108T030000Z\r\n/);
});
t('자정·월말·연말 경계: KST 1/1 00:30 → UTC 12/31 15:30, 날짜 이동 정확', () => {
  const s = buildIcs({ ...base, start: '2027-01-01T00:30:00+09:00', end: '2027-01-01T02:00:00+09:00' });
  assert.match(s, /DTSTART:20261231T153000Z/);
  assert.match(s, /DTEND:20261231T170000Z/);
  assert.equal(icsDate('2026-11-30T23:59:00+09:00'), '20261130T145900Z');
});
t('CRLF 줄바꿈, VCALENDAR/VEVENT 구조, UID 고정(같은 약속 = 같은 UID)', () => {
  const s = buildIcs(base);
  assert.ok(s.endsWith('\r\n') && !/[^\r]\n/.test(s));
  for (const k of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR']) assert.ok(s.includes(k), k);
  const uid = (x) => x.match(/UID:(.*)\r\n/)[1];
  assert.equal(uid(s), uid(buildIcs({ ...base, start: '2026-12-13T18:00:00+09:00', end: '2026-12-13T19:00:00+09:00', sequence: 1 })));
});
t('이스케이프: 쉼표·세미콜론·백슬래시·줄바꿈', () => {
  assert.equal(icsText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const s = unfold(buildIcs({ ...base, title: '점심, 그리고; 카페\\2차', description: '1줄\n2줄' }));
  assert.ok(s.includes('SUMMARY:점심\\, 그리고\\; 카페\\\\2차'));
  assert.ok(s.includes('DESCRIPTION:1줄\\n2줄'));
});
t('긴 줄 접기: 모든 줄 75바이트 이하, 한글이 바이트 중간에서 안 잘림, 펼치면 원문', () => {
  const long = '아주 긴 약속 이름 '.repeat(20);
  const s = buildIcs({ ...base, title: long });
  const enc = new TextEncoder();
  s.split('\r\n').filter(Boolean).forEach((l) => assert.ok(enc.encode(l).length <= 75, l));
  assert.ok(unfold(s).includes(`SUMMARY:${long}`));
  assert.equal(foldLine('짧은 줄'), '짧은 줄');
});
t('장소 생략(LOCATION 없음)에도 유효, 장소 있으면 LOCATION', () => {
  assert.ok(!buildIcs(base).includes('LOCATION:'));
  assert.ok(buildIcs({ ...base, location: '시청역 2번 출구' }).includes('LOCATION:시청역 2번 출구'));
});
t('미확정(시작 없음)·끝 시각 없음·끝<=시작은 만들지 않음(임의 길이 금지)', () => {
  assert.throws(() => buildIcs({ ...base, start: null }));
  assert.throws(() => buildIcs({ ...base, end: null }), /끝 시각/);
  assert.throws(() => buildIcs({ ...base, end: base.start }));
});
t('비밀 토큰 없음: 약속 주소만, 초대·관리자 파라미터 없음 / 안전한 파일 이름', () => {
  const s = unfold(buildIcs({ ...base, url: 'https://moiddak.hackathon-kit.workers.dev/#/m/6f1c2a90-0000-4000-8000-000000000001', description: '모이딱 약속' }));
  assert.ok(!/invite=|admin=|join\?t=|token/i.test(s));
  assert.equal(icsFileName('../../etc/passwd<script>'), 'moiddak-etcpasswdscript.ics');
  assert.equal(icsFileName(base.id), `moiddak-${base.id}.ics`);
});
t('구글 캘린더 대안 주소: 같은 UTC 시각, 토큰 없음', () => {
  const u = googleCalendarUrl(base);
  assert.ok(u.startsWith('https://calendar.google.com/calendar/render?'));
  assert.ok(decodeURIComponent(u).includes('20261212T090000Z/20261212T110000Z'));
});

console.log(`\n${pass}개 통과`);
