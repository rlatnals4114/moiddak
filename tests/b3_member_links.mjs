// 009 B3 멤버 초대 링크 테스트(실제 DB, 서로 다른 익명 세션, [테스트] 데이터): node tests/b3_member_links.mjs
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
const days = (iso) => Math.round((Date.parse(iso) - Date.now()) / 864e5);

const [admin, mem, f1, f2, f3, kicked, leaver, other] = await Promise.all(Array.from({ length: 8 }, signup));
const cg = await rpc(admin, 'create_group', { p_name: '[테스트] B3 멤버 링크방', p_description: '설명 한 줄', p_theme: 'beach', p_names: ['관리'], p_my_index: 1 });
const G = cg.body.group_id;
const A = await rpc(admin, 'create_my_join_link', { p_group_id: G });
await rpc(mem, 'join_group_with_link', { p_token: A.body.token, p_display_name: '멤버' });
const M = await rpc(mem, 'create_my_join_link', { p_group_id: G });
check('B3-1', '관리자 링크 30일(admin) · 멤버 링크 7일(member)', A.ok && A.body.kind === 'admin' && days(A.body.expires_at) === 30 && M.ok && M.body.kind === 'member' && days(M.body.expires_at) === 7);

const jf1 = await rpc(f1, 'join_group_with_link', { p_token: M.body.token, p_display_name: '친구1' });
const st = await rpc(admin, 'group_join_link_status', { p_group_id: G });
const list = await rpc(admin, 'list_group_join_links', { p_group_id: G });
const memList = await rpc(mem, 'list_group_join_links', { p_group_id: G });
check('B3-2', '멤버 링크로 가입, 관리자 상태는 내 링크 기준, 관리자 목록에 만든 사람·종류(원문·해시 없음), 멤버는 목록 조회 불가',
  jf1.ok && st.ok && st.body.kind === 'admin' && list.ok && list.body.length === 2 && list.body.some((l) => l.kind === 'member' && l.created_by_name === '멤버' && l.use_count === 1)
    && !JSON.stringify(list.body).includes(M.body.token) && !JSON.stringify(list.body).includes(A.body.token) && !memList.ok);

// 멤버 초대 끄기 → 멤버 링크 무효, 관리자 링크 유효, 멤버는 새로 못 만듦
const off = await rpc(admin, 'set_group_invite_policy', { p_group_id: G, p_allow_member: false, p_capacity: 50 });
const viaMem = await rpc(f2, 'join_group_with_link', { p_token: M.body.token, p_display_name: '친구2' });
const pvMem = await rpc(f2, 'preview_group_join_link', { p_token: M.body.token });
const memNew = await rpc(mem, 'create_my_join_link', { p_group_id: G });
const viaAdm = await rpc(f2, 'join_group_with_link', { p_token: A.body.token, p_display_name: '친구2' });
check('B3-3', '멤버 초대 끄면 멤버 링크 가입 거부(미리보기 revoked)·새 멤버 링크 불가, 관리자 링크는 가입 가능',
  off.ok && !viaMem.ok && pvMem.body.state === 'revoked' && !memNew.ok && viaAdm.ok);

// 정원: 현재 멤버 수로 줄이면 가득 → 거부, 현재보다 작게는 설정 불가
const cnt = (await rpc(admin, 'group_overview', { p_group_id: G })).body.members.length;
const tooSmall = await rpc(admin, 'set_group_invite_policy', { p_group_id: G, p_allow_member: true, p_capacity: cnt - 1 });
await rpc(admin, 'set_group_invite_policy', { p_group_id: G, p_allow_member: true, p_capacity: cnt });
const full = await rpc(f3, 'join_group_with_link', { p_token: A.body.token, p_display_name: '친구3' });
const pvFull = await rpc(f3, 'preview_group_join_link', { p_token: A.body.token });
await rpc(admin, 'set_group_invite_policy', { p_group_id: G, p_allow_member: true, p_capacity: 50 });
check('B3-4', '정원(capacity) 공통 적용: 가득 차면 거부(미리보기 full), 현재 인원보다 작게 설정 불가', !tooSmall.ok && !full.ok && pvFull.body.state === 'full');

// 관리자 제외 → 재가입 거부 / 스스로 나가기 → 재가입 허용
const M2 = await rpc(mem, 'create_my_join_link', { p_group_id: G });
await rpc(kicked, 'join_group_with_link', { p_token: A.body.token, p_display_name: '나갈사람' });
await rpc(leaver, 'join_group_with_link', { p_token: A.body.token, p_display_name: '떠날사람' });
const ovK = await rpc(admin, 'group_overview', { p_group_id: G });
await rpc(admin, 'remove_group_member', { p_member_id: ovK.body.members.find((m) => m.display_name === '나갈사람').id });
const lv = await rpc(leaver, 'leave_group', { p_group_id: G });
const rejoinKicked = await rpc(kicked, 'join_group_with_link', { p_token: M2.body.token, p_display_name: '다시' });
const rejoinLeaver = await rpc(leaver, 'join_group_with_link', { p_token: M2.body.token, p_display_name: '돌아옴' });
const lastAdmin = await rpc(admin, 'leave_group', { p_group_id: G });
check('B3-5', '관리자가 뺀 사람 재가입 거부 · 스스로 나간 사람 재가입 허용 · 마지막 관리자는 나가기 불가', lv.ok && !rejoinKicked.ok && rejoinLeaver.ok && !lastAdmin.ok);

// 회수: 개별 취소·내 링크 끄기·빠진 멤버가 만든 링크 무효
const listNow = (await rpc(admin, 'list_group_join_links', { p_group_id: G })).body;
const memLink = listNow.find((l) => l.kind === 'member');
const byId = await rpc(admin, 'revoke_group_join_link_by_id', { p_link_id: memLink.id });
const afterRevoke = await rpc(other, 'join_group_with_link', { p_token: M2.body.token, p_display_name: '늦음' });
const memRevokeOther = await rpc(mem, 'revoke_group_join_link_by_id', { p_link_id: listNow.find((l) => l.kind === 'admin').id });
check('B3-6', '관리자 개별 취소 후 그 링크 가입 거부, 멤버는 남의 링크 취소 불가', byId.ok && !afterRevoke.ok && !memRevokeOther.ok);

// 다른 모임방 권한 우회 불가
const cg2 = await rpc(other, 'create_group', { p_name: '[테스트] B3 남의 방', p_description: null, p_theme: 'cafe', p_names: ['남'], p_my_index: 1 });
const cross = await Promise.all([
  rpc(mem, 'create_my_join_link', { p_group_id: cg2.body.group_id }),
  rpc(mem, 'list_group_join_links', { p_group_id: cg2.body.group_id }),
  rpc(mem, 'set_group_invite_policy', { p_group_id: cg2.body.group_id, p_allow_member: true, p_capacity: 10 }),
  rpc(mem, 'set_group_invite_policy', { p_group_id: G, p_allow_member: true, p_capacity: 10 }),
]);
check('B3-7', '다른 모임방 링크 생성·목록·설정 불가, 일반 멤버는 자기 모임방 설정도 불가', cross.every((r) => !r.ok));

const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 테스트 모임방 ID ${G}`);
process.exit(pass === results.length ? 0 : 1);
