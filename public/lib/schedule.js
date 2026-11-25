// 집계 규칙(화면과 테스트가 함께 쓰는 순수 함수). 별도 카운터 없이 실제 제출·선택 행에서 계산한다.
// - 미응답 = 제출 행 없음. 가능한 시간 없음 = 제출 행은 있고 선택 0개.
// - 미응답자는 '불가능'으로 세지 않는다. 가능 인원은 가능으로 고른 서로 다른 참가자 수다.
// - 추천 구간은 구간 안 "모든 칸"에 가능한 사람(교집합) 기준이다.
import { SLOT, kstISO } from './time.js';

export const KINDS = ['meeting_point', 'restaurant', 'cafe', 'activity', 'attraction', 'etc'];

// B 모드: 조사 날짜마다 30분 칸과 칸별 가능한 사람
export function buildGrid(surveyDays, gridRows, participants) {
  const avail = new Map();
  for (const r of gridRows) {
    const k = Date.parse(r.slot_start);
    if (!avail.has(k)) avail.set(k, new Set());
    avail.get(k).add(r.participant_id);
  }
  return [...surveyDays].sort((a, b) => a.day.localeCompare(b.day)).map((d) => {
    const slots = [];
    for (let m = d.start_minute; m < d.end_minute; m += SLOT) {
      const iso = kstISO(d.day, m);
      const key = Date.parse(iso);
      const set = avail.get(key) || new Set();
      slots.push({ key, iso, day: d.day, minute: m, people: participants.filter((p) => set.has(p.id)) });
    }
    return { day: d.day, start: d.start_minute, end: d.end_minute, slots };
  });
}

// 연속 blocks 칸 동안 모두 가능한 사람(교집합)이 많은 순. 겹치는 구간은 더 좋은 것 하나만 남긴다.
export function recommend(grid, blocks, limit = 5) {
  const all = [];
  for (const d of grid) {
    for (let i = 0; i + blocks <= d.slots.length; i += 1) {
      let common = new Set(d.slots[i].people.map((p) => p.id));
      for (let j = i + 1; j < i + blocks && common.size; j += 1) {
        const s = new Set(d.slots[j].people.map((p) => p.id));
        common = new Set([...common].filter((x) => s.has(x)));
      }
      if (!common.size) continue;
      const startMinute = d.slots[i].minute;
      const endMinute = startMinute + blocks * SLOT;
      all.push({ day: d.day, startMinute, endMinute, start: d.slots[i].iso, end: kstISO(d.day, endMinute), ids: [...common] });
    }
  }
  all.sort((a, b) => b.ids.length - a.ids.length || Date.parse(a.start) - Date.parse(b.start));
  const picked = [];
  for (const w of all) {
    if (picked.some((p) => p.day === w.day && w.startMinute < p.endMinute && p.startMinute < w.endMinute)) continue;
    picked.push(w);
    if (picked.length >= limit) break;
  }
  return picked;
}

// 달력 날짜 상태. 미응답자가 있어도 '전원 가능'이라고 하지 않도록 기준은 '응답한 사람'이다.
// 'all' 응답자 모두 가능한 칸(후보)이 있음 · 'some' 일부만 가능 · 'none' 가능한 사람 없음 · 'pending' 아직 응답 없음
export function dayTone(bestCount, responded) {
  if (!responded) return 'pending';
  if (bestCount >= responded) return 'all';
  return bestCount > 0 ? 'some' : 'none';
}

// 화면 전체에서 쓰는 파생 값
export function derive(d, uid) {
  const { meeting, participants, times, scheduleSubs, choices, candidates, placeSubs, votes, finals } = d;
  const me = participants.find((p) => p.user_id === uid) || null;
  const doneIds = new Set(scheduleSubs.map((s) => s.participant_id));
  const options = times.map((t) => ({
    ...t,
    people: participants.filter((p) => choices.some((c) => c.participant_id === p.id && c.time_option_id === t.id)),
  }));
  const grid = buildGrid(d.surveyDays || [], d.gridRows || [], participants);
  const kinds = KINDS.map((kind) => {
    const kDone = new Set(placeSubs.filter((s) => s.kind === kind).map((s) => s.participant_id));
    const cands = candidates.filter((c) => c.kind === kind).map((c) => ({
      ...c,
      voters: participants.filter((p) => votes.some((v) => v.kind === kind && v.candidate_id === c.id && v.participant_id === p.id)),
    }));
    const myVote = me ? votes.find((v) => v.kind === kind && v.participant_id === me.id) : null;
    const f = finals.find((x) => x.kind === kind);
    return {
      kind,
      cands,
      max: Math.max(0, ...cands.map((c) => c.voters.length)),
      done: participants.filter((p) => kDone.has(p.id)),
      pending: participants.filter((p) => !kDone.has(p.id)),
      noPref: participants.filter((p) => kDone.has(p.id) && !votes.some((v) => v.kind === kind && v.participant_id === p.id)),
      votingStarted: kDone.size > 0,
      mySubmitted: !!me && kDone.has(me.id),
      myVote: myVote ? myVote.candidate_id : null,
      final: f ? candidates.find((c) => c.id === f.candidate_id) : null,
    };
  });
  const mode = meeting.schedule_mode || 'poll';
  const myGrid = me ? (d.gridRows || []).filter((r) => r.participant_id === me.id).map((r) => Date.parse(r.slot_start)) : [];
  // 응답 완료했지만 고른 칸/후보가 0개인 사람
  const pickedIds = new Set(mode === 'grid' ? (d.gridRows || []).map((r) => r.participant_id) : choices.map((c) => c.participant_id));
  return {
    ...d,
    mode,
    me,
    isOwner: meeting.owner_user_id === uid,
    N: participants.length,
    schedDone: participants.filter((p) => doneIds.has(p.id)),
    schedPending: participants.filter((p) => !doneIds.has(p.id)),
    schedNone: participants.filter((p) => doneIds.has(p.id) && !pickedIds.has(p.id)),
    mySchedSubmitted: !!me && doneIds.has(me.id),
    myChoices: me ? choices.filter((c) => c.participant_id === me.id).map((c) => c.time_option_id) : [],
    myGrid,
    options,
    maxCount: Math.max(0, ...options.map((o) => o.people.length)),
    grid,
    selectedStart: meeting.selected_start || null,
    selectedEnd: meeting.selected_end || null,
    kinds,
    // 방문 일정(006): 주최자가 정한 순서. 예전 방식으로 확정한 약속은 legacyFinals(식당·카페)로 보여 준다.
    stops: [...(d.stops || [])].sort((a, b) => a.sort_order - b.sort_order),
    placeSkipped: !!meeting.place_skipped,
    legacyFinals: kinds.filter((k) => k.final).map((k) => ({ kind: k.kind, ...k.final })),
  };
}

// 참가자 한 명의 일정 상태: 'pending' 미응답 | 'none' 가능 시간 없음 | 'done' 응답 완료
export function schedState(v, p) {
  if (v.schedPending.includes(p)) return 'pending';
  if (v.schedNone.includes(p)) return 'none';
  return 'done';
}

// 참여자 한 명의 표시용 상태. 저장된 데이터에서만 계산한다(참석/불참은 저장하지 않으므로 없음).
// joined: 개인 초대 링크로 들어와 기기와 연결됐는지 · response: 'pending' 미응답 | 'done' 응답 | 'none' 응답했지만 가능 시간 없음
// pick: 일정 확정 후 '확정된 시간을 가능으로 골랐는지' — 'yes' | 'no' | null(미응답이거나 아직 확정 전)
// role: 'host' 주최자 | null
export function participantStatus(v, p) {
  const response = schedState(v, p);
  let pick = null;
  if (v.selectedStart && response !== 'pending') {
    if (v.mode === 'grid') {
      const s = Date.parse(v.selectedStart);
      const e = Date.parse(v.selectedEnd || v.selectedStart);
      const mine = new Set((v.gridRows || []).filter((r) => r.participant_id === p.id).map((r) => Date.parse(r.slot_start)));
      let all = e > s;
      for (let t = s; t < e; t += 30 * 60000) if (!mine.has(t)) { all = false; break; }
      pick = all ? 'yes' : 'no';
    } else {
      const sel = v.meeting.selected_time_option_id;
      pick = sel && (v.choices || []).some((c) => c.participant_id === p.id && c.time_option_id === sel) ? 'yes' : 'no';
    }
  }
  return { joined: !!p.user_id, response, pick, role: p.id === v.meeting.host_participant_id ? 'host' : null };
}

// 참석 확인(011): 현재 회차(meetings.schedule_round)의 응답만. 행이 없으면 '미응답'(미정과 다름).
export const RSVP_TEXT = { yes: '참석', no: '불참', maybe: '미정', none: '미응답' };
export function rsvpSummary(v) {
  if (!Array.isArray(v.rsvps)) return null; // 기능 없음
  const round = v.meeting.schedule_round || 1;
  const by = new Map(v.rsvps.filter((r) => r.round === round).map((r) => [r.participant_id, r.status]));
  const of = (p) => by.get(p.id) || 'none';
  const count = { yes: 0, no: 0, maybe: 0, none: 0 };
  v.participants.forEach((p) => { count[of(p)] += 1; });
  return { of, count, mine: v.me ? of(v.me) : null, round };
}

export const RESPONSE_TEXT = { pending: '일정 미응답', done: '일정 응답함', none: '응답 · 가능 시간 없음' };
export const PICK_TEXT = { yes: '확정 시간 가능으로 응답', no: '확정 시간은 고르지 않음' };

// 스텝퍼 연결선 한 구간의 상태: 'done' 두 단계 모두 완료 · 'active' 다음 단계가 진행 중 · 'wait' 다음 단계가 대기
// 'skip' 생략: 이어지는 선은 회색 점선(완료처럼 초록으로 칠하지 않음), 생략 다음 단계는 앞 단계를 완료처럼 이어 본다.
export function segmentState(prev, cur) {
  if (cur === 'skip') return 'skip';
  if (prev === 'skip') prev = 'done';
  if (cur === 'done' && prev === 'done') return 'done';
  if (cur === 'done' && prev === 'wait') return 'wait'; // 앞 단계(예: 장소 미정)가 안 끝났으면 회색 — 진행 중처럼 보이지 않게
  if (cur === 'now' || (cur === 'done' && prev !== 'done')) return 'active';
  return 'wait';
}

// 장소 상태(서로 다른 4가지, null 만으로 '생략'을 추정하지 않는다)
//   'set' 방문지(또는 예전 방식 최종 장소)가 있음 · 'skipped' 주최자가 '장소 없이 진행'을 명시(place_skipped)
//   'voting' 후보가 있고 아직 정하지 않음 · 'undecided' 후보도 결정도 없음(확정된 약속이면 '정하지 않고 확정')
export function placeState(v) {
  if (v.stops.length > 0 || v.legacyFinals.length > 0) return 'set';
  if (v.placeSkipped) return 'skipped';
  if (v.meeting.status !== 'finalized' && v.kinds.some((k) => k.cands.length)) return 'voting';
  return 'undecided';
}

// 약속 완성 상태(스텝퍼). 순서를 강요하지 않는다 — 장소가 일정보다 먼저 끝날 수도 있다.
// state: 'done' 완료 · 'now' 진행 중 · 'wait' 대기
export function progressSteps(v) {
  const fin = v.meeting.status === 'finalized';
  const schedDone = !!v.selectedStart;
  const ps = placeState(v);
  return [
    { key: 'schedule', label: '일정', state: schedDone ? 'done' : 'now', note: schedDone ? '확정' : `${v.schedDone.length}/${v.N}명 응답` },
    { key: 'place', label: '장소',
      state: ps === 'set' ? 'done' : ps === 'skipped' ? 'skip' : ps === 'voting' ? 'now' : 'wait',
      note: ps === 'set' ? `${v.stops.length || v.legacyFinals.length}곳 확정` : ps === 'skipped' ? '생략' : ps === 'voting' ? '조율 중' : fin ? '미정' : '선택 사항' },
    { key: 'final', label: '약속 확정', state: fin ? 'done' : schedDone ? 'now' : 'wait', note: fin ? '완성' : schedDone ? '확정 대기' : '대기' },
  ];
}
