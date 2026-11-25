// 보안 점검(실제 DB, 서로 다른 익명 세션): node tests/security.mjs [배포 주소]
// - 외부인·비참여 멤버·일반 참여자가 남의 정보를 읽거나 바꾸지 못하는지
// - 비밀 토큰 테이블(private 스키마)이 API 로 노출되지 않는지
// - 화면 코드(배포 파일)에 관리자 키가 없는지
// 테스트 데이터 이름에는 [테스트] 를 붙인다. 기존 데이터는 읽기만 하고 지우지 않는다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const SITE = process.argv[2] || 'https://moiddak-dev.hackathon-kit.workers.dev';
const results = [];
const check = (id, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` — ${detail}` : ''}`); };
async function signup() {
  const j = await (await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}' })).json();
  if (!j.access_token) throw new Error(JSON.stringify(j));
  return { token: j.access_token, uid: j.user.id };
}
const H = (s, extra = {}) => ({ apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}), ...extra });
const rpc = async (s, fn, body = {}) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(s), body: JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };
const sel = async (s, q, extra) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H(s, extra) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };
const write = async (s, method, q, body) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { method, headers: H(s, { Prefer: 'return=representation' }), body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };
const future = (d, h) => { const x = new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10); return `${x}T${String(h).padStart(2, '0')}:00:00+09:00`; };
const empty = (r) => r.ok && Array.isArray(r.body) && r.body.length === 0;

const [host, member, outsider, bystander] = await Promise.all(Array.from({ length: 4 }, signup));

// 준비: 모임방(관리자 host, 멤버 member·bystander) + 약속(host·member 참여, bystander 미참여)
const cg = await rpc(host, 'create_group', { p_name: '[테스트] 보안 점검방', p_description: '비공개 설명', p_theme: 'night', p_names: ['호스트', '멤버', '구경꾼'], p_my_index: 1 });
if (!cg.ok) { console.log('준비 실패', JSON.stringify(cg.body)); process.exit(1); }
const G = cg.body.group_id;
const inv = Object.fromEntries(cg.body.invites.map((i) => [i.display_name, i]));
await rpc(member, 'accept_group_invite', { p_token: inv['멤버'].token });
await rpc(bystander, 'accept_group_invite', { p_token: inv['구경꾼'].token });
const ov = await rpc(host, 'group_overview', { p_group_id: G });
const mid = Object.fromEntries(ov.body.members.map((m) => [m.display_name, m.id]));
const gm = await rpc(host, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] 비밀 약속', p_member_ids: [mid['호스트'], mid['멤버']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: future(6, 19), ends_at: future(6, 21) }] });
const M = gm.body.meeting_id;
const opts = await sel(host, `time_options?meeting_id=eq.${M}&select=id`);
await rpc(member, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: opts.body.map((o) => o.id) });
await rpc(host, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'restaurant', p_name: '[테스트] 비밀 식당', p_map_url: null, p_place: null });

// S01 외부인(로그인됨) 읽기: 모든 공개 테이블에서 이 모임방·약속 행이 0개
const byMeeting = ['meetings?id', 'participants?meeting_id', 'time_options?meeting_id', 'schedule_submissions?meeting_id', 'availability_choices?meeting_id',
  'place_candidates?meeting_id', 'place_submissions?meeting_id', 'place_votes?meeting_id', 'final_places?meeting_id', 'schedule_survey_days?meeting_id',
  'grid_availability?meeting_id', 'itinerary_stops?meeting_id'];
const outReads = await Promise.all([...byMeeting.map((q) => sel(outsider, `${q}=eq.${M}&select=*`)),
  sel(outsider, `groups?id=eq.${G}&select=*`), sel(outsider, `group_members?group_id=eq.${G}&select=*`)]);
const leaked = outReads.map((r, i) => (empty(r) ? null : `${[...byMeeting, 'groups', 'group_members'][i]}:${r.status}`)).filter(Boolean);
check('S01', '외부인: 14개 테이블에서 남의 모임방·약속 0행', leaked.length === 0, leaked.join(', '));

// S02 로그인 없이(공개 키만) 읽기 → 0행 또는 거부
const anonReads = await Promise.all([sel(null, `meetings?id=eq.${M}&select=*`), sel(null, `groups?id=eq.${G}&select=*`), sel(null, `participants?meeting_id=eq.${M}&select=*`), sel(null, 'profiles?select=*&limit=5')]);
check('S02', '로그인 안 한 요청: 약속·모임방·참여자·프로필 0행 또는 거부', anonReads.every((r) => empty(r) || !r.ok), anonReads.map((r) => r.status).join('/'));

// S03 비밀 토큰 테이블은 API 로 안 보임
const priv = await Promise.all([sel(host, 'group_invites?select=*', { 'Accept-Profile': 'private' }), sel(host, 'participant_invites?select=*', { 'Accept-Profile': 'private' }),
  sel(host, 'admin_tokens?select=*', { 'Accept-Profile': 'private' }), sel(host, 'group_invites?select=*'), sel(host, 'admin_tokens?select=*')]);
check('S03', '초대·관리자 토큰 테이블(private): 만든 사람도 API 로 조회 불가', priv.every((r) => !r.ok), priv.map((r) => r.status).join('/'));

// S04 직접 쓰기 금지(모든 쓰기는 권한 확인 함수로만): 만든 사람조차 테이블을 직접 못 바꿈
const writes = await Promise.all([
  write(host, 'PATCH', `meetings?id=eq.${M}`, { title: '해킹' }),
  write(host, 'PATCH', `groups?id=eq.${G}`, { name: '해킹' }),
  write(outsider, 'POST', 'group_members', { group_id: G, display_name: '침입자', user_id: outsider.uid, role: 'admin' }),
  write(outsider, 'POST', 'participants', { meeting_id: M, display_name: '침입자', user_id: outsider.uid }),
  write(member, 'DELETE', `participants?meeting_id=eq.${M}`),
  write(member, 'PATCH', `group_members?group_id=eq.${G}`, { role: 'admin' }),
]);
const after = await rpc(host, 'group_overview', { p_group_id: G });
const meetAfter = await sel(host, `meetings?id=eq.${M}&select=title`);
const partsAfter = await sel(host, `participants?meeting_id=eq.${M}&select=id`);
check('S04', '테이블 직접 수정·추가·삭제 6가지 모두 거부, 데이터 그대로',
  writes.every((r) => !r.ok || (Array.isArray(r.body) && r.body.length === 0)) && meetAfter.body[0].title === '[테스트] 비밀 약속' && after.body.group.name === '[테스트] 보안 점검방'
    && partsAfter.body.length === 2 && after.body.members.filter((m) => m.role === 'admin').length === 1,
  writes.map((r) => r.status).join('/'));

// S05 외부인이 id 를 알아도 관리 기능 실행 불가
const outRpc = await Promise.all([
  rpc(outsider, 'group_overview', { p_group_id: G }),
  rpc(outsider, 'update_group', { p_group_id: G, p_name: '해킹', p_description: '', p_theme: 'cafe', p_expected_version: after.body.group.version }),
  rpc(outsider, 'add_group_members', { p_group_id: G, p_names: ['침입자'] }),
  rpc(outsider, 'remove_group_member', { p_member_id: mid['멤버'] }),
  rpc(outsider, 'reissue_group_invite', { p_member_id: mid['구경꾼'] }),
  rpc(outsider, 'create_group_meeting', { p_group_id: G, p_title: '침입', p_member_ids: [mid['호스트']], p_mode: 'poll', p_days: null, p_times: [{ starts_at: future(7, 10), ends_at: future(7, 11) }] }),
  rpc(outsider, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] }),
  rpc(outsider, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'cafe', p_name: '침입', p_map_url: null, p_place: null }),
  rpc(outsider, 'set_itinerary', { p_meeting_id: M, p_stops: [], p_skip: true }),
  rpc(outsider, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: 1 }),
]);
check('S05', '외부인: 모임방 요약·수정·멤버 추가/제외·초대 재발급·약속 생성·응답·장소 추가·방문 일정·확정 10가지 모두 거부',
  outRpc.every((r) => !r.ok), outRpc.map((r) => r.status).join('/'));

// S06 일반 멤버/참여자는 관리자·주최자 기능 불가
const memRpc = await Promise.all([
  rpc(member, 'update_group', { p_group_id: G, p_name: '해킹', p_description: '', p_theme: 'cafe', p_expected_version: after.body.group.version }),
  rpc(member, 'remove_group_member', { p_member_id: mid['호스트'] }),
  rpc(member, 'set_group_member_role', { p_member_id: mid['멤버'], p_role: 'admin' }),
  rpc(member, 'reissue_group_invite', { p_member_id: mid['구경꾼'] }),
  rpc(member, 'archive_group', { p_group_id: G, p_archived: true }),
  rpc(member, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: opts.body[0].id, p_expected_version: 1 }),
  rpc(member, 'set_itinerary', { p_meeting_id: M, p_stops: [], p_skip: true }),
  rpc(member, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: 1 }),
]);
check('S06', '일반 멤버: 모임방 수정·관리자 제외·스스로 관리자 승격·초대 재발급·보관·일정 확정·방문 일정·최종 확정 8가지 모두 거부',
  memRpc.every((r) => !r.ok), memRpc.map((r) => r.status).join('/'));

// S07 비참여 멤버(구경꾼): 제목·상태만, 상세·응답 0
const byOv = await rpc(bystander, 'group_overview', { p_group_id: G });
const byItem = byOv.body.meetings && byOv.body.meetings.find((m) => m.id === M);
const byReads = await Promise.all([sel(bystander, `participants?meeting_id=eq.${M}&select=*`), sel(bystander, `schedule_submissions?meeting_id=eq.${M}&select=*`), sel(bystander, `place_candidates?meeting_id=eq.${M}&select=*`)]);
const byCal = await rpc(bystander, 'my_calendar', { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 30 * 864e5).toISOString() });
check('S07', '참여 안 한 멤버: 약속이 목록에서 제외(008), 참여자·응답·장소 0행, 내 캘린더에 안 나옴',
  byOv.ok && !byItem && byReads.every(empty) && Array.isArray(byCal.body) && !byCal.body.some((e) => e.id === M));

// S08 초대 토큰 위조·추측 거부
const forged = await Promise.all([rpc(outsider, 'accept_group_invite', { p_token: 'a'.repeat(48) }), rpc(outsider, 'accept_invite', { p_token: 'b'.repeat(48) }),
  rpc(outsider, 'claim_admin', { p_token: 'c'.repeat(48) }), rpc(outsider, 'accept_group_invite', { p_token: inv['멤버'].token })]);
check('S08', '가짜 초대·가짜 관리자 토큰·이미 쓴 초대 토큰 모두 거부', forged.every((r) => !r.ok), forged.map((r) => r.status).join('/'));

// S09 공개 정보 함수는 이름·테마/제목만
const pubG = await rpc(outsider, 'group_public_info', { p_group_id: G });
const pubM = await rpc(outsider, 'meeting_public_info', { p_meeting_id: M });
check('S09', '초대 전 공개 정보: 모임방은 이름·테마만, 약속은 제목만(설명·멤버·일정 없음)',
  Object.keys(pubG.body || {}).sort().join() === 'name,theme' && (pubM.body === null || Object.keys(pubM.body || {}).join() === 'title')); // 012 후: 약속은 null

// S10 위험한 지도 링크 거부(지도 링크는 여러 지도 사이트를 쓰므로 http/https 만 허용하고 스크립트·HTML 끼워 넣기를 막는다)
const badLinks = await Promise.all(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://map.example.com/"><script>alert(1)</script>', 'vbscript:msgbox(1)'].map((u) =>
  rpc(host, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'cafe', p_name: '[테스트] 링크', p_map_url: u, p_place: null })));
const goodLink = await rpc(host, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'cafe', p_name: '[테스트] 정상 링크', p_map_url: 'https://map.kakao.com/link/map/123', p_place: null });
const srcFiles = ['screens/Places.js', 'screens/Final.js', 'ui/KakaoMap.js', 'screens/Meeting.js', 'screens/Schedule.js'].map((f) => { try { return readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8'); } catch { return ''; } }).join('\n');
const blankLinks = srcFiles.match(/target="_blank"[^>]*/g) || [];
check('S10', '장소 링크: javascript:·data:·vbscript:·HTML 끼워 넣기 거부, 정상 지도 링크 허용, 새 창 링크는 모두 noopener',
  badLinks.every((r) => !r.ok) && goodLink.ok && blankLinks.every((t) => /noopener/.test(t)), `${badLinks.map((r) => r.status).join('/')} 정상=${goodLink.status} 새창링크=${blankLinks.length}`);

// S11 화면 코드에 관리자 키·비밀값 없음(로컬 public/ 전체 + 배포된 config.js)
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|html|css|json)$/.test(f)) files.push(p); });
walk(new URL('../public', import.meta.url).pathname);
const bad = /sb_secret_[A-Za-z0-9]|SUPABASE_SECRET\w*\s*[:=]\s*["\x27]\S/; // 키 값 모양만 찾는다(경고 주석의 단어는 제외)
const hits = files.filter((f) => bad.test(readFileSync(f, 'utf8')));
const jwtRole = (txt) => (txt.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []).map((t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role; } catch { return null; } });
const deployed = await (await fetch(`${SITE}/config.js`)).text();
const roles = [...files.flatMap((f) => jwtRole(readFileSync(f, 'utf8'))), ...jwtRole(deployed)];
check('S11', `화면 코드(${files.length}개 파일)·배포 config.js 에 service_role/secret 키 없음`, hits.length === 0 && !bad.test(deployed) && roles.every((r) => r !== 'service_role'),
  hits.join(', '));

// S12 배포 응답 보안 헤더
const head = await fetch(`${SITE}/`);
const hv = (k) => head.headers.get(k) || '';
check('S12', '배포 주소 보안 헤더: nosniff · 다른 사이트 안에 넣기(iframe) 금지 · referrer 제한',
  hv('x-content-type-options') === 'nosniff' && /deny/i.test(hv('x-frame-options')) && /strict-origin|no-referrer/.test(hv('referrer-policy')),
  `nosniff=${hv('x-content-type-options')} frame=${hv('x-frame-options')} ref=${hv('referrer-policy')}`);

const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 대상 ${SITE} · 테스트 모임방 ID ${G}`);
process.exit(pass === results.length ? 0 : 1);
