// 최종 약속 카드·공유 문구. 방문 일정(006)이 있으면 순서·시간대로, 예전 방식으로 확정한 약속은 식당·카페로 보여 준다.
import { PixelIcon, KindIcon } from '../ui/Pixel.js';
import { html } from '../lib/deps.js';
import { names, safeUrl, copyText, meetingLink, KIND } from '../lib/util.js';
import { fmtRange, fmtTime } from '../lib/time.js';

const linkOf = (p) => safeUrl(p.detail_url) || safeUrl(p.map_url);
const addrOf = (p) => p.road_address || p.address || '';

// 카드·문구 공통: [{time, icon, label, name, address, link, note}]
function placesOf(v) {
  if (v.stops.length) {
    return v.stops.map((s) => ({ kind: s.kind, time: s.planned_time ? fmtTime(s.planned_time) : '', icon: KIND[s.kind].icon, label: KIND[s.kind].label,
      name: s.name, address: s.address || '', link: safeUrl(s.map_url), note: s.note || '' }));
  }
  return v.legacyFinals.map((p) => ({ kind: p.kind, time: '', icon: KIND[p.kind].icon, label: KIND[p.kind].label, name: p.name, address: addrOf(p), link: linkOf(p), note: '' }));
}

export function finalText(v) {
  const places = placesOf(v);
  return [
    `📌 [${v.meeting.title}] 약속 완성!`,
    `🗓 ${fmtRange(v.selectedStart, v.selectedEnd)} (한국 시간)`,
    ...places.map((p) => [`${p.time ? `${p.time} ` : ''}${p.icon} ${p.label}: ${p.name}${p.note ? ` (${p.note})` : ''}`,
      p.address && `   ${p.address}`, p.link && `   ${p.link}`].filter(Boolean).join('\n')),
    !places.length && (v.placeSkipped ? '📍 장소 없이 진행' : ''),
    `👥 ${v.meeting.join_mode === 'link' ? '참여한 사람' : '초대 대상'}: ${names(v.participants)}`,
    `약속 링크: ${meetingLink(v.meeting.id)}`,
  ].filter(Boolean).join('\n');
}

export function FinalCard({ v }) {
  const places = placesOf(v);
  return html`
    <section class="card final" aria-labelledby="final-h">
      <h2 id="final-h"><${PixelIcon} name="heart" size=${16} /> 약속 완성!</h2>
      <p class="final-when"><${PixelIcon} name="cal" size=${16} /> <strong>${fmtRange(v.selectedStart, v.selectedEnd)}</strong> <span class="muted small">(한국 시간)</span></p>
      ${places.length > 0 && html`<ol class="timeline big">${places.map((p) => html`<li>
        <span class="tl-time">${p.time}</span>
        <span class="tl-body"><strong><${KindIcon} kind=${p.kind} size=${14} /> ${p.name}</strong> <span class="small muted">${p.label}${p.note ? ` · ${p.note}` : ''}</span>
          ${p.address && html`<span class="small muted">${p.address}</span>`}
          ${p.link && html`<a class="ext-link" href=${p.link} target="_blank" rel="noopener noreferrer">지도 ↗</a>`}</span>
      </li>`)}</ol>`}
      ${!places.length && v.placeSkipped && html`<p class="muted"><${PixelIcon} name="pin" size=${14} /> 장소 생략 — 장소 없이 진행해요.</p>`}
      <p class="small">${v.meeting.join_mode === 'link' ? '참여한 사람' : '초대 대상'}: ${names(v.participants)} ${Array.isArray(v.rsvps) ? '' : html`<span class="muted">(참석 여부 미확인)</span>`}</p>
      <button class="btn block" onClick=${() => copyText(finalText(v))}>안내 문구 복사하기</button>
    </section>`;
}
