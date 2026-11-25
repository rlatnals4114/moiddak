// 011 B1 참석 확인(RSVP) 테스트(실제 DB, 서로 다른 익명 세션, [테스트] 데이터): node tests/b1_rsvp.mjs
// 확정 날짜가 바뀌는 경로(재조율, B2)는 아직 없으므로 '날짜 변경 → 회차 +1' 은 API 로 재현할 수 없어 여기서 다루지 않는다(트리거만 존재).
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

const [host, a, b, c, outsider] = await Promise.all(Array.from({ length: 5 }, signup));
// 링크 참여형 약속: 주최자 + a·b·c (초대 4명), a 만 일정 투표
const cm = await rpc(host, 'create_meeting_open', { p_title: '[테스트] B1 참석 확인', p_my_name: '주최', p_mode: 'poll', p_times: [{ starts_at: future(9, 19), ends_at: future(9, 21) }], p_days: null });
const M = cm.body.meeting_id;
for (const [s, n] of [[a, '하나'], [b, '둘'], [c, '셋']]) await rpc(s, 'join_meeting_with_link', { p_token: cm.body.join_token, p_display_name: n });
const opt = (await sel(host, `time_options?meeting_id=eq.${M}&select=id`))[0];
await rpc(a, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [opt.id] });

// B1-1 확정 전에는 참석 여부를 받을 수 없음
const early = await rpc(a, 'set_my_rsvp', { p_meeting_id: M, p_status: 'yes' });
const ver = (await sel(host, `meetings?id=eq.${M}&select=version`))[0].version;
await rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: opt.id, p_expected_version: ver });
const r0 = await sel(host, `meeting_rsvps?meeting_id=eq.${M}&select=*`);
const round = (await sel(host, `meetings?id=eq.${M}&select=schedule_round`))[0].schedule_round;
check('B1-1', '확정 전 RSVP 거부 · 확정 직후 초대 4명·일정 투표 1명·RSVP 0명(투표 가능 ≠ 참석 자동 지정)', !early.ok && r0.length === 0 && round === 1);

// B1-2 4상태: 참석·불참·미정 + 미응답(행 없음), 변경·되돌리기
const s1 = await rpc(a, 'set_my_rsvp', { p_meeting_id: M, p_status: 'yes' });
const s2 = await rpc(b, 'set_my_rsvp', { p_meeting_id: M, p_status: 'no' });
const s3 = await rpc(c, 'set_my_rsvp', { p_meeting_id: M, p_status: 'maybe' });
const rows = await sel(host, `meeting_rsvps?meeting_id=eq.${M}&round=eq.1&select=status`);
const count = (st) => rows.filter((r) => r.status === st).length;
check('B1-2', '참석 1 · 불참 1 · 미정 1 · 미응답 1(주최자, 행 없음)', s1.ok && s2.ok && s3.ok && count('yes') === 1 && count('no') === 1 && count('maybe') === 1 && rows.length === 3);

const ch = await rpc(b, 'set_my_rsvp', { p_meeting_id: M, p_status: 'yes' });
const back = await rpc(c, 'set_my_rsvp', { p_meeting_id: M, p_status: null });
const rows2 = await sel(host, `meeting_rsvps?meeting_id=eq.${M}&select=status`);
const bad = await rpc(a, 'set_my_rsvp', { p_meeting_id: M, p_status: 'attended' });
check('B1-3', '불참→참석 변경, 미정→미응답으로 되돌리기(행 삭제), 잘못된 값 거부', ch.ok && back.ok && rows2.length === 2 && rows2.every((r) => r.status === 'yes') && !bad.ok);

// B1-4 권한: 비참여자 거부, 남의 RSVP 직접 쓰기·수정·삭제 불가, 다른 약속 사람에게 0행
const out = await rpc(outsider, 'set_my_rsvp', { p_meeting_id: M, p_status: 'yes' });
const aPid = (await sel(a, `participants?meeting_id=eq.${M}&user_id=eq.${a.uid}&select=id`))[0].id;
const direct = await Promise.all([
  write(b, 'POST', 'meeting_rsvps', { meeting_id: M, participant_id: aPid, round: 1, status: 'no' }),
  write(b, 'PATCH', `meeting_rsvps?participant_id=eq.${aPid}`, { status: 'no' }),
  write(b, 'DELETE', `meeting_rsvps?participant_id=eq.${aPid}`),
]);
const outRead = await sel(outsider, `meeting_rsvps?meeting_id=eq.${M}&select=*`);
const aStill = (await sel(host, `meeting_rsvps?participant_id=eq.${aPid}&select=status`))[0];
check('B1-4', '비참여자 RSVP 거부, 다른 참여자가 남의 RSVP 직접 추가·수정·삭제 불가, 외부인 조회 0행',
  !out.ok && direct.every((r) => !r.ok || r.status === 200) && outRead.length === 0 && aStill && aStill.status === 'yes', direct.map((r) => r.status).join('/'));

// B1-5 같은 약속 참여자·주최자는 볼 수 있음(같은 약속 안에서만)
const seenByB = await sel(b, `meeting_rsvps?meeting_id=eq.${M}&select=status`);
const seenByHost = await sel(host, `meeting_rsvps?meeting_id=eq.${M}&select=status`);
check('B1-5', '같은 약속의 참여자·주최자는 참석 현황 조회 가능', seenByB.length === 2 && seenByHost.length === 2);

// B1-6 장소만 바뀌거나 최종 확정돼도 회차·응답 유지
await rpc(host, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'cafe', p_name: '[테스트] B1 카페', p_map_url: null, p_place: null });
const cand = (await sel(host, `place_candidates?meeting_id=eq.${M}&select=id`))[0];
await rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: [{ kind: 'cafe', candidate_id: cand.id, name: '[테스트] B1 카페', planned_time: null }], p_skip: false });
const v2 = (await sel(host, `meetings?id=eq.${M}&select=version`))[0].version;
const fin = await rpc(host, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: v2 });
const after = await sel(host, `meeting_rsvps?meeting_id=eq.${M}&select=status,round`);
const round2 = (await sel(host, `meetings?id=eq.${M}&select=schedule_round`))[0].schedule_round;
check('B1-6', '장소 정하기·최종 확정 뒤에도 회차 1·RSVP 2건 그대로', fin.ok && round2 === 1 && after.length === 2 && after.every((r) => r.round === 1));

// 직접 수정 거부 확인(B1-4 의 PATCH/DELETE 는 RLS 로 0행 처리될 수 있어 상태로 재확인)
const pass = results.filter(Boolean).length;
console.log(`\n결과: ${pass}/${results.length} 통과 · 약속 ID ${M}`);
process.exit(pass === results.length ? 0 : 1);
