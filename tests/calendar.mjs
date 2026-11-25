// 005 통합 캘린더 인수 테스트(실제 DB, 서로 다른 익명 세션): node tests/calendar.mjs
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
const day = (d) => new Date(Date.now() + 9 * 36e5 + d * 864e5).toISOString().slice(0, 10);
const at = (d, hm) => `${day(d)}T${hm}:00+09:00`;
const range = { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 60 * 864e5).toISOString() };
const cal = async (s) => (await rpc(s, 'my_calendar', range)).body;

const [host, a, b, c] = await Promise.all(Array.from({ length: 4 }, signup));

// 모임방(민지·수민·현우·지연) + 약속 A 모드(수민·현우만 참여, 주최자 민지는 참석 안 함)
const cg = await rpc(host, 'create_group', { p_name: '[테스트] 캘린더', p_description: null, p_theme: 'beach', p_names: ['민지', '수민', '현우', '지연'], p_my_index: 1 });
const G = cg.body.group_id;
const inv = Object.fromEntries(cg.body.invites.map((i) => [i.display_name, i.token]));
await Promise.all([rpc(a, 'accept_group_invite', { p_token: inv['수민'] }), rpc(b, 'accept_group_invite', { p_token: inv['현우'] }), rpc(c, 'accept_group_invite', { p_token: inv['지연'] })]);
const mem = Object.fromEntries((await rpc(host, 'group_overview', { p_group_id: G })).body.members.map((m) => [m.display_name, m.id]));
const gm = await rpc(host, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] 캘린더 약속', p_member_ids: [mem['수민'], mem['현우']], p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: at(5, '14:00'), ends_at: at(5, '16:00') }, { starts_at: at(6, '19:00'), ends_at: null }] });
const M = gm.body.meeting_id;
const opts = await sel(a, `time_options?meeting_id=eq.${M}&select=id&order=sort_order`);
await rpc(a, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [opts[0].id] });

const aCal = await cal(a);
const ai = aCal.find((x) => x.id === M);
check('C01', '참여자 캘린더: 모임방 약속 포함, 후보 2개(내가 고른 1개 표시), 끝 시간 없는 후보는 1시간, 내 응답 완료',
  ai && ai.group && ai.group.name === '[테스트] 캘린더' && ai.candidates.length === 2 && ai.candidates.filter((x) => x.mine).length === 1
    && ai.my_state === 'done' && Date.parse(ai.candidates[1].end) - Date.parse(ai.candidates[1].start) === 3600000);

const bi = (await cal(b)).find((x) => x.id === M);
const ci = (await cal(c)).find((x) => x.id === M);
const hi = (await cal(host)).find((x) => x.id === M);
check('C02', '미응답 참여자는 pending, 참여하지 않은 모임방 멤버의 캘린더엔 없음, 주최자(참석 안 함)는 주최로 보임',
  bi && bi.my_state === 'pending' && !ci && hi && hi.i_host === true && hi.i_participate === false && hi.my_state === null);

const allowed = ['id', 'title', 'group', 'status', 'mode', 'selected_start', 'selected_end', 'i_host', 'i_participate', 'my_state', 'candidates'].sort().join();
const keysOk = aCal.every((x) => Object.keys(x).sort().join() === allowed);
const leak = JSON.stringify(aCal).includes('현우');
check('C03', '항목에는 내 정보만(정해진 키만, 다른 참여자 이름 없음)', keysOk && !leak);

// B 모드: 연속 칸은 하나의 구간으로
const gm2 = await rpc(host, 'create_group_meeting', { p_group_id: G, p_title: '[테스트] 캘린더 시간표', p_member_ids: [mem['민지'], mem['수민']], p_mode: 'grid', p_times: null,
  p_days: [{ day: day(7), start_minute: 17 * 60, end_minute: 22 * 60 }] });
const M2 = gm2.body.meeting_id;
await rpc(a, 'submit_grid', { p_meeting_id: M2, p_slots: [at(7, '18:00'), at(7, '18:30'), at(7, '20:00')].map((x) => new Date(x).toISOString()) });
const a2 = (await cal(a)).find((x) => x.id === M2);
const mine = a2 && a2.candidates.filter((x) => x.mine).map((x) => [new Date(x.start).toISOString(), new Date(x.end).toISOString()]);
check('C04', 'B 모드: 조사 범위 1개 + 내가 고른 칸을 이은 구간 2개(18:00~19:00, 20:00~20:30)',
  a2 && a2.candidates.filter((x) => !x.mine).length === 1 && mine.length === 2
    && mine[0][0] === new Date(at(7, '18:00')).toISOString() && mine[0][1] === new Date(at(7, '19:00')).toISOString()
    && mine[1][1] === new Date(at(7, '20:30')).toISOString());

// 확정 → 확정 일시만, 후보 없음 / 기간 밖은 제외
const v = (await sel(host, `meetings?id=eq.${M}&select=version`))[0].version;
await rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: opts[0].id, p_expected_version: v });
const a3 = (await cal(a)).find((x) => x.id === M);
const before = (await rpc(a, 'my_calendar', { p_from: new Date(Date.now() - 30 * 864e5).toISOString(), p_to: new Date(Date.now() - 2 * 864e5).toISOString() })).body;
check('C05', '확정하면 확정 일시만(후보 비움), 조회 기간 밖 약속은 제외',
  a3 && a3.selected_start && a3.candidates.length === 0 && Array.isArray(before) && !before.some((x) => x.id === M));

// 멤버에서 빠지면 모임방 이름은 숨김(참여 기록은 유지)
await rpc(host, 'remove_group_member', { p_member_id: mem['현우'] });
const b2 = (await cal(b)).find((x) => x.id === M);
const tooLong = await rpc(a, 'my_calendar', { p_from: new Date().toISOString(), p_to: new Date(Date.now() + 500 * 864e5).toISOString() });
const anon = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/my_calendar`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(range) });
check('C06', '모임방에서 빠진 사람: 참여했던 약속은 남고 모임방 이름은 숨김 / 400일 초과 거부 / 로그인 없이 호출 거부',
  b2 && b2.group === null && !tooLong.ok && !anon.ok);

console.log(`\n결과: ${results.filter(Boolean).length}/${results.length} 통과 · 테스트 모임방 ID ${G}`);
process.exit(results.every(Boolean) ? 0 : 1);
