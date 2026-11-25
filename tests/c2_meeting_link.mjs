// 010 C2 일회성 약속 링크 참여 테스트(실제 DB, 서로 다른 익명 세션, [테스트] 데이터): node tests/c2_meeting_link.mjs
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
const write = async (s, method, q, body) => { const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { method, headers: { ...H(s), Prefer: 'return=representation' }, body: JSON.stringify(body) }); return { ok: r.ok, status: r.status }; };
const future = (d, h) => { const x = new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10); return `${x}T${String(h).padStart(2, '0')}:00:00+09:00`; };
const dk = (d) => new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10);

const [host, a, b, outsider] = await Promise.all(Array.from({ length: 4 }, signup));

// C2-1 주최자 불참 + 이름 미리 입력 없이 생성(A 모드)
const cm = await rpc(host, 'create_meeting_open', { p_title: '[테스트] C2 링크 약속', p_my_name: null, p_mode: 'poll',
  p_times: [{ starts_at: future(6, 18), ends_at: future(6, 20) }, { starts_at: future(7, 18), ends_at: future(7, 20) }], p_days: null });
const M = cm.body && cm.body.meeting_id;
const T = cm.body && cm.body.join_token;
const parts0 = await sel(host, `participants?meeting_id=eq.${M}&select=id`);
const mrow = (await sel(host, `meetings?id=eq.${M}&select=join_mode,host_participant_id,owner_user_id`))[0];
check('C2-1', '주최자 불참·명단 없이 생성: 참여자 0명, join_mode=link, 주최자 권한(owner) 유지, 참여 링크·관리자 토큰 발급',
  cm.ok && parts0.length === 0 && mrow.join_mode === 'link' && mrow.host_participant_id === null && mrow.owner_user_id === host.uid && typeof T === 'string' && !!cm.body.admin_token);

// C2-2 미리보기(제목·상태만) + 열기만으로 참여자 안 생김 + 비참여자는 상세 0행
const pv = await rpc(a, 'preview_meeting_join_link', { p_token: T });
const parts1 = await sel(host, `participants?meeting_id=eq.${M}&select=id`);
const outRead = await Promise.all([sel(a, `meetings?id=eq.${M}&select=id`), sel(a, `time_options?meeting_id=eq.${M}&select=id`)]);
check('C2-2', '미리보기는 제목·상태만, 열기만으로 참여자 0명, 참여 전 상세 0행',
  pv.ok && Object.keys(pv.body).sort().join() === 'state,title' && pv.body.state === 'ok' && parts1.length === 0 && outRead.every((r) => r.length === 0));

// C2-3 명시적 참여 → 재방문·동시 5회에도 1행
const j1 = await rpc(a, 'join_meeting_with_link', { p_token: T, p_display_name: '구름빵' });
const many = await Promise.all(Array.from({ length: 5 }, () => rpc(a, 'join_meeting_with_link', { p_token: T, p_display_name: '구름빵' })));
const pvAgain = await rpc(a, 'preview_meeting_join_link', { p_token: T });
const partsA = await sel(host, `participants?meeting_id=eq.${M}&select=id,user_id`);
check('C2-3', '참여하기로 1행, 재클릭·동시 5회 모두 기존 행 반환, 다시 열면 member', j1.ok && many.every((r) => r.ok && r.body.already) && pvAgain.body.state === 'member' && partsA.length === 1);

// C2-4 같은 이름 거부, A/B 응답 저장
const dup = await rpc(b, 'join_meeting_with_link', { p_token: T, p_display_name: '구름빵' });
const jb = await rpc(b, 'join_meeting_with_link', { p_token: T, p_display_name: '별사탕' });
const opts = await sel(a, `time_options?meeting_id=eq.${M}&select=id&order=sort_order`);
const subA = await rpc(a, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [opts[0].id] });
const cmG = await rpc(host, 'create_meeting_open', { p_title: '[테스트] C2 시간표 약속', p_my_name: '주최', p_mode: 'grid', p_times: null,
  p_days: [{ day: dk(9), start_minute: 18 * 60, end_minute: 20 * 60 }] });
await rpc(a, 'join_meeting_with_link', { p_token: cmG.body.join_token, p_display_name: '구름빵' });
const subG = await rpc(a, 'submit_grid', { p_meeting_id: cmG.body.meeting_id, p_slots: [new Date(`${dk(9)}T18:00:00+09:00`).toISOString()] });
const hostPart = await sel(host, `participants?meeting_id=eq.${cmG.body.meeting_id}&select=display_name,user_id`);
check('C2-4', '같은 이름 거부, 참여자 A 모드 응답 저장, 주최자 참석형(B 모드) 생성·참여자 응답 저장',
  !dup.ok && jb.ok && subA.ok && cmG.ok && subG.ok && hostPart.some((p) => p.display_name === '주최' && p.user_id === host.uid));

// C2-5 권한: 참여자는 링크 회전·회수·확정 불가, 외부인 직접 삽입 불가, 주최자(불참)는 확정 가능
const ver = (await sel(host, `meetings?id=eq.${M}&select=version`))[0].version;
const deny = await Promise.all([
  rpc(a, 'rotate_meeting_join_link', { p_meeting_id: M }), rpc(a, 'revoke_meeting_join_link', { p_meeting_id: M }),
  rpc(a, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: opts[0].id, p_expected_version: ver }),
  write(outsider, 'POST', 'participants', { meeting_id: M, display_name: '침입', user_id: outsider.uid, sort_order: 9 }),
]);
const conf = await rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: opts[0].id, p_expected_version: ver });
check('C2-5', '참여자는 링크 회전·회수·확정 불가, 외부인 직접 삽입 불가 / 불참 주최자는 확정 가능', deny.every((r) => !r.ok) && conf.ok, deny.map((r) => r.status).join('/'));

// C2-6 회전·회수: 이전 링크 거부, 기존 참여자 유지
const rot = await rpc(host, 'rotate_meeting_join_link', { p_meeting_id: M });
const oldJoin = await rpc(outsider, 'join_meeting_with_link', { p_token: T, p_display_name: '늦은이' });
const newJoin = await rpc(outsider, 'join_meeting_with_link', { p_token: rot.body.token, p_display_name: '늦은이' });
await rpc(host, 'revoke_meeting_join_link', { p_meeting_id: M });
const late2 = await signup();
const afterRevoke = await rpc(late2, 'join_meeting_with_link', { p_token: rot.body.token, p_display_name: '더늦은이' });
const partsNow = await sel(host, `participants?meeting_id=eq.${M}&select=id`);
check('C2-6', '회전 후 이전 링크 거부·새 링크 참여, 회수 후 거부, 기존 참여자 유지', rot.ok && !oldJoin.ok && newJoin.ok && !afterRevoke.ok && partsNow.length === 3);

// C2-7 정원 30명(동시 요청 포함 초과 없음) — 31명이 동시에 참여 시도
const cm30 = await rpc(host, 'create_meeting_open', { p_title: '[테스트] C2 정원', p_my_name: null, p_mode: 'poll', p_times: [{ starts_at: future(12, 12), ends_at: future(12, 13) }], p_days: null });
const people = [];
for (let i = 0; i < 31; i += 1) people.push(await signup());
const res = await Promise.all(people.map((s, i) => rpc(s, 'join_meeting_with_link', { p_token: cm30.body.join_token, p_display_name: `사람${i + 1}` })));
const n30 = (await sel(host, `participants?meeting_id=eq.${cm30.body.meeting_id}&select=id`)).length;
check('C2-7', '31명 동시 참여 시도 → 정확히 30명만, 1명 정원 초과 거부', n30 === 30 && res.filter((r) => r.ok).length === 30 && res.filter((r) => !r.ok).length === 1, `참여 ${n30}명`);

// C2-8 최종 확정 후 신규 참여 거부, 잘못된 토큰 invalid, 기존 명단형 약속 정상
const v2 = (await sel(host, `meetings?id=eq.${M}&select=version`))[0].version;
await rpc(host, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: v2 });
const rot2 = await rpc(host, 'rotate_meeting_join_link', { p_meeting_id: M });
const bad = await rpc(outsider, 'join_meeting_with_link', { p_token: 'z'.repeat(48), p_display_name: 'x' });
const legacy = await rpc(host, 'create_meeting_v2', { p_title: '[테스트] C2 명단형', p_names: ['가', '나'], p_host_index: 1, p_mode: 'poll', p_times: [{ starts_at: future(14, 10), ends_at: future(14, 11) }], p_days: null });
check('C2-8', '최종 확정 후 링크 새로 만들기 거부, 잘못된 토큰 invalid, 기존 명단형 약속·개인 초대 정상',
  !rot2.ok && bad.ok && bad.body.state === 'invalid' && legacy.ok && legacy.body.invites.length === 1);

const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 링크 약속 ID ${M}`);
process.exit(pass === results.length ? 0 : 1);
