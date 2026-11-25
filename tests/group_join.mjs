// 007 공용 초대 링크 테스트(실제 DB, 서로 다른 익명 세션): node tests/group_join.mjs
// ⚠️ 007 SQL 을 실행한 뒤에만 의미가 있다. 실행 전이면 J00 에서 멈춘다. 테스트 데이터 이름에는 [테스트] 를 붙인다.
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
const H = (s) => ({ apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) });
const rpc = async (s, fn, body = {}) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(s), body: JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };
const sel = async (s, q) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H(s) }); return r.json(); };
const write = async (s, method, q, body) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { method, headers: { ...H(s), Prefer: 'return=representation' }, body: JSON.stringify(body) }); return { ok: r.ok, status: r.status }; };
const future = (d, h) => { const x = new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10); return `${x}T${String(h).padStart(2, '0')}:00:00+09:00`; };

const [admin, joiner, twin, other, legacy, removed, anonNo] = await Promise.all(Array.from({ length: 7 }, signup));

// J00 준비: 멤버 사전 입력 없이(나 + '기존멤버' 한 명) 모임방, 과거 약속 하나
const cg = await rpc(admin, 'create_group', { p_name: '[테스트] 공용 초대방', p_description: '비공개 설명', p_theme: 'cafe', p_names: ['관리자', '도토리구름'], p_my_index: 1 });
const G = cg.body.group_id;
const legacyToken = cg.body.invites[0].token;
const link = await rpc(admin, 'create_group_join_link', { p_group_id: G, p_days: 30 });
if (!link.ok) { console.log('J00 007 SQL 이 아직 실행되지 않았어요 — 테스트 미실행', link.status, JSON.stringify(link.body).slice(0, 120)); process.exit(2); }
const T = link.body.token;
const ov0 = await rpc(admin, 'group_overview', { p_group_id: G });
const memIds = ov0.body.members.map((m) => m.id);
const past = await rpc(admin, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] 가입 전 약속', p_member_ids: memIds, p_mode: 'poll', p_days: null, p_times: [{ starts_at: future(5, 19), ends_at: future(5, 21) }] });
check('J00', '멤버 사전 입력 없이 만든 모임방에서 관리자가 공용 링크 발급', cg.ok && link.ok && typeof T === 'string' && T.length >= 40 && past.ok);

// J01 권한: 일반/외부인은 발급·상태·회전·폐기 불가
const deny = await Promise.all([rpc(other, 'create_group_join_link', { p_group_id: G }), rpc(other, 'group_join_link_status', { p_group_id: G }), rpc(other, 'revoke_group_join_link', { p_group_id: G }), rpc(null, 'preview_group_join_link', { p_token: T })]);
check('J01', '외부인 발급·상태·폐기 거부, 로그인 없는 미리보기 거부', deny.every((r) => !r.ok), deny.map((r) => r.status).join('/'));

// J02 미리보기는 최소 정보만, 열기만으로 가입 안 됨
const pv = await rpc(joiner, 'preview_group_join_link', { p_token: T });
const ov1 = await rpc(admin, 'group_overview', { p_group_id: G });
check('J02', '미리보기: 이름·테마·간단 설명·상태만(009, 멤버·약속·토큰 없음), 열기만으로 멤버 수 변화 없음',
  pv.ok && Object.keys(pv.body).sort().join() === 'description,name,state,theme' && pv.body.state === 'ok' && ov1.body.members.length === 2);

// J03 참여하기 → 멤버 1개, 과거 약속 참여자/응답 생기지 않음
const j1 = await rpc(joiner, 'join_group_with_link', { p_token: T, p_display_name: '별사탕' });
const ovJ = await rpc(joiner, 'group_overview', { p_group_id: G });
const pastItem = ovJ.body && ovJ.body.meetings.find((m) => m.id === past.body.meeting_id);
const myParts = await sel(joiner, `participants?meeting_id=eq.${past.body.meeting_id}&select=id`);
check('J03', '참여하기로 일반 멤버 1명 생성, 가입 전 약속에는 참여자·응답 없음(008: 목록에도 안 보임)',
  j1.ok && ovJ.ok && ovJ.body.me.role === 'member' && !pastItem && myParts.length === 0);

// J04 재클릭·동시 요청에도 중복 멤버 없음
const again = await Promise.all(Array.from({ length: 5 }, () => rpc(joiner, 'join_group_with_link', { p_token: T, p_display_name: '별사탕' })));
const ov2 = await rpc(admin, 'group_overview', { p_group_id: G });
check('J04', '같은 사용자 재클릭·동시 5번 → 모두 기존 멤버 반환, 멤버 수 3 그대로',
  again.every((r) => r.ok && r.body.already === true) && ov2.body.members.length === 3);

// J05 같은 닉네임의 다른 사용자는 기존 멤버 행을 가져가지 못함
const tw = await rpc(twin, 'join_group_with_link', { p_token: T, p_display_name: '도토리구름' });
const ov3 = await rpc(admin, 'group_overview', { p_group_id: G });
const legacyRow = ov3.body.members.find((m) => m.display_name === '도토리구름');
check('J05', '기존 멤버와 같은 이름으로 가입 시도 → 거부, 기존 행은 미연결 그대로(claim 없음)', !tw.ok && legacyRow && legacyRow.joined === false);

// J06 정당한 개인 토큰 claim 은 그대로, 이중 claim 거부
const c1 = await rpc(legacy, 'accept_group_invite', { p_token: legacyToken });
const c2 = await rpc(twin, 'accept_group_invite', { p_token: legacyToken });
check('J06', '개인 초대 토큰 claim 정상, 다른 사용자의 같은 토큰 재사용 거부', c1.ok && !c2.ok);

// J07 권한 상승 불가: 공용 링크 멤버가 관리자 기능·역할 변경 불가, 테이블 직접 수정 불가
const esc = await Promise.all([
  rpc(joiner, 'create_group_join_link', { p_group_id: G }),
  rpc(joiner, 'set_group_member_role', { p_member_id: ovJ.body.members.find((m) => m.is_me).id, p_role: 'admin' }),
  rpc(joiner, 'remove_group_member', { p_member_id: legacyRow.id }),
  write(joiner, 'PATCH', `group_members?group_id=eq.${G}`, { role: 'admin' }),
  write(other, 'POST', 'group_members', { group_id: G, display_name: '침입', user_id: other.uid, role: 'admin', sort_order: 99 }),
]);
const ovE = await rpc(admin, 'group_overview', { p_group_id: G });
check('J07', '공용 링크 멤버: 링크 발급·스스로 관리자·멤버 제외·직접 수정 거부, 외부인 직접 삽입 거부(관리자는 여전히 1명)',
  esc.every((r) => !r.ok) && esc.every((r) => r.status !== 404) && ovE.body.members.filter((m) => m.role === 'admin').length === 1, esc.map((r) => r.status).join('/'));

// J08 회전: 이전 링크 거절, 기존 멤버·개인 링크 유지
const rot = await rpc(admin, 'create_group_join_link', { p_group_id: G, p_days: 30 });
const oldTry = await rpc(other, 'join_group_with_link', { p_token: T, p_display_name: '늦은사람' });
const oldPv = await rpc(other, 'preview_group_join_link', { p_token: T });
const stillMember = await rpc(joiner, 'group_overview', { p_group_id: G });
const newJoin = await rpc(other, 'join_group_with_link', { p_token: rot.body.token, p_display_name: '늦은사람' });
check('J08', '회전 후 이전 링크 가입 거부(미리보기 revoked), 기존 멤버 유지, 새 링크 가입 가능',
  rot.ok && !oldTry.ok && oldPv.body.state === 'revoked' && stillMember.ok && newJoin.ok);

// J09 폐기 → 가입 거부, 상태 조회는 관리자만(원문 없음)
const rv = await rpc(admin, 'revoke_group_join_link', { p_group_id: G });
const afterRv = await rpc(removed, 'join_group_with_link', { p_token: rot.body.token, p_display_name: '폐기후' });
const stat = await rpc(admin, 'group_join_link_status', { p_group_id: G });
check('J09', '폐기 후 가입 거부, 상태에 토큰 원문 없음', rv.ok && !afterRv.ok && stat.ok && !JSON.stringify(stat.body).includes(rot.body.token));

// J10 제외된 사용자는 공용 링크로 재가입 불가
const l3 = await rpc(admin, 'create_group_join_link', { p_group_id: G, p_days: 30 });
const jr = await rpc(removed, 'join_group_with_link', { p_token: l3.body.token, p_display_name: '나갈사람' });
const ovR = await rpc(admin, 'group_overview', { p_group_id: G });
const rmId = ovR.body.members.find((m) => m.display_name === '나갈사람').id;
await rpc(admin, 'remove_group_member', { p_member_id: rmId });
const rejoin = await rpc(removed, 'join_group_with_link', { p_token: l3.body.token, p_display_name: '다시왔어요' });
check('J10', '관리자가 뺀 사용자의 공용 링크 재가입 거부', jr.ok && !rejoin.ok);

// J11 잘못된 링크·속도 제한
const bad = await rpc(anonNo, 'join_group_with_link', { p_token: 'x'.repeat(48), p_display_name: '추측' });
const burst = [];
for (let i = 0; i < 22; i += 1) burst.push(await rpc(anonNo, 'preview_group_join_link', { p_token: `guess-${i}` }));
check('J11', '잘못된 토큰은 invalid, 10분 안 실패 20회 넘으면 서버가 막음',
  bad.ok && bad.body.state === 'invalid' && burst.some((r) => !r.ok && /너무 많아요/.test(JSON.stringify(r.body))));

const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 테스트 모임방 ID ${G}`);
process.exit(pass === results.length ? 0 : 1);
