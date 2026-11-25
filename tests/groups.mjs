// 004 지속형 모임방 인수 테스트(실제 DB, 서로 다른 익명 세션): node tests/groups.mjs
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
const rpc = async (s, fn, body = {}) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(s), body: JSON.stringify(body) }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, body: b }; };
const sel = async (s, q) => (await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H(s) })).json();
const future = (d, h) => { const x = new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10); return `${x}T${String(h).padStart(2, '0')}:00:00+09:00`; };

const [host, a, b, c, a2, out] = await Promise.all(Array.from({ length: 6 }, signup));

// G01 만들기
const cg = await rpc(host, 'create_group', { p_name: '[테스트] 우리 독서모임', p_description: '매달 한 권', p_theme: 'cafe', p_names: ['민지', '수민', '현우', '지연'], p_my_index: 1 });
const G = cg.body.group_id;
const ginv = Object.fromEntries(cg.body.invites.map((i) => [i.display_name, i]));
const ov0 = await rpc(host, 'group_overview', { p_group_id: G });
check('G01', '모임방 생성: 멤버 4명, 만든 사람 = 관리자, 나머지 3명 초대 토큰', cg.ok && ov0.body.members.length === 4 && ov0.body.me.role === 'admin' && cg.body.invites.length === 3 && ov0.body.group.theme === 'cafe');

// G02 초대 수락·권한
const acA = await rpc(a, 'accept_group_invite', { p_token: ginv['수민'].token });
const acB = await rpc(b, 'accept_group_invite', { p_token: ginv['현우'].token });
const reuse = await rpc(out, 'accept_group_invite', { p_token: ginv['수민'].token });
const outRead = await Promise.all([sel(out, `groups?id=eq.${G}&select=*`), sel(out, `group_members?group_id=eq.${G}&select=*`)]);
const outOv = await rpc(out, 'group_overview', { p_group_id: G });
const pub = await rpc(out, 'group_public_info', { p_group_id: G });
check('G02', '초대 수락, 소모된 초대 거부, 외부인 조회 0행·요약 거부, 공개 정보는 이름·테마만',
  acA.ok && acB.ok && !reuse.ok && outRead.every((r) => Array.isArray(r) && r.length === 0) && !outOv.ok && Object.keys(pub.body).sort().join() === 'name,theme');

// G03 모임방에서 약속: 민지(나)·수민(연결됨)·지연(미연결)만 참여, 현우는 멤버지만 미참여
const ids = Object.fromEntries(ov0.body.members.map((m) => [m.display_name, m.id]));
const gm = await rpc(host, 'create_group_meeting', { p_group_id: G, p_title: '11월 정기모임', p_member_ids: [ids['민지'], ids['수민'], ids['지연']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: future(4, 14), ends_at: future(4, 16) }, { starts_at: future(5, 14), ends_at: future(5, 16) }] });
const M = gm.body.meeting_id;
const parts = await sel(host, `participants?meeting_id=eq.${M}&select=display_name,user_id,group_member_id&order=sort_order`);
const pBy = Object.fromEntries(parts.map((p) => [p.display_name, p]));
check('G03', '모임방 약속: 고른 멤버만 참여자, 연결된 멤버(수민)는 초대 없이 바로 연결, 미연결(지연)만 약속 초대',
  gm.ok && parts.length === 3 && pBy['수민'].user_id === a.uid && pBy['지연'].user_id === null && !pBy['현우']
    && gm.body.invites.length === 1 && gm.body.invites[0].display_name === '지연' && parts.every((p) => p.group_member_id));

// G04 멤버 ≠ 참여자
const bOv = await rpc(b, 'group_overview', { p_group_id: G });
const bItem = bOv.body.meetings.find((m) => m.id === M);
const bMeet = await sel(b, `meetings?id=eq.${M}&select=*`);
const bParts = await sel(b, `participants?meeting_id=eq.${M}&select=*`);
const bSubmit = await rpc(b, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] });
const aSubmit = await rpc(a, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] });
check('G04', '참여하지 않은 멤버(현우): 목록에서 제외(008 기본 비공개), 약속 상세 0행, 응답 거부 / 참여자(수민)는 응답 가능',
  bOv.ok && !bItem && bMeet.length === 0 && bParts.length === 0 && !bSubmit.ok && aSubmit.ok);

// G05 늦게 들어온 멤버 → 참여 중인 약속에 자동 연결
const acC = await rpc(c, 'accept_group_invite', { p_token: ginv['지연'].token });
const cSubmit = await rpc(c, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] });
const oldMeetingInvite = await rpc(out, 'accept_invite', { p_token: gm.body.invites[0].token });
check('G05', '모임방 초대를 나중에 수락하면 이미 만든 약속에도 자동 연결·응답 가능, 쓸모없어진 약속 초대는 폐기',
  acC.ok && cSubmit.ok && !oldMeetingInvite.ok);

// G06 권한 보호
const memberTries = await Promise.all([
  rpc(a, 'add_group_members', { p_group_id: G, p_names: ['침입'] }),
  rpc(a, 'update_group', { p_group_id: G, p_name: 'x', p_description: null, p_theme: 'night', p_expected_version: 1 }),
  rpc(a, 'remove_group_member', { p_member_id: ids['현우'] }),
  rpc(a, 'set_group_member_role', { p_member_id: ids['수민'], p_role: 'admin' }),
  rpc(a, 'archive_group', { p_group_id: G, p_archived: true }),
  rpc(out, 'create_group_meeting', { p_group_id: G, p_title: 'x', p_member_ids: [ids['민지'], ids['수민']], p_mode: 'poll', p_times: [{ starts_at: future(6, 10) }], p_days: null }),
]);
const lastAdmin = await Promise.all([
  rpc(host, 'set_group_member_role', { p_member_id: ids['민지'], p_role: 'member' }),
  rpc(host, 'remove_group_member', { p_member_id: ids['민지'] }),
]);
const tamper = await fetch(`${env.SUPABASE_URL}/rest/v1/group_members?group_id=eq.${G}`, { method: 'PATCH', headers: H(a), body: JSON.stringify({ role: 'admin' }) });
check('G06', '일반 멤버의 관리 작업·외부인 약속 생성 거부, 마지막 관리자 해제·제외 거부, 표 직접 수정 거부',
  memberTries.every((r) => !r.ok) && lastAdmin.every((r) => !r.ok) && !tamper.ok, lastAdmin[0].body.message || '');

// G07 관리자 지정·멤버 제외
const promote = await rpc(host, 'set_group_member_role', { p_member_id: ids['수민'], p_role: 'admin' });
const remB = await rpc(a, 'remove_group_member', { p_member_id: ids['현우'] });
const bAfter = await rpc(b, 'group_overview', { p_group_id: G });
const bGroups = await sel(b, `groups?id=eq.${G}&select=id`);
const addNames = await rpc(a, 'add_group_members', { p_group_id: G, p_names: ['서연'] });
check('G07', '관리자 지정 → 새 관리자가 멤버 제외·추가, 제외된 멤버는 모임방을 못 봄',
  promote.ok && remB.ok && !bAfter.ok && bGroups.length === 0 && addNames.ok && addNames.body.invites.length === 1);

// G08 새 링크 발급 → 기기 이전, 응답 보존
const re = await rpc(host, 'reissue_group_invite', { p_member_id: ids['수민'] });
const aLost = await rpc(a, 'group_overview', { p_group_id: G });
const acA2 = await rpc(a2, 'accept_group_invite', { p_token: re.body.token });
const p2 = (await sel(a2, `participants?meeting_id=eq.${M}&display_name=eq.수민&select=user_id`))[0];
const sub2 = (await sel(a2, `schedule_submissions?meeting_id=eq.${M}&select=participant_id`)).length;
check('G08', '새 링크 발급: 이전 기기 연결 해제(관리자 권한도 해제), 새 기기가 모임방·약속에 다시 연결, 이전 응답 보존',
  re.ok && !aLost.ok && acA2.ok && p2 && p2.user_id === a2.uid && sub2 >= 2);

// G09 프로필 캐릭터 → 모임방 멤버에 반영
await rpc(a2, 'save_my_profile', { p_nickname: null, p_avatar: { v: 1, base: 'yellow' } });
const mem = (await sel(host, `group_members?id=eq.${ids['수민']}&select=avatar`))[0];
check('G09', '내 캐릭터를 바꾸면 모임방 멤버 캐릭터에도 반영', mem && mem.avatar && mem.avatar.base === 'yellow');

// G10 버전·종료·기존 일회성 약속
const v = (await rpc(host, 'group_overview', { p_group_id: G })).body.group.version;
const stale = await rpc(host, 'update_group', { p_group_id: G, p_name: '새 이름', p_description: null, p_theme: 'night', p_expected_version: v + 5 });
const upd = await rpc(host, 'update_group', { p_group_id: G, p_name: '[테스트] 우리 독서모임', p_description: '매달 한 권', p_theme: 'night', p_expected_version: v });
const arch = await rpc(host, 'archive_group', { p_group_id: G, p_archived: true });
const blocked = await rpc(host, 'create_group_meeting', { p_group_id: G, p_title: 'x', p_member_ids: [ids['민지'], ids['지연']], p_mode: 'poll', p_times: [{ starts_at: future(7, 10) }], p_days: null });
const reopen = await rpc(host, 'archive_group', { p_group_id: G, p_archived: false });
const legacy = await rpc(host, 'create_meeting_v2', { p_title: '[테스트] 일회성', p_names: ['가', '나'], p_host_index: 1, p_mode: 'poll', p_times: [{ starts_at: future(8, 10) }], p_days: null });
const legacyRow = (await sel(host, `meetings?id=eq.${legacy.body.meeting_id}&select=group_id`))[0];
check('G10', '오래된 화면의 수정 거부(version), 테마 변경, 종료 중 새 약속 거부·다시 열기, 기존 일회성 약속은 group_id 없이 그대로',
  !stale.ok && upd.ok && arch.ok && !blocked.ok && reopen.ok && legacy.ok && legacyRow.group_id === null);

console.log(`\n결과: ${results.filter(Boolean).length}/${results.length} 통과 · 테스트 모임방 ID ${G}`);
process.exit(results.every(Boolean) ? 0 : 1);
