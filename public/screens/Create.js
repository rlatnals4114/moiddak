// 모임 만들기(단계형): ① 모임·참가자 → ② 일정 정하는 방법(A 후보 투표 / B 30분 시간표)과 후보·조사 범위 → 모임방으로
import { html, useState, useRef, useEffect } from '../lib/deps.js';
import { useMe } from '../lib/me.js';
import { sb } from '../lib/sb.js';
import { go, writeHost } from '../lib/util.js';
import { STEPS, SLOT, todayKey, dayLabel, dayLabelLong, minuteLabel, kstISO, fmtRange } from '../lib/time.js';
import { Msg, TimeSelect } from '../ui/common.js';
import { Stepper } from '../ui/Stepper.js';
import { PixelIcon } from '../ui/Pixel.js';
import { Calendar } from '../ui/Calendar.js';

const MAX_DAYS = 14;
const MAX_BLOCKS = 32;

// 화면에서 고른 후보·조사 범위를 RPC 인자로 바꾼다(일회성 약속·모임방 약속 공통).
export function scheduleInput(mode, polls, days) {
  if (mode === 'poll') {
    if (!polls.length) return { error: '시간 후보를 1개 이상 넣어 주세요.' };
    return { times: polls.map((p) => ({ starts_at: kstISO(p.day, p.start), ends_at: p.end == null ? null : kstISO(p.day, p.end) })), surveys: null };
  }
  const list = Object.entries(days);
  if (!list.length) return { error: '조사할 날짜를 1개 이상 골라 주세요.' };
  if (list.some(([, r]) => r.end <= r.start)) return { error: '날짜마다 끝 시간이 시작 시간보다 늦어야 해요.' };
  if (list.some(([, r]) => (r.end - r.start) / SLOT > MAX_BLOCKS)) return { error: '하루 조사 범위는 16시간(32칸)까지예요.' };
  return { times: null, surveys: list.sort(([a], [c]) => a.localeCompare(c)).map(([day, r]) => ({ day, start_minute: r.start, end_minute: r.end })) };
}

export function CreatePage() {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState(['', '', '']);
  const [hostIdx, setHostIdx] = useState(0); // -1 = 주최자는 참석 안 함
  // 참여 방식(010): 'link' = 참여 링크 하나로 공유(기본, 이름 미리 입력 없음) · 'roster' = 이름을 미리 넣고 사람별 개인 링크
  const [joinMode, setJoinMode] = useState('link');
  const [myName, setMyName] = useState('');
  const [attend, setAttend] = useState(true);
  const me = useMe();
  useEffect(() => { if (me && me.nickname && !myName) setMyName(me.nickname); }, [me && me.nickname]);
  const [mode, setMode] = useState('poll');
  const [polls, setPolls] = useState([]); // [{day, start, end|null}]
  const [days, setDays] = useState({}); // grid: {day: {start, end}}
  const [common, setCommon] = useState({ start: 10 * 60, end: 22 * 60 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fail = (text) => { setMsg({ type: 'error', text }); return false; };

  function basics() {
    if (joinMode === 'link') {
      if (!title.trim()) return fail('약속 이름을 적어 주세요.');
      if (attend && !myName.trim()) return fail('내 이름을 적거나 ‘나는 참석 안 해요’를 골라 주세요.');
      return { open: true };
    }
    const kept = [];
    let host = null;
    people.forEach((n, i) => { const v = n.trim(); if (v) { kept.push(v); if (i === hostIdx) host = kept.length; } });
    if (!title.trim()) return fail('약속 이름을 적어 주세요.');
    if (hostIdx >= 0 && host === null) return fail('‘나’로 고른 칸에 내 이름을 적어 주세요.');
    if (kept.length < 2) return fail('참가자 이름을 2명 이상 적어 주세요.');
    if (kept.length > 12) return fail('참가자는 12명까지예요.');
    if (new Set(kept.map((n) => n.toLowerCase())).size !== kept.length) return fail('같은 이름이 있어요. 성이나 별명으로 구분해 주세요.');
    return { kept, host };
  }

  // 연타·중복 요청 방지: 상태(busy)가 반영되기 전 두 번째 클릭도 막는다
  const createLock = useRef(false);
  async function create() {
    if (createLock.current) { return; }
    createLock.current = true;
    try { await createInner(); } finally { createLock.current = false; }
  }
  async function createInner() {
    if (busy) return;
    const b = basics();
    if (!b) return;
    const sched = scheduleInput(mode, polls, days);
    if (sched.error) return fail(sched.error);
    const { times, surveys } = sched;
    setBusy(true); setMsg(null);
    if (b.open) {
      const r = await sb.rpc('create_meeting_open', { p_title: title.trim(), p_my_name: attend ? myName.trim() : null, p_mode: mode, p_times: times, p_days: surveys });
      setBusy(false);
      if (r.error) return fail(`만들지 못했어요: ${r.error.message}`);
      writeHost(r.data.meeting_id, { admin: r.data.admin_token, joinToken: r.data.join_token });
      go(`/m/${r.data.meeting_id}/host?created=1`);
      return;
    }
    const { data, error } = await sb.rpc('create_meeting_v2', {
      p_title: title.trim(), p_names: b.kept, p_host_index: b.host, p_mode: mode, p_times: times, p_days: surveys,
    });
    setBusy(false);
    if (error) return fail(`만들지 못했어요: ${error.message}`);
    writeHost(data.meeting_id, { admin: data.admin_token, invites: Object.fromEntries(data.invites.map((i) => [i.participant_id, i.token])) });
    go(`/m/${data.meeting_id}/host?created=1`);
  }

  return html`
    <div class="topbar"><a class="back" href="#/" aria-label="홈으로"><${PixelIcon} name="back" size=${14} /></a><span class="top-title">새 일회성 약속</span><span class="top-gap"></span></div>
    <span class="sr-only">${step}/2단계</span>
    <${Stepper} label="약속 만들기 단계" steps=${[
      { label: '이름·부르는 방법', state: step > 1 ? 'done' : 'now', note: step > 1 ? '입력함' : '입력 중' },
      { label: mode === 'grid' ? '조사 날짜·시간' : '일정 방식·시간 후보', state: step === 2 ? 'now' : 'wait', note: step === 2 ? (mode === 'grid' ? '30분 시간표' : '시간 후보 투표') : '' },
    ]} />
    ${step === 1 && html`<${StepBasics} ...${{ title, setTitle, people, setPeople, hostIdx, setHostIdx, joinMode, setJoinMode, myName, setMyName, attend, setAttend }} />`}
    ${step === 2 && html`
      <${ModePicker} mode=${mode} setMode=${setMode} />
      ${mode === 'poll'
        ? html`<${PollSetup} polls=${polls} setPolls=${setPolls} />`
        : html`<${GridSetup} days=${days} setDays=${setDays} common=${common} setCommon=${setCommon} />`}`}
    <${Msg} m=${msg} />
    <div class="fixed-cta">
      ${step === 1
        ? html`<button class="btn block" onClick=${() => { setMsg(null); if (basics()) { setStep(2); window.scrollTo(0, 0); } }}>다음: 일정 정하는 방법</button>`
        : html`<div class="btn-row">
            <button class="btn ghost" onClick=${() => { setMsg(null); setStep(1); window.scrollTo(0, 0); }}>이전</button>
            <button class="btn cta grow" disabled=${busy} onClick=${create}>${busy ? '만드는 중…' : '약속 만들기'}</button>
          </div>`}
    </div>`;
}

function StepBasics({ title, setTitle, people, setPeople, hostIdx, setHostIdx, joinMode, setJoinMode, myName, setMyName, attend, setAttend }) {
  const setPerson = (i, v) => setPeople((a) => a.map((x, j) => (j === i ? v : x)));
  const removePerson = (i) => { setPeople((a) => a.filter((_, j) => j !== i)); if (hostIdx === i) setHostIdx(-1); else if (hostIdx > i) setHostIdx(hostIdx - 1); };
  return html`
    <section class="card">
      <label for="title">약속 이름</label>
      <input id="title" type="text" maxLength="60" placeholder="예: 11월 독서모임" value=${title} onInput=${(e) => setTitle(e.target.value)} />
      <p class="field-label">친구를 부르는 방법</p>
      <div class="radio-cards" role="radiogroup" aria-label="친구를 부르는 방법">
        <label class=${`radio ${joinMode === 'link' ? 'on' : ''}`}><input type="radio" name="join-mode" checked=${joinMode === 'link'} onChange=${() => setJoinMode('link')} />
          <span><strong>참여 링크 하나로 공유</strong> <span class="tag">추천</span><br /><span class="muted small">이름을 미리 적지 않아요. 링크를 받은 친구가 이름을 쓰고 ‘참여하기’를 눌러요(최대 30명).</span></span></label>
        <label class=${`radio ${joinMode === 'roster' ? 'on' : ''}`}><input type="radio" name="join-mode" checked=${joinMode === 'roster'} onChange=${() => setJoinMode('roster')} />
          <span><strong>이름을 미리 넣고 사람별 링크 보내기</strong><br /><span class="muted small">누가 아직 응답 안 했는지 이름으로 알 수 있어요(2~12명).</span></span></label>
      </div>
    </section>
    ${joinMode === 'link' ? html`<section class="card">
      <label class="me-pick"><input type="checkbox" checked=${attend} onChange=${(e) => setAttend(e.currentTarget.checked)} /> 나도 참석해요</label>
      ${attend ? html`<label for="my-name">약속에서 쓸 내 이름</label>
        <input id="my-name" type="text" maxLength="20" placeholder="예: 구름빵" value=${myName} onInput=${(e) => setMyName(e.target.value)} />`
        : html`<p class="muted small">참석하지 않아도 주최자로서 일정을 확정하고 링크를 관리할 수 있어요.</p>`}
      <p class="muted small">링크를 받고 아직 들어오지 않은 사람은 알 수 없어요. 진행 현황은 ‘링크로 참여한 사람 중 응답 수’로 보여요.</p>
    </section>` : html`<section class="card">
      <label>참가자 이름 <span class="muted small">(나도 참석하면 내 이름도 넣고 ‘나’ 체크)</span></label>
      ${people.map((n, i) => html`
        <div class="name-row">
          <input type="text" maxLength="20" aria-label=${`참가자 ${i + 1} 이름`} placeholder=${`참가자 ${i + 1}`} value=${n} onInput=${(e) => setPerson(i, e.target.value)} />
          <label class="me-pick"><input type="radio" name="me" aria-label=${`참가자 ${i + 1}이 나`} checked=${hostIdx === i} onChange=${() => setHostIdx(i)} /> 나</label>
          ${people.length > 2 && html`<button type="button" class="icon-btn" aria-label=${`참가자 ${i + 1} 지우기`} onClick=${() => removePerson(i)}>×</button>`}
        </div>`)}
      <div class="btn-row">
        ${people.length < 12 && html`<button type="button" class="btn ghost small" onClick=${() => setPeople((a) => [...a, ''])}>+ 참가자 추가</button>`}
        <label class="me-pick"><input type="radio" name="me" checked=${hostIdx === -1} onChange=${() => setHostIdx(-1)} /> 나는 참석 안 해요</label>
      </div>
      <p class="muted small">명단은 만든 뒤에 바꿀 수 없어요.</p>
    </section>`}`;
}

export function ModePicker({ mode, setMode }) {
  const cards = [
    { value: 'poll', title: '간단하게 고르기', desc: '내가 제안한 날짜·시간 중 가능한 후보를 골라요.', fit: '식사 약속, 친구 모임 · 참가자는 카드 몇 번 탭', demo: ['11/14(토) 18:00', '11/15(일) 12:00'] },
    { value: 'grid', title: '시간표에서 맞추기', desc: '친구들이 가능한 30분 칸을 표시하고 겹치는 시간을 찾아요.', fit: '독서모임, 동아리 · 참가자는 시간 칸을 골라요', demo: null },
  ];
  return html`
    <section class="card">
      <h2>일정 정하는 방법</h2>
      <div class="mode-cards" role="radiogroup" aria-label="일정 정하는 방법">
        ${cards.map((c) => html`
          <button type="button" role="radio" aria-checked=${mode === c.value} class="mode-card ${mode === c.value ? 'on' : ''}" onClick=${() => setMode(c.value)}>
            <span class="mode-title">${mode === c.value ? '● ' : '○ '}${c.title}</span>
            <span class="mode-desc">${c.desc}</span>
            <span class="mode-fit">${c.fit}</span>
            <span class="mode-demo" aria-hidden="true">
              ${c.demo ? c.demo.map((d) => html`<i class="demo-chip">${d}</i>`)
                : html`<i class="demo-heat">${[1, 3, 5, 4, 2, 0, 2, 4].map((n) => html`<b class="heat-cell h${n}"></b>`)}</i>`}
            </span>
          </button>`)}
      </div>
      <p class="muted small">만든 뒤에는 방법을 바꿀 수 없어요(이미 받은 응답을 지키기 위해서예요). 처음이라면 ‘간단하게 고르기’를 추천해요.</p>
    </section>`;
}

export function PollSetup({ polls, setPolls }) {
  const [day, setDay] = useState(null);
  const [start, setStart] = useState(18 * 60);
  const [end, setEnd] = useState(20 * 60);
  const [noEnd, setNoEnd] = useState(false);
  const [err, setErr] = useState('');
  const today = todayKey();
  const marks = {};
  const perDay = {};
  polls.forEach((p) => { perDay[p.day] = (perDay[p.day] || 0) + 1; });
  Object.entries(perDay).forEach(([d, n]) => { marks[d] = { text: `${n}개`, level: 3 }; });

  function add() {
    setErr('');
    if (!day) return setErr('달력에서 날짜를 먼저 골라 주세요.');
    if (!noEnd && end <= start) return setErr('끝 시간은 시작 시간보다 늦어야 해요.');
    if (polls.some((p) => p.day === day && p.start === start)) return setErr('같은 날 같은 시작 시간이 이미 있어요.');
    if (polls.length >= 8) return setErr('시간 후보는 8개까지예요.');
    setPolls((a) => [...a, { day, start, end: noEnd ? null : end }].sort((x, y) => x.day.localeCompare(y.day) || x.start - y.start));
  }

  return html`
    <section class="card">
      <h2>시간 후보 <span class="muted small">(3~5개 추천 · 한국 시간)</span></h2>
      <${Calendar} label="후보 날짜 고르기" marks=${marks} isSelected=${(d) => d === day} isEnabled=${(d) => d >= today} onPick=${setDay} />
      <div class="add-time">
        <p><strong>${day ? dayLabelLong(day) : '날짜를 골라 주세요'}</strong></p>
        <div class="range-pick">
          <${TimeSelect} label="시작 시간" value=${start} steps=${STEPS.slice(0, -1)} onChange=${setStart} />
          <span class="muted">~</span>
          <${TimeSelect} label="끝 시간" value=${end} steps=${STEPS.slice(1)} onChange=${setEnd} />
        </div>
        <label class="me-pick"><input type="checkbox" checked=${noEnd} onChange=${(e) => setNoEnd(e.target.checked)} /> 끝 시간 없이 시작 시간만</label>
        ${err && html`<p class="msg error">${err}</p>`}
        <button type="button" class="btn ghost block" onClick=${add}>+ 이 시간 후보 추가</button>
      </div>
      ${polls.length > 0 && html`<ul class="cand-list">
        ${polls.map((p, i) => html`<li>
          <span>${fmtRange(kstISO(p.day, p.start), p.end == null ? null : kstISO(p.day, p.end))}</span>
          <button type="button" class="icon-btn" aria-label="이 후보 지우기" onClick=${() => setPolls((a) => a.filter((_, j) => j !== i))}>×</button>
        </li>`)}
      </ul>`}
    </section>`;
}

export function GridSetup({ days, setDays, common, setCommon }) {
  const today = todayKey();
  const list = Object.keys(days).sort();
  const marks = Object.fromEntries(list.map((d) => [d, { text: `${minuteLabel(days[d].start)}~`, level: 3 }]));
  const toggle = (d) => setDays((cur) => {
    const n = { ...cur };
    if (n[d]) delete n[d]; else if (Object.keys(n).length < MAX_DAYS) n[d] = { ...common };
    return n;
  });
  const applyAll = () => setDays((cur) => Object.fromEntries(Object.keys(cur).map((d) => [d, { ...common }])));
  const setDay = (d, k, v) => setDays((cur) => ({ ...cur, [d]: { ...cur[d], [k]: v } }));
  const blocks = (r) => Math.max(0, (r.end - r.start) / SLOT);

  return html`
    <section class="card">
      <h2>조사할 날짜와 시간 <span class="muted small">(30분 단위 · 한국 시간)</span></h2>
      <p class="muted small">달력에서 날짜를 눌러 켜고 꺼요. 최대 ${MAX_DAYS}일, 하루 최대 16시간(${MAX_BLOCKS}칸). 자정을 넘기는 범위는 아직 지원하지 않아요.</p>
      <${Calendar} label="조사 날짜 고르기" marks=${marks} isSelected=${(d) => !!days[d]} isEnabled=${(d) => d >= today} onPick=${toggle} />
      <div class="add-time">
        <p><strong>기본 시간 범위</strong></p>
        <div class="range-pick">
          <${TimeSelect} label="기본 시작" value=${common.start} steps=${STEPS.slice(0, -1)} onChange=${(v) => setCommon((c) => ({ ...c, start: v }))} />
          <span class="muted">~</span>
          <${TimeSelect} label="기본 끝" value=${common.end} steps=${STEPS.slice(1)} onChange=${(v) => setCommon((c) => ({ ...c, end: v }))} />
        </div>
        <button type="button" class="btn ghost small" disabled=${!list.length} onClick=${applyAll}>고른 날짜 모두에 적용</button>
      </div>
      ${list.length > 0 && html`
        <p class="small"><strong>${list.length}일</strong> 선택 · 날짜별로 다르게 바꿀 수 있어요</p>
        <ul class="cand-list">
          ${list.map((d) => html`<li class="day-range">
            <span class="d">${dayLabel(d)}</span>
            <${TimeSelect} label=${`${dayLabel(d)} 시작`} value=${days[d].start} steps=${STEPS.slice(0, -1)} onChange=${(v) => setDay(d, 'start', v)} />
            <span class="muted">~</span>
            <${TimeSelect} label=${`${dayLabel(d)} 끝`} value=${days[d].end} steps=${STEPS.slice(1)} onChange=${(v) => setDay(d, 'end', v)} />
            <span class="small ${blocks(days[d]) > MAX_BLOCKS || blocks(days[d]) === 0 ? 'err-text' : 'muted'}">${blocks(days[d])}칸</span>
            <button type="button" class="icon-btn" aria-label=${`${dayLabel(d)} 빼기`} onClick=${() => toggle(d)}>×</button>
          </li>`)}
        </ul>`}
    </section>`;
}
