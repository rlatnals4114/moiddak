// 003 내 정보·캐릭터 인수 테스트(실제 DB, 서로 다른 익명 세션): node tests/profile.mjs
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

const [host, a, b] = await Promise.all([signup(), signup(), signup()]);

const s1 = await rpc(a, 'save_my_profile', { p_nickname: '수민', p_avatar: { v: 1, base: 'pink' } });
const p1 = await rpc(a, 'get_my_profile');
check('PR01', '닉네임·캐릭터 저장 후 다시 불러오기(재접속과 같은 조회)', s1.ok && p1.body.nickname === '수민' && p1.body.avatar.base === 'pink' && p1.body.is_anonymous === true);

const others = await sel(b, `profiles?user_id=eq.${a.uid}&select=*`);
const direct = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles`, { method: 'POST', headers: H(b), body: JSON.stringify({ user_id: b.uid, nickname: 'x' }) });
check('PR02', '다른 사람 프로필 조회 0행, 표에 직접 쓰기 거부', Array.isArray(others) && others.length === 0 && !direct.ok);

const bad = await Promise.all([
  rpc(a, 'save_my_profile', { p_nickname: null, p_avatar: { v: 1, base: 'red' } }),
  rpc(a, 'save_my_profile', { p_nickname: null, p_avatar: { v: 1, base: 'mint', evil: 'x' } }),
  rpc(a, 'save_my_profile', { p_nickname: null, p_avatar: { v: 1, base: 'mint', hair: '<script>' } }),
  rpc(a, 'save_my_profile', { p_nickname: null, p_avatar: { v: 1, base: 'mint', hair: { x: 1 } } }),
  rpc(a, 'save_my_profile', { p_nickname: '가'.repeat(21), p_avatar: null }),
]);
const p2 = await rpc(a, 'get_my_profile');
check('PR03', '허용 안 된 캐릭터 값·키·형식·긴 닉네임 거부, 기존 값 유지', bad.every((r) => !r.ok) && p2.body.avatar.base === 'pink' && p2.body.nickname === '수민');

const cr = await rpc(host, 'create_meeting_v2', { p_title: '[테스트] 프로필', p_names: ['주최', '수민', '지민'], p_host_index: 1, p_mode: 'poll', p_days: null,
  p_times: [{ starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), ends_at: null }] });
const M = cr.body.meeting_id;
const inv = Object.fromEntries(cr.body.invites.map((i) => [i.display_name, i.token]));
await rpc(a, 'accept_invite', { p_token: inv['수민'] });
const pa = async () => (await sel(host, `participants?meeting_id=eq.${M}&display_name=eq.수민&select=avatar,user_id`))[0];
const r1 = await pa();
check('PR04', '초대 수락하면 내 캐릭터가 모임 참가자에 복사되고 다른 참가자(주최자)도 봄', r1.avatar && r1.avatar.base === 'pink' && r1.user_id === a.uid);

const s2 = await rpc(a, 'save_my_profile', { p_nickname: '수민', p_avatar: { v: 1, base: 'blue' } });
const r2 = await pa();
check('PR05', '캐릭터를 바꾸면 참여 중인 모임에도 반영', s2.ok && s2.body.meetings_updated === 1 && r2.avatar.base === 'blue');

const unbound = (await sel(host, `participants?meeting_id=eq.${M}&display_name=eq.지민&select=avatar`))[0];
await rpc(host, 'reissue_invite', { p_participant_id: (await sel(host, `participants?meeting_id=eq.${M}&display_name=eq.수민&select=id`))[0].id });
const r3 = await pa();
const tamper = await fetch(`${env.SUPABASE_URL}/rest/v1/participants?meeting_id=eq.${M}`, { method: 'PATCH', headers: H(b), body: JSON.stringify({ avatar: { v: 1, base: 'mint' } }) });
check('PR06', '미연결 참가자는 캐릭터 없음(기본값), 새 링크 발급 시 연결과 함께 초기화, 남의 캐릭터 직접 수정 거부',
  unbound.avatar === null && r3.avatar === null && r3.user_id === null && !tamper.ok);

console.log(`\n결과: ${results.filter(Boolean).length}/${results.length} 통과 · 테스트 모임 ID ${M}`);
process.exit(results.every(Boolean) ? 0 : 1);
