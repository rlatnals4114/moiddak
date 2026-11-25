// 모이딱 인수 테스트: 실제 Supabase DB 에 서로 다른 익명 세션을 여러 개 만들어 API/RPC 를 직접 호출한다.
// 실행: node tests/acceptance.mjs   (키트 폴더의 .env 에서 URL·화면용 키를 읽는다. 값은 출력하지 않는다)
// 테스트 모임 제목에는 [테스트] 를 붙인다.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY;
const SITE = process.argv[2] || 'https://moiddak.hackathon-kit.workers.dev';

const results = [];
const check = (id, name, ok, detail = '') => { results.push({ id, name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` — ${detail}` : ''}`); };

async function signup() {
  const r = await fetch(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json();
  if (!j.access_token) throw new Error(`익명 세션 생성 실패: ${JSON.stringify(j)}`);
  return { token: j.access_token, uid: j.user.id };
}
const headers = (s) => ({ apikey: KEY, 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) });
async function rpc(s, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(s), body: JSON.stringify(args) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}
async function sel(s, table, query) {
  const r = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers: headers(s) });
  return { ok: r.ok, status: r.status, body: await r.json() };
}
async function write(s, method, table, body, query = '') {
  const r = await fetch(`${URL_}/rest/v1/${table}${query}`, { method, headers: { ...headers(s), Prefer: 'return=representation' }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, body: await r.text() };
}
const future = (days, h) => { const d = new Date(Date.now() + days * 86400000); return `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:00:00+09:00`; };

// ───────── 준비: 5명 모임 ─────────
const host = await signup();
const [sumin, hyunwoo, jiyeonA, jiyeonB, seoyeon, outsider] = await Promise.all(Array.from({ length: 6 }, signup));

const times = [
  { starts_at: future(3, 18), ends_at: future(3, 20) },
  { starts_at: future(4, 19), ends_at: null },
  { starts_at: future(5, 12), ends_at: future(5, 14) },
];
const created = await rpc(host, 'create_meeting', { p_title: '[테스트] 모이딱 인수 테스트', p_names: ['민지', '수민', '현우', '지연', '서연'], p_host_index: 1, p_times: times });
if (!created.ok) { console.error('모임 생성 실패', created.body); process.exit(1); }
const M = created.body.meeting_id;
const inv = Object.fromEntries(created.body.invites.map((i) => [i.display_name, i.token]));

// ───────── A01 ─────────
const acc1 = await rpc(sumin, 'accept_invite', { p_token: inv['수민'] });
await rpc(hyunwoo, 'accept_invite', { p_token: inv['현우'] });
await rpc(seoyeon, 'accept_invite', { p_token: inv['서연'] });
{
  const ps = await sel(sumin, 'participants', `meeting_id=eq.${M}&select=display_name&order=sort_order`);
  const ts = await sel(sumin, 'time_options', `meeting_id=eq.${M}&select=id,starts_at&order=sort_order`);
  check('A01', '5명·시간 3개 모임을 다른 세션에서 조회', acc1.ok && ps.body.map((p) => p.display_name).join() === '민지,수민,현우,지연,서연' && ts.body.length === 3,
    `참가자 ${ps.body.length}명, 시간 ${ts.body.length}개`);
}
const T = (await sel(host, 'time_options', `meeting_id=eq.${M}&select=id&order=sort_order`)).body.map((t) => t.id);

// ───────── A02 ─────────
await rpc(sumin, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[0], T[1]] });
await rpc(hyunwoo, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[1]] });
const none = await rpc(host, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] });
async function status() {
  const ps = (await sel(host, 'participants', `meeting_id=eq.${M}&select=id,display_name`)).body;
  const subs = (await sel(host, 'schedule_submissions', `meeting_id=eq.${M}&select=participant_id`)).body;
  const done = new Set(subs.map((s) => s.participant_id));
  return { done: ps.filter((p) => done.has(p.id)).map((p) => p.display_name).sort(), pending: ps.filter((p) => !done.has(p.id)).map((p) => p.display_name).sort(), ps };
}
{
  const s = await status();
  check('A02', '3/5 응답, 미응답 지연·서연, 모두 불가(민지)도 완료', none.ok && s.done.length === 3 && s.pending.join() === '서연,지연' && s.done.includes('민지'),
    `완료 ${s.done.join(',')} / 미응답 ${s.pending.join(',')}`);
}

// ───────── A03 ─────────
await Promise.all([
  rpc(sumin, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[2]] }),
  rpc(sumin, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[2]] }),
  rpc(sumin, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[2], T[2]] }),
]);
{
  const s = await status();
  const sid = s.ps.find((p) => p.display_name === '수민').id;
  const mine = (await sel(host, 'availability_choices', `meeting_id=eq.${M}&participant_id=eq.${sid}&select=time_option_id`)).body;
  const subs = (await sel(host, 'schedule_submissions', `meeting_id=eq.${M}&participant_id=eq.${sid}&select=participant_id`)).body;
  check('A03', '수정·중복 클릭 후 최신 선택만, 중복 없음', mine.length === 1 && mine[0].time_option_id === T[2] && subs.length === 1, `수민 선택 ${mine.length}개`);
}

// ───────── A05 ─────────
{
  const ch = (await sel(host, 'availability_choices', `meeting_id=eq.${M}&select=time_option_id`)).body;
  const counts = T.map((t) => ch.filter((c) => c.time_option_id === t).length);
  const max = Math.max(...counts);
  const m = (await sel(host, 'meetings', `id=eq.${M}&select=status`)).body[0];
  check('A05', '동률 집계(시간2·시간3 각 1명), 자동 확정 없음', counts.join() === '0,1,1' && counts.filter((c) => c === max).length === 2 && m.status === 'schedule_open', `집계 ${counts.join('/')}`);
}

// ───────── A10 ─────────
{
  const s = await status();
  const hid = s.ps.find((p) => p.display_name === '현우').id;
  const tries = await Promise.all([
    rpc(sumin, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: T[1], p_expected_version: 1 }),
    write(sumin, 'POST', 'availability_choices', { meeting_id: M, participant_id: hid, time_option_id: T[0] }),
    write(sumin, 'DELETE', 'availability_choices', null, `?meeting_id=eq.${M}&participant_id=eq.${hid}`),
    write(sumin, 'PATCH', 'participants', { user_id: sumin.uid }, `?id=eq.${hid}`),
    write(sumin, 'PATCH', 'meetings', { status: 'finalized' }, `?id=eq.${M}`),
    rpc(sumin, 'reissue_invite', { p_participant_id: hid }),
  ]);
  const hChoices = (await sel(host, 'availability_choices', `meeting_id=eq.${M}&participant_id=eq.${hid}&select=time_option_id`)).body;
  const m = (await sel(host, 'meetings', `id=eq.${M}&select=status`)).body[0];
  check('A10', '참가자가 남의 응답 수정·확정·재발급 시도 → 거부, 데이터 유지',
    tries.every((t) => !t.ok) && hChoices.length === 1 && hChoices[0].time_option_id === T[1] && m.status === 'schedule_open',
    tries.map((t) => t.status).join(','));
}

// ───────── A11 ─────────
{
  const reads = await Promise.all(['participants', 'time_options', 'schedule_submissions', 'availability_choices']
    .map((t) => sel(outsider, t, `meeting_id=eq.${M}&select=*`)));
  const meet = await sel(outsider, 'meetings', `id=eq.${M}&select=*`);
  const anonRead = await sel(null, 'participants', `meeting_id=eq.${M}&select=*`);
  const w1 = await rpc(outsider, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[0]] });
  const w2 = await rpc(outsider, 'add_place_candidate', { p_meeting_id: M, p_kind: 'cafe', p_name: '침입', p_map_url: null });
  const w3 = await rpc(null, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] });
  const info = await rpc(outsider, 'meeting_public_info', { p_meeting_id: M });
  const leaked = reads.some((r) => r.ok && r.body.length) || (meet.ok && meet.body.length) || (anonRead.ok && anonRead.body.length);
  check('A11', '다른 사용자·미인증 조회/쓰기 거부, 공개 정보는 제목만',
    !leaked && !w1.ok && !w2.ok && !w3.ok && (info.body === null || Object.keys(info.body || {}).join() === 'title'), // 012 후에는 null
    `미인증 조회 ${anonRead.status}, 공개정보 키 ${Object.keys(info.body || {}).join()}`);
}

// ───────── A12 ─────────
{
  const both = await Promise.all([
    rpc(jiyeonA, 'accept_invite', { p_token: inv['지연'] }),
    rpc(jiyeonB, 'accept_invite', { p_token: inv['지연'] }),
  ]);
  const wins = both.filter((r) => r.ok).length;
  const third = await rpc(outsider, 'accept_invite', { p_token: inv['지연'] });
  const bogus = await rpc(outsider, 'accept_invite', { p_token: 'deadbeef' });
  const s = await status();
  const jid = s.ps.find((p) => p.display_name === '지연').id;
  const re = await rpc(host, 'reissue_invite', { p_participant_id: jid });
  const oldAgain = await rpc(jiyeonB, 'accept_invite', { p_token: inv['지연'] });
  const newOk = await rpc(jiyeonB, 'accept_invite', { p_token: re.body.token });
  const otherName = await rpc(jiyeonB, 'accept_invite', { p_token: inv['서연'] });
  check('A12', '동시 수락 1번만 성공, 소모·잘못된·폐기된 토큰 거부, 재발급 링크 성공',
    wins === 1 && !third.ok && !bogus.ok && re.ok && !oldAgain.ok && newOk.ok && !otherName.ok,
    `동시 성공 ${wins}회 · 만료 시나리오는 DB 시간 조작이 필요해 미실행`);
}

// ───────── A14 + A06 ─────────
{
  const jRes = await Promise.all([
    rpc(jiyeonB, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[1]] }),
    rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: T[1], p_expected_version: 1 }),
  ]);
  const m = (await sel(host, 'meetings', `id=eq.${M}&select=status,selected_time_option_id,updated_at,version`)).body[0];
  const subs = (await sel(host, 'schedule_submissions', `meeting_id=eq.${M}&select=updated_at`)).body;
  const after = subs.filter((x) => new Date(x.updated_at) > new Date(m.updated_at)).length;
  check('A14', '확정과 제출 동시 요청 → 확정 이후 변경 없음', jRes[1].ok && after === 0, `동시 제출 ${jRes[0].ok ? '확정 전에 반영' : '거부'}`);

  const late = await rpc(seoyeon, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [T[0]] });
  const stale = await rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: T[0], p_expected_version: 1 });
  check('A06', '일정 확정 저장, 이후 일정 제출·재확정 API 거부',
    m.status === 'place_open' && m.selected_time_option_id === T[1] && !late.ok && !stale.ok, late.body?.message || '');
}

// ───────── A07 ─────────
const other = await rpc(host, 'create_meeting', { p_title: '[테스트] 다른 모임', p_names: ['가', '나'], p_host_index: 1, p_times: [{ starts_at: future(6, 18) }] });
const otherCand = await rpc(host, 'add_place_candidate', { p_meeting_id: other.body.meeting_id, p_kind: 'restaurant', p_name: '남의 식당', p_map_url: null });
{
  const r1 = await rpc(sumin, 'add_place_candidate', { p_meeting_id: M, p_kind: 'restaurant', p_name: '성수 파스타', p_map_url: 'https://naver.me/abc' });
  const r2 = await rpc(hyunwoo, 'add_place_candidate', { p_meeting_id: M, p_kind: 'restaurant', p_name: '뚝섬 국밥', p_map_url: null });
  const c1 = await rpc(host, 'add_place_candidate', { p_meeting_id: M, p_kind: 'cafe', p_name: '서울숲 카페', p_map_url: 'https://map.kakao.com/x' });
  const xss = await rpc(sumin, 'add_place_candidate', { p_meeting_id: M, p_kind: 'cafe', p_name: '위험 링크', p_map_url: 'javascript:alert(1)' });
  const v1 = await rpc(sumin, 'submit_place', { p_meeting_id: M, p_kind: 'restaurant', p_candidate_id: r1.body });
  const v2 = await rpc(hyunwoo, 'submit_place', { p_meeting_id: M, p_kind: 'restaurant', p_candidate_id: r2.body });
  const v3 = await rpc(host, 'submit_place', { p_meeting_id: M, p_kind: 'restaurant', p_candidate_id: null });
  const v4 = await rpc(sumin, 'submit_place', { p_meeting_id: M, p_kind: 'cafe', p_candidate_id: c1.body });
  const cross = await rpc(seoyeon, 'submit_place', { p_meeting_id: M, p_kind: 'restaurant', p_candidate_id: otherCand.body });
  const wrongKind = await rpc(seoyeon, 'submit_place', { p_meeting_id: M, p_kind: 'cafe', p_candidate_id: r1.body });
  const lockedAdd = await rpc(seoyeon, 'add_place_candidate', { p_meeting_id: M, p_kind: 'restaurant', p_name: '늦은 후보', p_map_url: null });
  const lockedDel = await rpc(host, 'delete_place_candidate', { p_candidate_id: r2.body });
  const subs = (await sel(host, 'place_submissions', `meeting_id=eq.${M}&select=kind`)).body;
  const votes = (await sel(host, 'place_votes', `meeting_id=eq.${M}&select=kind,candidate_id`)).body;
  const restDone = subs.filter((x) => x.kind === 'restaurant').length;
  const restVotes = votes.filter((x) => x.kind === 'restaurant').length;
  check('A07', '식당·카페 후보·선호/선호없음 집계, 타 모임·다른 분류 후보 거부, 투표 시작 후 잠금',
    [r1, r2, c1, v1, v2, v3, v4].every((x) => x.ok) && !xss.ok && !cross.ok && !wrongKind.ok && !lockedAdd.ok && !lockedDel.ok
      && restDone === 3 && restVotes === 2 && subs.filter((x) => x.kind === 'cafe').length === 1,
    `식당 응답 ${restDone}명(투표 ${restVotes}, 선호없음 1) · 카페 응답 1명`);
  globalThis.R1 = r1.body; globalThis.C1 = c1.body;
}

// ───────── A08 ─────────
{
  const m = (await sel(host, 'meetings', `id=eq.${M}&select=version`)).body[0];
  const noRest = await rpc(host, 'finalize_meeting', { p_meeting_id: M, p_restaurant_id: null, p_cafe_id: null, p_expected_version: m.version });
  const notOwner = await rpc(sumin, 'finalize_meeting', { p_meeting_id: M, p_restaurant_id: R1, p_cafe_id: null, p_expected_version: m.version });
  const cafeAsRest = await rpc(host, 'finalize_meeting', { p_meeting_id: M, p_restaurant_id: C1, p_cafe_id: null, p_expected_version: m.version });
  const fin = await rpc(host, 'finalize_meeting', { p_meeting_id: M, p_restaurant_id: R1, p_cafe_id: null, p_expected_version: m.version });
  const lateVote = await rpc(seoyeon, 'submit_place', { p_meeting_id: M, p_kind: 'restaurant', p_candidate_id: R1 });
  const lateAdd = await rpc(seoyeon, 'add_place_candidate', { p_meeting_id: M, p_kind: 'cafe', p_name: '늦은 카페', p_map_url: null });
  const fp = (await sel(host, 'final_places', `meeting_id=eq.${M}&select=kind,candidate_id`)).body;
  check('A08', '식당 필수 검증, 주최자만, 카페 생략 확정, 이후 투표·후보 잠금',
    !noRest.ok && !notOwner.ok && !cafeAsRest.ok && fin.ok && !lateVote.ok && !lateAdd.ok && fp.length === 1 && fp[0].candidate_id === R1);
}

// ───────── A09 ─────────
{
  const m = (await sel(seoyeon, 'meetings', `id=eq.${M}&select=status,selected_time_option_id`)).body[0];
  const fp = (await sel(seoyeon, 'final_places', `meeting_id=eq.${M}&select=kind`)).body;
  check('A09', '다른 세션 재조회에 최신 확정 반영', m.status === 'finalized' && m.selected_time_option_id === T[1] && fp.length === 1);
}

// ───────── A15 / A16 (배포 파일) ─────────
{
  // 없는 경로도 index.html 로 200 이 오므로(SPA), 파일 종류(content-type)까지 확인한다.
  const want = ['', 'app.js', 'config.js', 'styles/tokens.css', 'styles/app.css', 'lib/deps.js', 'lib/sb.js', 'lib/errors.js',
    'lib/schedule.js', 'lib/time.js', 'lib/util.js', 'ui/Calendar.js', 'ui/TimeGrid.js', 'ui/KakaoMap.js', 'ui/Avatar.js', 'ui/common.js', 'ui/Pixel.js', 'assets/characters/index.js', 'lib/me.js', 'screens/Profile.js',
    'screens/Home.js', 'screens/Create.js', 'screens/Meeting.js', 'screens/Schedule.js', 'screens/Places.js', 'screens/Host.js', 'screens/Final.js'];
  const files = await Promise.all(want.map(async (f) => {
    const r = await fetch(`${SITE}/${f}`);
    return { f, status: r.status, type: r.headers.get('content-type') || '', text: await r.text() };
  }));
  const typeOk = (x) => (x.f === '' ? /html/.test(x.type) : x.f.endsWith('.css') ? /css/.test(x.type) : /javascript/.test(x.type));
  const bad = files.filter((x) => x.status !== 200 || !typeOk(x));
  const deep = await fetch(`${SITE}/m/does-not-exist`);
  check('A15', `배포 주소의 화면·모듈 ${files.length}개 응답과 파일 종류 (모바일 실제 조작은 별도)`, bad.length === 0 && deep.status === 200,
    bad.length ? `문제: ${bad.map((x) => `${x.f} ${x.status} ${x.type}`).join(', ')}` : '');
  // 실제 키 모양만 찾는다: 새 secret 키(sb_secret_…) 또는 role 이 service_role 인 JWT
  const jwtRoles = files.flatMap((x) => x.text.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || [])
    .map((t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).role; } catch { return null; } });
  const leaked = files.some((x) => /sb_secret_[\w-]{8,}/.test(x.text)) || jwtRoles.includes('service_role');
  check('A16', '브라우저 파일에 비밀 키 없음, javascript: 링크 거부(A07)', !leaked);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과 · 테스트 모임 ID ${M}`);
process.exit(failed.length ? 1 : 0);
