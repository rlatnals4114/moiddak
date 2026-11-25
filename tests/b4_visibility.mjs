// 008 B4 약속 기본 비공개 테스트(실제 DB, 서로 다른 익명 세션, [테스트] 데이터): node tests/b4_visibility.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const results = [];
const check = (id, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` — ${detail}` : ''}`); };
async function signup() {
  const j = await (await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}' })).json();
  if (!j.access_token) throw new Error(JSON.stringify(j));
  return { token: j.access_token, uid: j.user.id };
}
const H = (s) => ({ apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` });
const rpc = async (s, fn, body = {}) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(s), body: JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };
const sel = async (s, q) => (await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H(s) })).json();
const future = (d, h) => { const x = new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10); return `${x}T${String(h).padStart(2, '0')}:00:00+09:00`; };

const [admin, inA, outB, late] = await Promise.all(Array.from({ length: 4 }, signup));
// 모임방: 관리자 + 참여 멤버(inA) + 미대상 멤버(outB)
const cg = await rpc(admin, 'create_group', { p_name: '[테스트] B4 비공개방', p_description: null, p_theme: 'cafe', p_names: ['관리'], p_my_index: 1 });
const G = cg.body.group_id;
const L = (await rpc(admin, 'create_group_join_link', { p_group_id: G, p_days: 30 })).body.token;
await rpc(inA, 'join_group_with_link', { p_token: L, p_display_name: '참여자' });
await rpc(outB, 'join_group_with_link', { p_token: L, p_display_name: '미대상' });
const ov = await rpc(admin, 'group_overview', { p_group_id: G });
const id = Object.fromEntries(ov.body.members.map((m) => [m.display_name, m.id]));
// 약속 1: 관리·참여자만 / 약속 2(확정 예정): 참여자만 + 주최는 관리자
const m1 = await rpc(admin, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] B4 비밀 약속', p_member_ids: [id['관리'], id['참여자']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: future(5, 19), ends_at: future(5, 21) }] });
const M1 = m1.body.meeting_id;
const opt = (await sel(admin, `time_options?meeting_id=eq.${M1}&select=id`))[0];
const ver = (await sel(admin, `meetings?id=eq.${M1}&select=version`))[0].version;
await rpc(admin, 'confirm_schedule', { p_meeting_id: M1, p_time_option_id: opt.id, p_expected_version: ver }); // 다가오는 약속

// 늦게 들어온 멤버(가입 전 약속)
await rpc(late, 'join_group_with_link', { p_token: L, p_display_name: '신규' });

const has = (r) => Array.isArray(r.body && r.body.meetings) && r.body.meetings.some((m) => m.id === M1);
const ovOut = await rpc(outB, 'group_overview', { p_group_id: G });
const ovLate = await rpc(late, 'group_overview', { p_group_id: G });
const ovIn = await rpc(inA, 'group_overview', { p_group_id: G });
const ovAdm = await rpc(admin, 'group_overview', { p_group_id: G });
check('B4-1', '미대상 멤버·가입 전 약속의 신규 멤버: 모임방 약속 목록에서 제외(제목도 없음)', ovOut.ok && !has(ovOut) && ovLate.ok && !has(ovLate) && !JSON.stringify(ovOut.body).includes('B4 비밀 약속'));

const mgOut = await rpc(outB, 'my_groups');
const card = (r) => (r.body || []).find((g) => g.id === G);
check('B4-2', '미대상 멤버의 모임방 카드: 다음 약속·진행 중 수에 그 약속 없음', mgOut.ok && card(mgOut) && card(mgOut).next === null && Number(card(mgOut).open_count) === 0);

const direct = await Promise.all([sel(outB, `meetings?id=eq.${M1}&select=id,title`), sel(outB, `participants?meeting_id=eq.${M1}&select=id`), sel(late, `meetings?id=eq.${M1}&select=id`)]);
const calOut = await rpc(outB, 'my_calendar', { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 30 * 864e5).toISOString() });
check('B4-3', '직접 URL/API(meetings·participants)·개인 캘린더에도 없음', direct.every((r) => Array.isArray(r) && r.length === 0) && Array.isArray(calOut.body) && !calOut.body.some((e) => e.id === M1));

const mgIn = await rpc(inA, 'my_groups');
check('B4-4', '참여 대상 멤버: 목록·카드(다음 약속)·상세 모두 보임', has(ovIn) && card(mgIn) && card(mgIn).next && card(mgIn).next.id === M1
  && (await sel(inA, `meetings?id=eq.${M1}&select=id`)).length === 1);

const admItem = ovAdm.body.meetings.find((m) => m.id === M1);
check('B4-5', '관리자(이 약속 주최자): 정상 표시', admItem && admItem.i_host === true && admItem.counts !== null);

// 관리자 예외: 다른 관리자가 만든, 내가 참여하지 않은 약속 → 제목·상태·일시만(admin_view), 상세 0행
const sub = await signup();
await rpc(sub, 'join_group_with_link', { p_token: L, p_display_name: '부관리' });
const ov2 = await rpc(admin, 'group_overview', { p_group_id: G });
const subId = ov2.body.members.find((m) => m.display_name === '부관리').id;
await rpc(admin, 'set_group_member_role', { p_member_id: subId, p_role: 'admin' });
const m2 = await rpc(sub, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] B4 부관리 약속', p_member_ids: [subId, id['참여자']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: future(8, 12), ends_at: future(8, 13) }] });
const ovAdm2 = await rpc(admin, 'group_overview', { p_group_id: G });
const a2 = ovAdm2.body.meetings.find((m) => m.id === m2.body.meeting_id);
const admDirect = await sel(admin, `participants?meeting_id=eq.${m2.body.meeting_id}&select=id`);
check('B4-6', '관리자 예외: 미참여 약속은 제목·상태·일시만(admin_view, counts 없음), 참여자·응답 상세 0행',
  m2.ok && a2 && a2.admin_view === true && a2.counts === null && a2.i_participate === false && admDirect.length === 0);

// B4-7 (012 실행 후에만 의미): 주소(ID)만 아는 미대상 멤버·외부인에게 제목 없음, 참여자에게는 제목
const stranger = await signup();
const pubOut = await rpc(outB, 'meeting_public_info', { p_meeting_id: M1 });
const pubStr = await rpc(stranger, 'meeting_public_info', { p_meeting_id: M1 });
const pubIn = await rpc(inA, 'meeting_public_info', { p_meeting_id: M1 });
if (process.env.EXPECT_012) {
  check('B4-7', '주소만 아는 미대상 멤버·외부인에게 약속 제목 없음(null), 참여자에게는 제목', pubOut.ok && pubOut.body === null && pubStr.body === null && pubIn.body && pubIn.body.title === '[테스트] B4 비밀 약속');
} else {
  console.log(`(참고) B4-7 은 012 실행 후 EXPECT_012=1 로 확인 — 지금 외부인 응답: ${JSON.stringify(pubStr.body)}`);
}

const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 테스트 모임방 ID ${G}`);
process.exit(pass === results.length ? 0 : 1);
