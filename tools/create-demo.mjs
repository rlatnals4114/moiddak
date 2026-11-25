// 사용자 테스트·시연용 모임 두 개(A 시간 후보 투표 / B 30분 시간표)를 만들고,
// 주최자 복구 링크와 참가자별 개인 초대 링크를 docs/DEMO_LINKS_비공개.md 에 적는다(배포 폴더 밖, 공유 금지).
// 사용: node tools/create-demo.mjs [주최자이름] [참가자이름 ...]   예) node tools/create-demo.mjs 수민 지민 현우 서연 민지
// 첫 이름이 주최자(본인도 참가). 이름은 만든 뒤 바꿀 수 없으니 실제 이름으로 실행한다.
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://moiddak.hackathon-kit.workers.dev';
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const names = process.argv.slice(2).length >= 2 ? process.argv.slice(2) : ['수민', '친구1', '친구2', '친구3', '친구4'];

const kstDay = (n) => new Date(Date.now() + 9 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const at = (day, hh) => `${day}T${hh}:00+09:00`;

const sign = await (await fetch(`${env.SUPABASE_URL}/auth/v1/signup`, {
  method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}',
})).json();
if (!sign.access_token) throw new Error(`익명 세션 생성 실패: ${JSON.stringify(sign)}`);
const rpc = async (fn, body) => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Authorization: `Bearer ${sign.access_token}` }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.message);
  return j;
};

const [d1, d2, d3] = [kstDay(2), kstDay(3), kstDay(4)];
const a = await rpc('create_meeting_v2', {
  p_title: '[시연] 모이딱 저녁 약속 (간단하게 고르기)', p_names: names, p_host_index: 1, p_mode: 'poll', p_days: null,
  p_times: [
    { starts_at: at(d1, '18:30'), ends_at: at(d1, '20:30') },
    { starts_at: at(d2, '19:00'), ends_at: at(d2, '21:00') },
    { starts_at: at(d3, '12:00'), ends_at: at(d3, '14:00') },
  ],
});
const b = await rpc('create_meeting_v2', {
  p_title: '[시연] 모이딱 독서모임 (시간표에서 맞추기)', p_names: names, p_host_index: 1, p_mode: 'grid', p_times: null,
  p_days: [d1, d2, d3].map((day) => ({ day, start_minute: 17 * 60, end_minute: 22 * 60 })),
});

const block = (title, m) => [
  `## ${title}`,
  '',
  `- 모임 링크(단체방용, 이것만으로는 응답 불가): ${SITE}/#/m/${m.meeting_id}`,
  `- **주최자 복구 링크 (${names[0]}, 노트북에서 먼저 열기 · 절대 공유 금지)**: ${SITE}/#/m/${m.meeting_id}?admin=${m.admin_token}`,
  '',
  '| 참가자 | 개인 초대 링크 (본인에게 1:1로만) |',
  '| --- | --- |',
  ...m.invites.map((i) => `| ${i.display_name} | ${SITE}/#/m/${m.meeting_id}?invite=${i.token} |`),
  '',
].join('\n');

writeFileSync(new URL('../docs/DEMO_LINKS_비공개.md', import.meta.url), [
  '# 시연용 모임 링크 (비공개)',
  '',
  `> 만든 시각: ${new Date().toISOString()} · 참가자: ${names.join(', ')}`,
  '> 이 파일의 링크는 권한 그 자체다. 발표 화면·단체방·저장소에 올리지 않는다. 배포 폴더(public) 밖에 있어 웹에는 올라가지 않는다.',
  '',
  '**사용 순서**: ① 주최자 복구 링크를 노트북 크롬에서 연다(이 브라우저가 주최자가 됨) → ② 각 참가자에게 개인 초대 링크를 카카오톡 1:1로 보낸다 → ③ 단체방에는 모임 링크만.',
  '',
  block('A · 간단하게 고르기 (시간 후보 3개)', a),
  block('B · 시간표에서 맞추기 (3일 × 17:00~22:00)', b),
].join('\n'));
console.log(`A ${a.meeting_id}\nB ${b.meeting_id}\n→ docs/DEMO_LINKS_비공개.md 에 링크를 적었어요(공유 금지).`);
