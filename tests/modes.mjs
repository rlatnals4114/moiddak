// 002 기능 인수 테스트(실제 DB, 서로 다른 익명 세션): B 시간표 모드 · 모드 분리 · 지도 장소 저장
// 실행: node tests/modes.mjs
import { readFileSync } from 'node:fs';
import { kstISO } from '../public/lib/time.js';
import { buildGrid, recommend } from '../public/lib/schedule.js';

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY;
const results = [];
const check = (id, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${detail ? ` — ${detail}` : ''}`); };

async function signup() {
  const r = await fetch(`${URL_}/auth/v1/signup`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json();
  if (!j.access_token) throw new Error(`익명 세션 생성 실패: ${JSON.stringify(j)}`);
  return { token: j.access_token };
}
const H = (s) => ({ apikey: KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` });
async function rpc(s, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(s), body: JSON.stringify(args) });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t; }
  return { ok: r.ok, body };
}
const sel = async (s, table, q) => (await fetch(`${URL_}/rest/v1/${table}?${q}`, { headers: H(s) })).json();

const d1 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
const d2 = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
const at = (day, h, m = 0) => kstISO(day, h * 60 + m);

const [host, b, c, d, e, outsider] = await Promise.all(Array.from({ length: 6 }, signup));

// ───────── B 모임 생성 ─────────
const cr = await rpc(host, 'create_meeting_v2', {
  p_title: '[테스트] 시간표 모드', p_names: ['민지', '수민', '현우', '지연', '서연'], p_host_index: 1, p_mode: 'grid', p_times: null,
  p_days: [{ day: d1, start_minute: 17 * 60, end_minute: 22 * 60 }, { day: d2, start_minute: 10 * 60, end_minute: 12 * 60 }],
});
const M = cr.body.meeting_id;
const inv = Object.fromEntries(cr.body.invites.map((i) => [i.display_name, i.token]));
await Promise.all([rpc(b, 'accept_invite', { p_token: inv['수민'] }), rpc(c, 'accept_invite', { p_token: inv['현우'] }),
  rpc(d, 'accept_invite', { p_token: inv['지연'] }), rpc(e, 'accept_invite', { p_token: inv['서연'] })]);
{
  const days = await sel(b, 'schedule_survey_days', `meeting_id=eq.${M}&select=day,start_minute,end_minute&order=day`);
  const m = (await sel(b, 'meetings', `id=eq.${M}&select=schedule_mode`))[0];
  check('B01', 'B 모임 생성: 모드·조사 날짜 2일 저장, 다른 세션 조회', cr.ok && m.schedule_mode === 'grid' && days.length === 2 && days[0].end_minute === 1320);
}

// ───────── 잘못된 생성 거부 ─────────
{
  const bad = await Promise.all([
    rpc(host, 'create_meeting_v2', { p_title: 'x', p_names: ['a', 'b'], p_host_index: 1, p_mode: 'grid', p_times: null, p_days: [{ day: d1, start_minute: 600, end_minute: 615 }] }),
    rpc(host, 'create_meeting_v2', { p_title: 'x', p_names: ['a', 'b'], p_host_index: 1, p_mode: 'grid', p_times: null, p_days: [{ day: d1, start_minute: 1320, end_minute: 600 }] }),
    rpc(host, 'create_meeting_v2', { p_title: 'x', p_names: ['a', 'b'], p_host_index: 1, p_mode: 'grid', p_times: null, p_days: [] }),
    rpc(host, 'create_meeting_v2', { p_title: 'x', p_names: ['a', 'b'], p_host_index: 1, p_mode: 'weird', p_times: null, p_days: null }),
  ]);
  check('B02', '30분 어긋남·끝<시작·날짜 없음·모드 오류 생성 거부', bad.every((r) => !r.ok));
}

// ───────── 응답: 3명 칸 선택 · 1명 가능 없음 · 1명 미응답 ─────────
const sMin = [at(d1, 18), at(d1, 18, 30)];
const sSu = [at(d1, 18, 30), at(d1, 19)];
const sHyun = [at(d1, 18), at(d1, 18, 30), at(d1, 19), at(d1, 19, 30), at(d2, 10)];
await rpc(host, 'submit_grid', { p_meeting_id: M, p_slots: sMin });
await Promise.all([1, 2, 3].map(() => rpc(b, 'submit_grid', { p_meeting_id: M, p_slots: sSu }))); // 중복 재전송
await rpc(c, 'submit_grid', { p_meeting_id: M, p_slots: sHyun });
const none = await rpc(d, 'submit_grid', { p_meeting_id: M, p_slots: [] });
{
  const subs = await sel(host, 'schedule_submissions', `meeting_id=eq.${M}&select=participant_id`);
  const rows = await sel(host, 'grid_availability', `meeting_id=eq.${M}&select=participant_id,slot_start`);
  const ps = await sel(host, 'participants', `meeting_id=eq.${M}&select=id,display_name`);
  const days = await sel(host, 'schedule_survey_days', `meeting_id=eq.${M}&select=day,start_minute,end_minute&order=day`);
  const grid = buildGrid(days, rows, ps);
  const cnt = (day, h, m = 0) => grid.find((g) => g.day === day).slots.find((s) => s.minute === h * 60 + m).people.length;
  check('B03', '응답 4/5(가능 없음 1명 포함), 미응답 1명, 재전송 중복 없음',
    none.ok && subs.length === 4 && rows.length === 2 + 2 + 5, `제출 ${subs.length}명 · 칸 행 ${rows.length}개`);
  check('B04', '칸별 가능 인원 집계(18:00=2, 18:30=3, 19:00=2, 19:30=1, 17:00=0)',
    cnt(d1, 18) === 2 && cnt(d1, 18, 30) === 3 && cnt(d1, 19) === 2 && cnt(d1, 19, 30) === 1 && cnt(d1, 17) === 0);
  const r2 = recommend(grid, 2);
  const r1 = recommend(grid, 1);
  check('B05', '추천: 1시간 교집합 최대 2명(공통 3명인 1시간 없음), 30분 최대 3명(18:30)',
    r2[0].ids.length === 2 && r1[0].ids.length === 3 && r1[0].startMinute === 18 * 60 + 30, `1시간 1위 ${r2[0].ids.length}명`);
}

// ───────── 범위 밖·어긋난 칸·모드 혼용 거부 ─────────
{
  const bad = await Promise.all([
    rpc(e, 'submit_grid', { p_meeting_id: M, p_slots: [at(d1, 22)] }),
    rpc(e, 'submit_grid', { p_meeting_id: M, p_slots: [at(d1, 18, 15)] }),
    rpc(e, 'submit_grid', { p_meeting_id: M, p_slots: [at(d2, 12)] }),
    rpc(e, 'submit_schedule', { p_meeting_id: M, p_time_option_ids: [] }),
    rpc(outsider, 'submit_grid', { p_meeting_id: M, p_slots: [at(d1, 18)] }),
  ]);
  const subs = await sel(host, 'schedule_submissions', `meeting_id=eq.${M}&select=participant_id`);
  const leaked = await sel(outsider, 'grid_availability', `meeting_id=eq.${M}&select=slot_start`);
  check('B06', '범위 밖·15분 어긋남·A용 제출·외부인 거부, 서연은 계속 미응답, 외부인 조회 0행',
    bad.every((r) => !r.ok) && subs.length === 4 && Array.isArray(leaked) && leaked.length === 0);
}

// ───────── 확정 ─────────
{
  const m0 = (await sel(host, 'meetings', `id=eq.${M}&select=version`))[0];
  const tries = await Promise.all([
    rpc(b, 'confirm_grid', { p_meeting_id: M, p_start: at(d1, 18), p_end: at(d1, 19), p_expected_version: m0.version }),
    rpc(host, 'confirm_grid', { p_meeting_id: M, p_start: at(d1, 21), p_end: at(d1, 23), p_expected_version: m0.version }),
    rpc(host, 'confirm_grid', { p_meeting_id: M, p_start: at(d1, 18, 10), p_end: at(d1, 19), p_expected_version: m0.version }),
    rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: '00000000-0000-0000-0000-000000000000', p_expected_version: m0.version }),
  ]);
  const ok = await rpc(host, 'confirm_grid', { p_meeting_id: M, p_start: at(d1, 18), p_end: at(d1, 19), p_expected_version: m0.version });
  const late = await rpc(e, 'submit_grid', { p_meeting_id: M, p_slots: [at(d1, 18)] });
  const m = (await sel(b, 'meetings', `id=eq.${M}&select=status,selected_start,selected_end`))[0];
  check('B07', '참가자 확정·범위 밖·어긋남·A용 확정 거부 → 주최자 18:00~19:00 확정, 이후 제출 거부',
    tries.every((r) => !r.ok) && ok.ok && !late.ok && m.status === 'place_open' && Date.parse(m.selected_start) === Date.parse(at(d1, 18)));
}

// ───────── 지도 장소 저장 ─────────
{
  const place = { provider: 'kakao', provider_place_id: '12345', address: '서울 성동구 성수동', road_address: '서울 성동구 성수이로 1', category: '음식점 > 양식', latitude: 37.544, longitude: 127.056, detail_url: 'http://place.map.kakao.com/12345' };
  const a1 = await rpc(b, 'add_place_candidate_v2', { p_meeting_id: M, p_kind: 'restaurant', p_name: '성수 파스타', p_map_url: null, p_place: place });
  const dup = await rpc(c, 'add_place_candidate_v2', { p_meeting_id: M, p_kind: 'restaurant', p_name: '성수 파스타 2', p_map_url: null, p_place: place });
  const noCoord = await rpc(c, 'add_place_candidate_v2', { p_meeting_id: M, p_kind: 'cafe', p_name: '좌표 없음', p_map_url: null, p_place: { provider: 'kakao', provider_place_id: '9' } });
  const badUrl = await rpc(c, 'add_place_candidate_v2', { p_meeting_id: M, p_kind: 'cafe', p_name: '위험', p_map_url: null, p_place: { ...place, provider_place_id: '77', detail_url: 'javascript:alert(1)' } });
  const legacy = await rpc(c, 'add_place_candidate', { p_meeting_id: M, p_kind: 'cafe', p_name: '링크만 카페', p_map_url: 'https://naver.me/x' });
  const rows = await sel(d, 'place_candidates', `meeting_id=eq.${M}&select=name,latitude,longitude,road_address,map_url,provider_place_id&order=created_at`);
  check('P01', '지도 장소 저장(좌표·주소·상세링크) → 다른 참가자 조회, 같은 장소 중복·좌표 없음·위험 링크 거부, 링크만 후보 보존',
    a1.ok && !dup.ok && !noCoord.ok && !badUrl.ok && legacy.ok && rows.length === 2
      && rows[0].latitude === 37.544 && rows[0].map_url === place.detail_url && rows[1].latitude === null,
    dup.body?.message || '');
}

console.log(`\n결과: ${results.filter(Boolean).length}/${results.length} 통과 · 테스트 모임 ID ${M}`);
process.exit(results.every(Boolean) ? 0 : 1);
