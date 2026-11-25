// 006 장소 v2 인수 테스트(실제 DB, 서로 다른 익명 세션): node tests/places_v2.mjs
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
const day = new Date(Date.now() + 9 * 36e5 + 6 * 864e5).toISOString().slice(0, 10);
const at = (hm) => `${day}T${hm}:00+09:00`;

const [host, a, out] = await Promise.all([signup(), signup(), signup()]);
const cr = await rpc(host, 'create_meeting_v2', { p_title: '[테스트] 장소 v2', p_names: ['주최', '수민'], p_host_index: 1, p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: at('13:00'), ends_at: at('19:00') }] });
const M = cr.body.meeting_id;
await rpc(a, 'accept_invite', { p_token: cr.body.invites[0].token });

// P2-01 새 분류 후보
const place = (id, lat) => ({ provider: 'kakao', provider_place_id: id, address: '제주시', road_address: '제주시 어딘가 1', category: '관광명소', latitude: lat, longitude: 126.5, detail_url: `http://place.map.kakao.com/${id}` });
const c1 = await rpc(a, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'meeting_point', p_name: '제주시청 앞', p_map_url: null, p_place: null });
const c2 = await rpc(a, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'attraction', p_name: '사라봉', p_map_url: null, p_place: place('901', 33.51) });
const c3 = await rpc(host, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'activity', p_name: '전시관', p_map_url: 'https://example.com/x', p_place: null });
const c4 = await rpc(host, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'cafe', p_name: '바다카페', p_map_url: null, p_place: place('902', 33.5) });
const badKind = await rpc(a, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'spaceship', p_name: 'x', p_map_url: null, p_place: null });
const outAdd = await rpc(out, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'etc', p_name: 'x', p_map_url: null, p_place: null });
check('P2-01', '집결지·관광지·놀거리·카페 후보 추가, 없는 분류·외부인 거부', c1.ok && c2.ok && c3.ok && c4.ok && !badKind.ok && !outAdd.ok);

// P2-02 장소 먼저(일정 확정 전 투표)
const v2 = await rpc(a, 'submit_place_v2', { p_meeting_id: M, p_kind: 'attraction', p_candidate_id: c2.body });
const v1old = await rpc(a, 'submit_place', { p_meeting_id: M, p_kind: 'cafe', p_candidate_id: c4.body });
const votes = await sel(host, `place_votes?meeting_id=eq.${M}&select=kind,candidate_id`);
check('P2-02', '일정 확정 전에도 장소 투표(v2) 가능, 옛 함수는 기존 규칙(확정 후) 그대로', v2.ok && !v1old.ok && votes.length === 1 && votes[0].kind === 'attraction');

// P2-03 방문 일정
const stops = [
  { kind: 'meeting_point', name: '제주시청 버스정류장', address: '제주시 광양9길', planned_time: at('13:30'), note: '2번 출구' },
  { candidate_id: c2.body, planned_time: at('14:00') },
  { candidate_id: c4.body, planned_time: at('15:30') },
];
const setOk = await rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: stops, p_skip: false });
const rows = await sel(a, `itinerary_stops?meeting_id=eq.${M}&select=sort_order,kind,name,latitude,map_url,planned_time,note&order=sort_order`);
const tries = await Promise.all([
  rpc(a, 'set_itinerary', { p_meeting_id: M, p_stops: [], p_skip: true }),
  rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: Array.from({ length: 11 }, (_, i) => ({ kind: 'etc', name: `곳${i}` })), p_skip: false }),
  rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: [{ kind: 'etc', name: 'x', map_url: 'javascript:alert(1)' }], p_skip: false }),
  rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: [{ candidate_id: '00000000-0000-0000-0000-000000000000' }], p_skip: false }),
  rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: [{ kind: 'etc', name: 'x' }], p_skip: true }),
]);
const outRead = await sel(out, `itinerary_stops?meeting_id=eq.${M}&select=id`);
const rows2 = await sel(a, `itinerary_stops?meeting_id=eq.${M}&select=id`);
check('P2-03', '주최자 방문 일정 3곳(집결지 직접+후보 2) 순서·시간·메모·좌표 저장, 참여자 조회 가능',
  setOk.ok && rows.length === 3 && rows[0].kind === 'meeting_point' && rows[0].note === '2번 출구' && rows[1].latitude === 33.51
    && rows[2].map_url.includes('902') && Date.parse(rows[1].planned_time) === Date.parse(at('14:00')));
check('P2-04', '참여자 수정·11곳·위험 링크·다른 약속 후보·장소없음+방문지 동시 거부(기존 일정 유지), 외부인 조회 0행',
  tries.every((r) => !r.ok) && Array.isArray(outRead) && outRead.length === 0 && rows2.length === 3);

// P2-05 최종 확정 v2
const v = () => sel(host, `meetings?id=eq.${M}&select=version,status`).then((r) => r[0]);
const early = await rpc(host, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: (await v()).version });
const opt = (await sel(host, `time_options?meeting_id=eq.${M}&select=id`))[0].id;
await rpc(host, 'confirm_schedule', { p_meeting_id: M, p_time_option_id: opt, p_expected_version: (await v()).version });
const notHost = await rpc(a, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: (await v()).version });
const fin = await rpc(host, 'finalize_meeting_v2', { p_meeting_id: M, p_expected_version: (await v()).version });
const after = await Promise.all([
  rpc(a, 'submit_place_v2', { p_meeting_id: M, p_kind: 'cafe', p_candidate_id: c4.body }),
  rpc(host, 'set_itinerary', { p_meeting_id: M, p_stops: [], p_skip: true }),
  rpc(a, 'add_place_candidate_v3', { p_meeting_id: M, p_kind: 'etc', p_name: '늦은 곳', p_map_url: null, p_place: null }),
]);
check('P2-05', '일정 확정 전 최종 확정 거부, 참여자 거부, 확정 후 방문지 3곳으로 완성(식당 없이), 이후 투표·일정·후보 잠금',
  !early.ok && !notHost.ok && fin.ok && fin.body.stops === 3 && (await v()).status === 'finalized' && after.every((r) => !r.ok));

// P2-06 장소 없이 진행
const cr2 = await rpc(host, 'create_meeting_v2', { p_title: '[테스트] 온라인', p_names: ['주최', '수민'], p_host_index: 1, p_mode: 'poll', p_days: null, p_times: [{ starts_at: at('20:00'), ends_at: null }] });
const M2 = cr2.body.meeting_id;
const skip = await rpc(host, 'set_itinerary', { p_meeting_id: M2, p_stops: [], p_skip: true });
const o2 = (await sel(host, `time_options?meeting_id=eq.${M2}&select=id`))[0].id;
const vv = (await sel(host, `meetings?id=eq.${M2}&select=version`))[0].version;
await rpc(host, 'confirm_schedule', { p_meeting_id: M2, p_time_option_id: o2, p_expected_version: vv });
const fin2 = await rpc(host, 'finalize_meeting_v2', { p_meeting_id: M2, p_expected_version: vv + 1 });
const m2 = (await sel(host, `meetings?id=eq.${M2}&select=status,place_skipped`))[0];
check('P2-06', '장소 없이 진행(온라인) → 장소 0곳으로 최종 확정', skip.ok && fin2.ok && m2.status === 'finalized' && m2.place_skipped === true);

console.log(`\n결과: ${results.filter(Boolean).length}/${results.length} 통과 · 테스트 약속 ID ${M}`);
process.exit(results.every(Boolean) ? 0 : 1);
