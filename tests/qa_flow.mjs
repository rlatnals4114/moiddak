// QA 작업지시서 시나리오(실제 DB, 서로 다른 익명 세션, [테스트] 데이터): node tests/qa_flow.mjs
// T05 대상·연결·응답 수 독립 · T06 가능 시간 없음 vs 미제출 · T07 미응답 상태 확정·중복 확정 · T08 확정 후 응답 고정(조율 기록)
// T15 지속형 모임방: 생성 → 공용 링크 가입 → 첫 약속 → 확정 → 두 번째 약속 · T16 일부 멤버만·신규 멤버·제외 멤버
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

const [admin, a, b, c, late] = await Promise.all(Array.from({ length: 5 }, signup));

// 준비(T15): 내 이름만으로 모임방 → 공용 링크 → a·b·c 가 직접 참여
const cg = await rpc(admin, 'create_group', { p_name: '[테스트] QA 흐름방', p_description: null, p_theme: 'picnic', p_names: ['관리'], p_my_index: 1 });
const G = cg.body.group_id;
const L = (await rpc(admin, 'create_group_join_link', { p_group_id: G, p_days: 30 })).body.token;
const joins = await Promise.all([[a, '하나'], [b, '둘'], [c, '셋']].map(([s, n]) => rpc(s, 'join_group_with_link', { p_token: L, p_display_name: n })));
const ov = await rpc(admin, 'group_overview', { p_group_id: G });
const id = Object.fromEntries(ov.body.members.map((m) => [m.display_name, m.id]));
check('T15a', '멤버 사전 입력 없이 생성 → 공용 링크로 3명 직접 참여', cg.ok && joins.every((r) => r.ok) && ov.body.members.length === 4);

// 첫 약속: 관리·하나·둘·셋 (A 모드 후보 2개)
const m1 = await rpc(admin, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] 첫 약속', p_member_ids: [id['관리'], id['하나'], id['둘'], id['셋']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: future(3, 14), ends_at: future(3, 16) }, { starts_at: future(4, 14), ends_at: future(4, 16) }] });
const M1 = m1.body.meeting_id;
const opts = await sel(admin, `time_options?meeting_id=eq.${M1}&select=id&order=sort_order`);
await rpc(a, 'submit_schedule', { p_meeting_id: M1, p_time_option_ids: [opts[0].id] }); // 가능 시간 제출
await rpc(b, 'submit_schedule', { p_meeting_id: M1, p_time_option_ids: [] });          // 가능 시간 없음 제출
const parts = await sel(admin, `participants?meeting_id=eq.${M1}&select=id,display_name,user_id`);
const subs = await sel(admin, `schedule_submissions?meeting_id=eq.${M1}&select=participant_id`);
const choices = await sel(admin, `availability_choices?meeting_id=eq.${M1}&select=participant_id`);
const done = new Set(subs.map((s) => s.participant_id));
const pid = Object.fromEntries(parts.map((p) => [p.display_name, p.id]));
// T05: 초대 대상 4 · 링크 연결 4(모두 모임방 멤버라 자동 연결) · 일정 응답 2 — 서로 다른 수
check('T05', '초대 대상·링크 연결·일정 응답 수가 독립(대상 4, 연결 4, 응답 2)', parts.length === 4 && parts.filter((p) => p.user_id).length === 4 && done.size === 2);
// T06: '가능 시간 없음'은 제출 행이 있고 선택 0개 — 미제출(행 없음)과 구분된다
check('T06', '가능 시간 없음(제출 행 O, 선택 0) vs 미제출(제출 행 X) 구분',
  done.has(pid['둘']) && !choices.some((x) => x.participant_id === pid['둘']) && !done.has(pid['셋']) && !done.has(pid['관리']));

// T07: 미응답 2명 상태에서 주최자만 확정, 같은 요청 동시 2번 → 하나만 성공
const mt = (await sel(admin, `meetings?id=eq.${M1}&select=version`))[0];
const notHost = await rpc(a, 'confirm_schedule', { p_meeting_id: M1, p_time_option_id: opts[0].id, p_expected_version: mt.version });
const both = await Promise.all([1, 2].map(() => rpc(admin, 'confirm_schedule', { p_meeting_id: M1, p_time_option_id: opts[0].id, p_expected_version: mt.version })));
const after = (await sel(admin, `meetings?id=eq.${M1}&select=status,selected_time_option_id`))[0];
check('T07', '주최자 아닌 사람 확정 거부, 동시 확정 2번 → 1번만 성공(나머지 오류, 성공 아님)',
  !notHost.ok && both.filter((r) => r.ok).length === 1 && both.filter((r) => !r.ok).length === 1 && after.status === 'place_open' && after.selected_time_option_id === opts[0].id,
  both.map((r) => r.status).join('/'));

// T08: 확정 뒤 응답 변경 불가 → 조율 결과는 확정 당시 그대로
const lateSubmit = await rpc(c, 'submit_schedule', { p_meeting_id: M1, p_time_option_ids: [opts[1].id] });
const subs2 = await sel(admin, `schedule_submissions?meeting_id=eq.${M1}&select=participant_id`);
check('T08', '확정 후 미응답자의 응답 제출 거부 — 조율 기록이 확정 당시 그대로(응답 2명)', !lateSubmit.ok && subs2.length === 2);

// T09: 장소 생략은 명시 저장(place_skipped), 장소 없이 확정해도 생략으로 추정하지 않음
const v1 = (await sel(admin, `meetings?id=eq.${M1}&select=version`))[0];
const fin = await rpc(admin, 'finalize_meeting_v2', { p_meeting_id: M1, p_expected_version: v1.version });
const m1row = (await sel(admin, `meetings?id=eq.${M1}&select=status,place_skipped`))[0];
check('T09', '장소를 정하지 않고 최종 확정 → place_skipped=false(생략으로 추정 안 함, 화면은 ‘장소 미정’)', fin.ok && m1row.status === 'finalized' && m1row.place_skipped === false);

// T16: 늦게 들어온 신규 멤버, '셋' 제외, 두 번째 약속은 일부(관리·하나·신규)만
const lj = await rpc(late, 'join_group_with_link', { p_token: L, p_display_name: '넷' });
const ov2 = await rpc(admin, 'group_overview', { p_group_id: G });
const id2 = Object.fromEntries(ov2.body.members.map((m) => [m.display_name, m.id]));
await rpc(admin, 'remove_group_member', { p_member_id: id['셋'] });
const m2 = await rpc(admin, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] 두 번째 약속', p_member_ids: [id2['관리'], id2['하나'], id2['넷']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: future(10, 19), ends_at: future(10, 21) }] });
const M2 = m2.body.meeting_id;
const parts2 = await sel(admin, `participants?meeting_id=eq.${M2}&select=display_name,user_id`);
const subsM2 = await sel(admin, `schedule_submissions?meeting_id=eq.${M2}&select=participant_id`);
const m1parts = await sel(admin, `participants?meeting_id=eq.${M1}&select=display_name`);
const m1subs = await sel(admin, `schedule_submissions?meeting_id=eq.${M1}&select=participant_id`);
const lateM1 = await sel(late, `participants?meeting_id=eq.${M1}&select=id`);
const removedM2 = await sel(c, `meetings?id=eq.${M2}&select=id`);
check('T16', '두 번째 약속: 고른 3명만 대상(신규 포함, 제외자 없음), 응답 0으로 새로 시작, 첫 약속 명단 4명·응답 2건 보존, 신규 멤버는 첫 약속 참여자 아님, 제외자는 새 약속 조회 불가',
  lj.ok && m2.ok && parts2.length === 3 && parts2.map((p) => p.display_name).sort().join() === '관리,넷,하나' && parts2.every((p) => p.user_id)
    && subsM2.length === 0 && m1parts.length === 4 && m1subs.length === 2 && lateM1.length === 0 && removedM2.length === 0);

const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 테스트 모임방 ID ${G}`);
process.exit(pass === results.length ? 0 : 1);
