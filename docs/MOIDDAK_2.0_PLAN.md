# 모이딱 2.0 설계안 — 지속형 모임방 · 통합 캘린더 · 여러 장소

> 작성: 2026-11-07 · 상태: **설계안(미구현)** · 이 문서 작성 중 코드·DB 는 바꾸지 않았다.
> 한 줄: "대화방을 새로 만들지 않아도, 우리 약속은 계속된다."
> 원칙: 기존 데이터·초대 링크·기능은 그대로 두고 **추가**한다. 기존 마이그레이션(001~003)은 수정하지 않는다.

---

## 1. 현재 서비스 구조 (2026-11-07 배포 `1dad6420` 기준)

### 1-1. 데이터 (Supabase, 001~003 실행 완료)
| 구분 | 표 | 비고 |
| --- | --- | --- |
| 약속 | `meetings` | 제목, `owner_user_id`(주최자), `host_participant_id`, `status`(schedule_open→place_open→finalized), `schedule_mode`(poll/grid), `selected_time_option_id`, `selected_start/end`, `version` |
| 참가자 | `participants` | 약속마다 명단. `user_id` = 초대 수락한 익명 계정, `avatar`(003) |
| 일정 A | `time_options`, `availability_choices` | 후보 시각 / 선택 |
| 일정 B | `schedule_survey_days`, `grid_availability` | 조사 날짜·범위 / 30분 칸 |
| 공통 응답 | `schedule_submissions` | 행 없음 = 미응답, 행 있음+선택 0 = 가능 시간 없음 |
| 장소 | `place_candidates`(kind = restaurant·cafe, 카카오 좌표), `place_submissions`, `place_votes`, `final_places`(분류당 1곳) | |
| 프로필 | `profiles` | 익명 계정별 닉네임·캐릭터(본인만 읽기) |
| 비공개 | `private.participant_invites`(해시), `private.admin_tokens`(해시) | API 비노출 |

- **읽기**: 표 SELECT 만 허용, RLS `private.is_member(meeting_id)` = 주최자이거나 연결된 참가자.
- **쓰기**: 전부 SECURITY DEFINER RPC (`create_meeting(_v2)`, `accept_invite`, `claim_admin`, `reissue_invite`, `submit_schedule`, `confirm_schedule`, `submit_grid`, `confirm_grid`, `add_place_candidate(_v2)`, `delete_place_candidate`, `submit_place`, `finalize_meeting`, `meeting_public_info`, `get_my_profile`, `save_my_profile`). 모임 행 `FOR UPDATE` + `version` 으로 동시성 처리.
- **트리거**: 참가자 연결이 바뀌면 프로필 캐릭터를 복사(`participants_avatar_sync`).

### 1-2. 사용자 식별
- 브라우저마다 Supabase **익명 계정**(`auth.uid()`). 로그인·비밀번호 없음, 다른 브라우저·기기 복구 없음.
- 약속별 **개인 초대 토큰**(1회 수락, 해시 저장, 14일 만료, 재발급 시 폐기) → `participants.user_id` 연결.
- 주최자 = `meetings.owner_user_id`. **관리자 복구 링크**(`admin_tokens`)로 다른 기기에 주최자 이전.

### 1-3. 화면 (빌드 없는 ES 모듈, Preact+htm)
`#/` 홈 · `#/new` 약속 만들기 · `#/m/<id>[/schedule|/place|/host]` 약속(모임방이라고 부르던 화면) · `#/me`, `#/me/character` 내 정보.
`lib/`(데이터·규칙) · `ui/`(달력·시간표·지도·캐릭터·픽셀) · `screens/`. 디자인 토큰 `styles/tokens.css`, 캐릭터 코드 도트 12×16 4종(`assets/characters/index.js`).

### 1-4. 배포·테스트
- Cloudflare Workers 정적 자산 `moiddak` (SPA 대체 응답, 해시 라우팅).
- 테스트 35개: `schedule.test.mjs`(7, 순수 규칙) · `acceptance.mjs`(14) · `modes.mjs`(8) · `profile.mjs`(6). 실제 DB 에 서로 다른 익명 세션으로 RPC 직접 호출.
- **SQL 실행 방식**: Supabase MCP 는 Claude 조직 관리자 승인 필요로 미연결(2026-11-07 재확인), service_role 키는 사용하지 않는 원칙 → **자동 실행 불가, 사용자가 SQL Editor 에서 실행**.

---

## 2. 용어 정리 (화면 문구 기준)

| 2.0 용어 | 의미 | 데이터 |
| --- | --- | --- |
| **모임방** | 고정 멤버가 계속 쓰는 공간(예: 우리 독서모임) | 신규 `groups` |
| **멤버** | 모임방 소속 사람 | 신규 `group_members` |
| **약속** | 한 번의 만남(11월 정기모임) — 일정·장소·확정 | 기존 `meetings` 그대로 |
| **참여자** | 특정 약속에 초대된 사람 | 기존 `participants` 그대로 |

지금 화면의 "모임방"이라는 이름은 사실 **약속** 화면이다. 2.0 에서는 문구를 "약속"으로 바꾸고, "모임방"은 새 개념에만 쓴다. 모임방 없이 만든 약속(일회성)은 지금과 똑같이 동작한다.

---

## 3. 새 구조로 바꿀 때 영향받는 기능

| 기능 | 영향 | 대응 |
| --- | --- | --- |
| 일회성 약속 생성·초대·응답 | 없음 | `meetings.group_id = null` 로 그대로 |
| 기존 초대 링크 `#/m/<id>?invite=` | 없음 | 라우트·RPC 유지 |
| 주최자·관리자 복구 | 없음(약속 단위) | 모임방 관리자는 별도 역할로 추가 |
| A/B 일정, 히트맵, 추천, 미응답 | 없음 | 충돌 표시만 **내 화면에** 덧씀 |
| 장소 | 분류 확장, 식당 필수 해제, 여러 방문지 | 기존 RPC 유지 + `_v2` 추가, 기존 `final_places` 보존 |
| 단계 표시 | 색 카드 → 스텝퍼 | 화면만 |
| 홈 | 약속 목록 → 다가오는 약속·응답할 약속·내 모임방 | 화면 + 조회 RPC |
| 캐릭터 | 모임방 배너에서 움직임 | 그림은 기존 4종 재사용, 프레임만 파생 |

---

## 4. DB 변경안 (모두 새 파일, 추가만)

실행 순서: `004 → 005 → 006`. 각 파일은 여러 번 실행해도 안전하게 작성한다. 앞 단계 SQL 이 실행되지 않아도 지금 앱은 그대로 동작해야 한다(새 화면만 "설정 필요" 안내).

### 004_groups.sql — 모임방·멤버
```
groups(id, name 1~40, description ≤200, theme in ('picnic','beach','cafe','night'),
       created_by uuid, archived_at, version, created_at, updated_at)
group_members(id, group_id, display_name 1~20, user_id null, role in ('admin','member'),
              sort_order, removed_at null, created_at,
              unique(group_id, display_name) where removed_at is null,
              unique(group_id, user_id) where removed_at is null and user_id is not null)
private.group_invites(id, group_id, member_id, token_hash unique, expires_at, consumed_at, revoked_at)
meetings.group_id uuid null → groups(id)            -- 일회성 약속은 null
participants.group_member_id uuid null → group_members(id)
```
- **멤버 ≠ 참여자**: 약속을 만들 때 고른 멤버만 `participants` 로 복사(`group_member_id` 연결). 멤버가 모든 약속에 자동 참여하지 않는다.
- **한 번만 초대**: 멤버가 모임방 초대를 수락하면(`group_members.user_id`) 트리거가 그 멤버와 연결된 **아직 미연결인 참여자 행**에도 같은 `user_id` 를 채운다. 이후 새 약속은 이미 연결된 멤버에게 초대 링크 없이 바로 보인다. 미연결 멤버만 약속 초대 대상.
- **읽기 권한(RLS)**: `private.is_group_member(gid)` = 제외되지 않은 연결 멤버. `groups`·`group_members` 는 멤버만 읽는다. **약속 상세(`meetings`, 응답 표)는 지금처럼 참여자·주최자만** — 모임방 멤버라도 그 약속 참여자가 아니면 응답·장소를 못 본다(목록 수준 정보는 아래 RPC).
- **RPC** (모두 권한 검사·`FOR UPDATE`·`version`):
  `create_group(name, description, theme, member_names[], my_index)` → 멤버별 초대 토큰(원문은 응답에만)
  `accept_group_invite(token)` · `reissue_group_invite(member_id)`(관리자) · `update_group(gid, name, description, theme, expected_version)`(관리자)
  `add_group_members(gid, names[])` · `remove_group_member(member_id)`(관리자, 소프트 삭제·과거 기록 유지, 마지막 관리자 제거 불가)
  `set_member_role(member_id, role)`(관리자, 관리자 0명 불가) · `leave_group(gid)` · `archive_group(gid)`(관리자, 되돌리기 가능)
  `create_group_meeting(gid, title, member_ids[], mode, times, days)` → 기존 `create_meeting_v2` 와 같은 검증, 연결된 멤버는 바로 연결, 미연결 멤버만 초대 토큰 반환
  `group_overview(gid)` → 모임방 화면용: 약속 목록(제목·상태·확정 일시·내 응답 상태·내가 참여자인지) — **참여하지 않은 약속은 제목·상태·날짜만**, 참여자 이름·장소는 주지 않음
- **약속 주최 권한**: 기본은 지금처럼 약속을 만든 사람. 모임방 관리자가 대신 확정할 수 있게 할지는 **결정 필요(§10)**.

### 005_calendar.sql — 통합 캘린더(내 정보만)
`my_calendar(p_from, p_to)` → 호출한 사람이 **참여자이거나 주최자인 약속만** 반환:
`meeting_id, title, group_id, group_name, group_theme, status, selected_start/end, my_state(pending|done|none), my_candidates`
- `my_candidates`: A 모드 = 내가 가능으로 고른 후보(없으면 전체 후보, 표시용 "후보"), B 모드 = 내가 고른 칸을 연속 구간으로 묶은 것.
- 다른 사람의 이름·응답·장소는 포함하지 않는다. 다른 사람의 캘린더를 조회하는 기능은 만들지 않는다.

### 006_places_v2.sql — 장소 유형·집결지·여러 방문지
- `place_candidates.kind`·`place_submissions.kind` 허용값을 `('meeting_point','restaurant','cafe','activity','attraction','etc')` 로 **넓히는** 제약 교체(기존 행은 restaurant/cafe 라 그대로 통과).
- `itinerary_stops(meeting_id, id, sort_order, kind, candidate_id null, name, address, latitude, longitude, map_url, planned_time null, note ≤100)` — 최종 방문 순서. 후보에서 고르거나(좌표 복사) 직접 입력.
- RPC: `submit_place_v2`(일정 확정 전에도 투표 가능 = **장소 먼저 정하기**), `set_itinerary(meeting_id, stops jsonb, expected_version)`(주최자, 0~10곳, 순서·시간), `finalize_meeting_v2(meeting_id, expected_version)` — **일정 확정만 필수**, 장소는 0곳도 가능(식당 필수 제한 해제).
- 기존 `finalize_meeting`·`final_places` 는 남겨 둔다(옛 화면·옛 약속 호환). 새 화면은 `final_places` 가 있으면 방문지 1·2번으로 함께 보여 준다.

### (선택) 007 — 계정 연결 이후 필요한 것만
§6 참고. 사용자 결정 전에는 만들지 않는다.

---

## 5. 기존 데이터·초대 링크 보존 방법
1. 기존 `meetings`·`participants`·응답·장소 행은 **변환하지 않는다**. 새 칸(`group_id`, `group_member_id`)은 null 이 기본 → 기존 약속 = 일회성 약속.
2. 기존 RPC 이름·인자·동작을 바꾸지 않는다. 새 동작은 `_v2`·새 이름으로 추가.
3. `private.is_member` 는 **바꾸지 않는다**(약속 상세 권한 그대로). 모임방 권한은 새 함수로 분리.
4. 라우트 `#/m/<id>`, `?invite=`, `?admin=` 유지. 새 라우트만 추가.
5. 단계마다 기존 테스트 35개를 공개 주소에서 다시 돌려 회귀 확인.
6. (선택) 기존 일회성 약속을 모임방으로 "옮기기"는 사용자가 명시적으로 할 때만(주최자 RPC `attach_meeting_to_group`) — 자동 변환 없음.

---

## 6. 사용자 계정과 모임방 식별

**지금**: 사람 = 브라우저별 익명 계정 1개. 같은 브라우저라면 여러 모임방·약속에서 **같은 사람으로 식별**된다(`auth.uid()` 공통) → 통합 캘린더·프로필은 이 구조로 바로 가능.

**한계**: 브라우저·기기가 바뀌면 다른 사람이 된다(카카오톡 안 브라우저 ↔ 사파리 포함).

**선택형 계정 연결(검토안, 미구현)**
- Supabase 는 **익명 계정에 Google·Kakao 로그인을 연결**하는 기능(`linkIdentity`)을 제공한다. 연결하면 **같은 `user_id` 가 유지**되므로 모임·권한·응답 이력이 그대로 남고, 다른 기기에서 같은 계정으로 로그인하면 복구된다.
- 필요한 준비: Supabase 대시보드에서 Manual linking 허용 + Google/Kakao 제공자 설정, Google Cloud·카카오 개발자 콘솔에 OAuth 앱과 리디렉션 주소 등록(사용자 작업, 키는 대시보드에만).
- 주의: 이미 **다른 익명 계정**으로 같은 Google 계정을 연결했다면 두 계정을 합치는 기능은 기본 제공되지 않는다 → 합치기 RPC(참여자·멤버·주최자 이전)를 별도로 설계해야 하며 위험도가 높아 2차 과제로 둔다.
- 초대 링크로 바로 참여하는 흐름은 그대로 두고, 계정 연결은 내 정보 화면에서 **선택**으로만 제공.
- UI 원칙: 실제로 동작하기 전에는 "계정 연결(준비 중)"으로만 표시한다.

---

## 7. 새 화면 구조와 라우팅

**하단 탭(고정)**: 홈 · 캘린더 · 모임방 · 내 정보 — 약속 화면 안에서는 지금의 상단 탭(홈·일정·장소·관리)을 유지하고 하단 탭은 숨겨 조작 영역을 확보.

| 라우트 | 화면 | 내용 |
| --- | --- | --- |
| `#/` | 홈 | 다가오는 약속(확정), 내가 응답해야 하는 약속, 내 모임방, `+ 만들기`(모임방 / 일회성 약속 선택) |
| `#/calendar` | 캘린더 | 월간 달력(모임방 색 점, 확정 ●/후보 ○/응답 필요 !), 날짜별 목록, 모임방 필터, 충돌 경고 |
| `#/groups` | 모임방 목록 | 테마 썸네일·멤버 캐릭터·다음 약속 |
| `#/groups/new` | 모임방 만들기 | 이름·설명·멤버·테마 |
| `#/g/<gid>` | 모임방 | 테마 배경 + 움직이는 멤버, 진행 중 약속, 다가오는 확정 약속, 지난 약속, `+ 새 약속` |
| `#/g/<gid>/new` | 모임방에서 새 약속 | 멤버 체크(기본 전원) → 기존 만들기 2단계(A/B) |
| `#/g/<gid>/settings` | 모임방 설정 | 이름·설명·테마, 멤버 초대·추가·제외·역할, 종료 |
| `#/g/<gid>?invite=` | 모임방 초대 수락 | |
| `#/new` | 일회성 약속 만들기 | 지금 그대로 |
| `#/m/<id>[/…]` | 약속 | 지금 그대로 + 스텝퍼, 충돌 표시, 장소 v2, 모임방으로 돌아가기 |
| `#/me`, `#/me/character`, `#/me/settings` | 내 정보 | 프로필, 캐릭터, 계정·기기 상태, 앱 설정(움직임 줄이기) |

**기존 기능 찾기**: 기존 약속은 홈의 "약속" 영역과 캘린더에서 그대로 보이고, 링크 주소는 바뀌지 않는다.

---

## 8. 기능별 상세 설계

### 8-1. 일정 충돌
- 규칙: 두 구간 `[a1,a2)`, `[b1,b2)` 가 `a1 < b2 && b1 < a2` 이면 겹침. 같은 날이라도 시간이 안 겹치면 표시 없음. 끝 시간이 없는 A 후보는 **1시간으로 가정**하고 "끝 시간 미정" 표시.
- 등급: 확정 약속과 겹침 → **경고**(코랄, "◆ 다른 확정 약속과 겹쳐요") / 다른 약속의 후보와 겹침 → **안내**(회색, "◇ 투표 중인 다른 약속과 겹칠 수 있어요") / 없음 → 표시 없음.
- A 모드: 후보 카드마다 배지. B 모드: 입력 시간표에 내 다른 확정 약속 칸을 **빗금 + "내 다른 약속"** 으로 표시(선택은 가능, 자동 불가 처리 없음).
- 계산 위치: 클라이언트(`lib/conflict.js`, 순수 함수 + 단위 테스트), 데이터는 `my_calendar` 의 **내 약속만**. 다른 사람에게는 충돌 여부도 보이지 않는다.
- 히트맵·추천·미응답 로직은 수정하지 않는다.

### 8-2. 장소
- 분류: 집결지(📍) · 식당 · 카페 · 놀거리 · 관광지 · 기타. 카카오 카테고리 코드로 추천 분류(FD6 식당, CE7 카페, AT4 관광명소, CT1 문화시설 → 놀거리 등), 사용자가 바꿀 수 있음.
- 후보·하트 투표·지도 마커는 유지, 분류 필터 칩 확장.
- 방문 순서: 주최자가 "일정표 만들기"에서 후보를 골라 순서(위·아래 버튼, 드래그 강제 안 함)와 시간(선택)을 정함. 최종 카드에 `13:30 📍 제주시청 앞 집결 → 14:00 🍽 … → 15:30 ☕ …`.
- 장소 먼저: 일정 확정 전에도 투표·방문 순서 지정 가능.

### 8-3. 진행 스텝퍼
`✓ 일정 ━━ ● 장소 ━━ ○ 약속 확정` — 아이콘(완료 초록 ✓ / 진행 블루 ● / 대기 회색 ○) + 아래 단계명·상태 글자, 연결선 색도 상태 반영. 순서를 강제하지 않는 **완성 상태 표시**: 일정 = 확정 여부, 장소 = 방문지 1곳 이상 또는 "장소 없음" 선택, 확정 = 최종 확정. 375px 에서 한 줄(아이콘 32px, 라벨 12px).

### 8-4. 모임방 테마
4종(피크닉·바다·카페·밤하늘)을 **코드로 그린 픽셀 배경**(SVG, 기존 하늘·잔디 배너와 같은 그림체, 캐릭터 12×16 과 같은 픽셀 크기)으로 시작 → Figma 시안이 오면 이미지로 교체 가능한 구조(`assets/themes/index.js` 의 `THEME_IMAGES`). 사용자 업로드(Supabase Storage)는 별도 확장.

### 8-5. 캐릭터 모션
- 그림은 기존 4종 그대로, 프레임만 코드로 파생: 눈 감기(E→S), 걷기(다리 2행 교차), 점프(위로 2px).
- 동작: 대기(1px 들썩임), 깜빡임(3~6초 랜덤), 좌우 걷기(레인 안에서만, 다른 캐릭터와 최소 간격), 가끔 점프, 약속 확정 시 단체 점프 + 픽셀 반짝이.
- 구현: CSS `transform` 애니메이션 + 낮은 빈도 `requestAnimationFrame`(초당 위치 갱신 최소화), 배너가 화면 밖이거나 탭이 숨겨지면 정지, 동시에 움직이는 캐릭터 최대 8명.
- `prefers-reduced-motion` 또는 내 정보 > 앱 설정 "움직임 줄이기"(기기 저장) → 정지 캐릭터.
- 배너 영역 안에서만 움직이고 `pointer-events: none`, 버튼·정보 위로 올라오지 않음.
- **소속 ≠ 응답**: 모임방 배너 캐릭터는 "멤버"만 의미. 응답 상태(⏰/✓/✕)는 약속 화면에서만 표시.

---

## 9. Figma 에서 디자인할 화면
1. 하단 탭 바 + 홈(다가오는 약속·응답 필요·내 모임방)
2. 통합 캘린더(월간 + 날짜 목록 + 필터 + 충돌 경고 배지)
3. 모임방 목록 · 모임방 만들기(테마 선택)
4. 모임방 메인(테마 배경 4종 × 움직이는 캐릭터, 약속 리스트 3구간)
5. 모임방 설정(멤버 관리·역할·초대·종료 확인 다이얼로그)
6. 모임방에서 새 약속(멤버 선택)
7. 약속 화면 스텝퍼 · 충돌 배지(A 카드 / B 시간표)
8. 장소 v2(분류 칩 6종, 집결지, 방문 순서 편집, 최종 일정표 카드)
9. 내 정보(앱 설정, 계정 연결 "준비 중" 상태)
10. 테마 배경 일러스트 4종(캐릭터와 같은 픽셀 크기)

---

## 10. 결정이 필요한 사항
1. **모임방 멤버가 참여하지 않은 약속을 어디까지 볼 수 있나** — 제안: 제목·상태·날짜만(응답·장소·참여자 이름 비공개).
2. **모임방 관리자의 약속 권한** — 제안: 약속 확정·초대 재발급은 약속 주최자만(지금과 동일). 관리자 대행은 2차.
3. **멤버 제외 시 과거 약속** — 제안: 과거 참여 기록·응답은 유지, 모임방과 앞으로의 약속에서는 빠짐.
4. **계정 연결(Google·Kakao)** — 진행 여부와 시점. 진행하면 OAuth 앱 등록(사용자 작업) 필요.
5. **작업 환경 분리** — 제안: ① 프로젝트에 Git 시작(되돌리기·이력), ② 개발용 Worker `moiddak-dev` 를 따로 두고 단계마다 거기에 먼저 배포 → 승인 후 `moiddak` 에 배포. DB 는 같은 Supabase 를 쓰되 마이그레이션은 추가만이라 운영 화면에 영향 없음.

---

## 11. 단계별 구현 계획과 테스트 기준

| 단계 | 내용 | SQL | 완료 기준(테스트) |
| --- | --- | --- | --- |
| **1. 모임방·약속 분리** | 004, 모임방 만들기·목록·메인(정적 배경)·설정(멤버·역할·초대), 모임방에서 약속 만들기(멤버 선택), 약속 화면에 "모임방으로" | 004 | 새 `tests/groups.mjs`: 생성·초대 수락·**한 번 수락하면 다음 약속 자동 연결**·멤버≠참여자·비멤버 조회 0행·멤버 제외·마지막 관리자 보호·참여하지 않은 약속 상세 비공개. 기존 35개 통과 |
| **2. 프로필·통합 캘린더** | 005, 하단 탭 `캘린더`, 월간·날짜 목록·모임방 필터, 홈 재구성 | 005 | `tests/calendar.mjs`: 내 약속만 반환·타인 약속 0건·확정/후보/응답 필요 구분, 화면 캡처 |
| **3. 일정 충돌** | `lib/conflict.js`, A 카드 배지, B 시간표 표시, 캘린더 경고 | – | 단위: 14:00~16:00 vs 15:00~17:00 경고, 14~16 vs 16~18 없음, 확정/후보 등급, 끝 시간 없음 처리. 자동 불가 처리 없음 확인 |
| **4. 장소 v2** | 006, 분류 6종·집결지·방문 순서·시간, 장소 먼저, 식당 필수 해제 | 006 | `tests/places_v2.mjs`: 기존 약속·`final_places` 호환, 확정 전 투표, 0곳 확정, 순서 저장·권한, 위험 링크 거부 |
| **5. 스텝퍼·내비게이션** | 스텝퍼, 하단 탭, 문구 "약속/모임방" 정리 | – | 375px 넘침 없음, 기존 라우트·초대 링크 동작, 키보드 이동 |
| **6. 테마·모션** | 테마 4종, 모션, 움직임 줄이기 | – | reduced-motion 정지, 배너 밖 이동 없음, 버튼 가림 없음, 저사양 확인(애니메이션 중 프레임 저하 측정) |
| **7. 마무리** | 모바일·접근성·보안 점검, 실기기·사용자 테스트 | – | 전 테스트 공개 주소 통과, `docs/REAL_DEVICE_TEST.md` 갱신, 사용자 기록지 |

각 단계는 **SQL(사용자 실행) → 코드 → 로컬 미리보기 → 테스트 → 캡처 보고 → 승인 후 배포** 순서로 진행한다. 단계 보고에는 "구현됨 / 테스트 통과 / 실사용자 미검증 / 남은 문제"를 구분해 적는다.
