// 공개 주소 검증용: 참가자 여러 명을 서로 다른 익명 세션으로 흉내 낸다(주최자는 실제 브라우저 화면에서 조작).
// 사용: node tests/sim-participants.mjs <세션파일.json> <명령> [인자...]
//   accept <이름> <초대토큰>           새 세션으로 초대 수락
//   join <이름> <공용참여토큰>          새 세션으로 공용 참여 링크 참여
//   poll <이름> <meetingId> <후보번호,…|none>   A 모드 응답(번호는 sort_order 1부터)
//   grid <이름> <meetingId> <YYYY-MM-DDTHH:MM,…|none>  B 모드 응답(KST)
//   vote <이름> <meetingId> <restaurant|cafe> <후보이름|none>
//   try  <이름> <rpc> <json인자>        임의 호출(거부 확인용)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const [file, cmd, ...args] = process.argv.slice(2);
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const H = (t) => ({ apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
const rpc = async (t, fn, body) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H(t), body: JSON.stringify(body) });
  const text = await r.text();
  return { ok: r.ok, body: text };
};
const get = async (t, q) => (await fetch(`${env.SUPABASE_URL}/rest/v1/${q}`, { headers: H(t) })).json();
const tok = (name) => { if (!store[name]) throw new Error(`${name} 세션 없음`); return store[name]; };

let out;
if (cmd === 'accept') {
  const [name, token] = args;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json();
  if (!j.access_token) throw new Error(JSON.stringify(j));
  store[name] = j.access_token;
  out = await rpc(j.access_token, 'accept_invite', { p_token: token });
} else if (cmd === 'join') {
  // 공용 참여 링크(#/join-m?t=…)로 새 세션 참여
  const [name, token] = args;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}' });
  const j = await r.json();
  if (!j.access_token) throw new Error(JSON.stringify(j));
  store[name] = j.access_token;
  out = await rpc(j.access_token, 'join_meeting_with_link', { p_token: token, p_display_name: name });
} else if (cmd === 'poll') {
  const [name, m, picks] = args;
  const opts = await get(tok(name), `time_options?meeting_id=eq.${m}&select=id,sort_order&order=sort_order`);
  const ids = picks === 'none' ? [] : picks.split(',').map((n) => opts.find((o) => o.sort_order === Number(n)).id);
  out = await rpc(tok(name), 'submit_schedule', { p_meeting_id: m, p_time_option_ids: ids });
} else if (cmd === 'grid') {
  const [name, m, slots] = args;
  const list = slots === 'none' ? [] : slots.split(',').map((s) => new Date(`${s}:00+09:00`).toISOString());
  out = await rpc(tok(name), 'submit_grid', { p_meeting_id: m, p_slots: list });
} else if (cmd === 'vote') {
  const [name, m, kind, cand] = args;
  const cands = await get(tok(name), `place_candidates?meeting_id=eq.${m}&kind=eq.${kind}&select=id,name`);
  const id = cand === 'none' ? null : cands.find((c) => c.name === cand)?.id;
  out = await rpc(tok(name), 'submit_place', { p_meeting_id: m, p_kind: kind, p_candidate_id: id });
} else if (cmd === 'try') {
  const [name, fn, json] = args;
  out = await rpc(tok(name), fn, JSON.parse(json));
}
writeFileSync(file, JSON.stringify(store));
console.log(`${cmd} ${args.slice(0, 2).join(' ')} → ${out.ok ? 'OK' : 'REJECTED'} ${out.ok ? '' : out.body.slice(0, 120)}`);
