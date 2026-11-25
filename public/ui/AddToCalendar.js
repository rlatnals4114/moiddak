// 확정 약속을 내 캘린더에 추가(.ics 파일 내려받기 + 구글 캘린더 대안).
// - 일정이 확정되지 않았으면 그리지 않는다(호출부에서 selectedStart 가 있을 때만).
// - 끝 시각이 없는 약속은 사용자가 끝 시각을 직접 고른 뒤에만 파일을 만든다(임의 길이 금지).
// - 파일에는 제목·시각·확정 장소·토큰 없는 약속 주소만. 한 번 저장한 일정은 자동으로 바뀌지 않는다고 안내.
import { html, useState } from '../lib/deps.js';
import { buildIcs, icsFileName, googleCalendarUrl } from '../lib/ics.js';
import { meetingLink, KIND, toast } from '../lib/util.js';
import { fmtTime } from '../lib/time.js';
import { PixelIcon } from './Pixel.js';

function placeInfo(v) {
  const stops = v.stops.length ? v.stops.map((s) => ({ kind: s.kind, name: s.name, address: s.address || '' }))
    : v.legacyFinals.map((p) => ({ kind: p.kind, name: p.name, address: p.road_address || p.address || '' }));
  if (!stops.length) return { location: '', lines: [v.placeSkipped ? '장소: 없이 진행' : '장소: 정하지 않음'] };
  const first = stops.find((s) => s.kind === 'meeting_point') || stops[0];
  return {
    location: first.address ? `${first.name} (${first.address})` : first.name,
    lines: stops.map((s, i) => `${i + 1}. ${KIND[s.kind] ? KIND[s.kind].label : '장소'}: ${s.name}`),
  };
}

export function AddToCalendar({ v }) {
  const [endPick, setEndPick] = useState('');
  if (!v.selectedStart) return null;
  const start = v.selectedStart;
  const end = v.selectedEnd || (endPick ? new Date(Date.parse(start) + Number(endPick) * 60000).toISOString() : null);
  const { location, lines } = placeInfo(v);
  const url = meetingLink(v.meeting.id); // 토큰 없는 약속 주소
  const description = ['모이딱 약속', ...lines, `약속 보기: ${url}`].join('\n');
  const inKakao = typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent || '');
  const opts = Array.from({ length: 12 }, (_, i) => (i + 1) * 30);

  function download() {
    try {
      const ics = buildIcs({ id: v.meeting.id, title: v.meeting.title, start, end, location, description, url, sequence: (v.meeting.schedule_round || 1) - 1 });
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = icsFileName(v.meeting.id);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('캘린더 파일을 만들었어요. 열면 캘린더에 추가할 수 있어요.');
    } catch (e) { toast(e.message); }
  }
  return html`<div class="add-cal">
    ${!v.selectedEnd && html`<label for="cal-end" class="small"><strong>끝나는 시간</strong>을 골라 주세요 <span class="muted">(이 약속은 끝 시간이 정해지지 않았어요)</span></label>
      <select id="cal-end" value=${endPick} onChange=${(e) => setEndPick(e.target.value)}>
        <option value="">고르기…</option>
        ${opts.map((m) => html`<option value=${m}>${fmtTime(new Date(Date.parse(start) + m * 60000).toISOString())}까지 (${m >= 60 ? `${m / 60}시간` : `${m}분`})</option>`)}
      </select>`}
    <div class="btn-row">
      <button type="button" class="btn ghost grow" disabled=${!end} onClick=${download}><${PixelIcon} name="cal" size=${14} /> 캘린더에 추가하기</button>
      ${end && html`<a class="btn ghost" href=${googleCalendarUrl({ title: v.meeting.title, start, end, location, description })} target="_blank" rel="noopener noreferrer">구글 캘린더</a>`}
    </div>
    <p class="muted small">${inKakao ? '카카오톡 안에서는 파일이 열리지 않을 수 있어요. 오른쪽 위 메뉴에서 ‘다른 브라우저로 열기’ 후 다시 누르거나 ‘구글 캘린더’를 써 주세요. ' : ''}캘린더에 저장한 일정은 모이딱에서 시간·장소가 바뀌어도 자동으로 바뀌지 않아요. 바뀌면 다시 추가해 주세요.</p>
  </div>`;
}
