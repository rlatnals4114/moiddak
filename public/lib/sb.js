import { createClient } from './deps.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';
import { friendly } from './errors.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export { friendly };

// 모든 RPC 호출은 { data, error } 를 돌려주고, 네트워크 예외도 error 로 바꿔 화면이 멈추지 않게 한다.
const rawRpc = sb.rpc.bind(sb);
sb.rpc = async (fn, args) => {
  try {
    const r = await rawRpc(fn, args);
    return r.error ? { data: null, error: { ...r.error, message: friendly(r.error.message) } } : r;
  } catch (e) {
    return { data: null, error: { message: friendly(e && e.message) } };
  }
};

// 참가자 캐릭터(avatar) 칸은 003 마이그레이션 이후에 생긴다. 아직 없으면 그 칸 없이 읽는다.
let avatarColumn = true;
export async function selectParticipants(build) {
  if (avatarColumn) {
    const r = await build('id,meeting_id,display_name,user_id,sort_order,avatar');
    if (!r.error || !/avatar/.test(r.error.message || '')) return r;
    avatarColumn = false;
  }
  return build('id,meeting_id,display_name,user_id,sort_order');
}

// 내 정보(프로필). 003 마이그레이션 전이면 ready:false 를 돌려준다.
const notReady = (e) => /get_my_profile|save_my_profile|schema cache|does not exist|function/i.test((e && e.message) || '');
export async function loadMyProfile() {
  const { data, error } = await sb.rpc('get_my_profile');
  if (error) return notReady(error) ? { ready: false } : { ready: true, error: error.message };
  return { ready: true, ...data };
}
export async function saveMyProfile(nickname, avatar) {
  return sb.rpc('save_my_profile', { p_nickname: nickname, p_avatar: avatar });
}

// 모임 화면에 필요한 행을 모두 읽는다. RLS 때문에 소속되지 않은 모임이면 meeting 이 null 이다.
export async function fetchMeeting(id) {
  const q = (t, cols = '*') => sb.from(t).select(cols).eq('meeting_id', id);
  const res = await Promise.all([
    sb.from('meetings').select('*').eq('id', id).maybeSingle(),
    selectParticipants((cols) => q('participants', cols).order('sort_order')),
    q('time_options').order('sort_order'),
    q('schedule_submissions', 'participant_id,updated_at'),
    q('availability_choices', 'participant_id,time_option_id'),
    q('schedule_survey_days').order('day'),
    q('grid_availability', 'participant_id,slot_start'),
    q('place_candidates').order('created_at'),
    q('place_submissions', 'participant_id,kind'),
    q('place_votes', 'participant_id,kind,candidate_id'),
    q('final_places', 'kind,candidate_id'),
  ]);
  const bad = res.find((r) => r.error);
  if (bad) throw new Error(friendly(bad.error.message));
  const [m, participants, times, scheduleSubs, choices, surveyDays, gridRows, candidates, placeSubs, votes, finals] = res.map((r) => r.data);
  if (!m) return null;
  // 방문 일정(006 이후에만 있는 표 — 없으면 빈 목록)
  const rs = await sb.from('meeting_rsvps').select('participant_id,round,status').eq('meeting_id', id);
  const rsvps = rs.error ? null : rs.data; // null = 참석 확인 기능 없음(011 전)
  const it = await sb.from('itinerary_stops').select('*').eq('meeting_id', id).order('sort_order');
  const stops = it.error ? [] : it.data;
  // 모임방 약속이면 모임방 이름(내가 그 모임방 멤버일 때만 RLS 로 보인다)
  let group = null;
  if (m.group_id) { const g = await sb.from('groups').select('id,name,theme').eq('id', m.group_id).maybeSingle(); group = g.data || null; }
  return { meeting: m, group, stops, rsvps, participants, times, scheduleSubs, choices, surveyDays, gridRows, candidates, placeSubs, votes, finals };
}
