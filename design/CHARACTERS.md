# 모이딱 도트 캐릭터 — 에셋 검수 결과와 꾸미기 설계

> 대상: `moiddak_pixel_character_kit_v1.zip` (2026-11-07) · 수정본: `design/pixel-kit-v1.1/` · 앱 적용본: `public/assets/characters/`
> 미리보기: `design/previews/` (전후 비교 8배, 크기별, 앱 화면 캡처)

## 1. 검수 결과

자동 검사(PIL): 파일 손상 · 크기 · 투명도(반투명 픽셀 유무) · 2/4/8배 이미지의 블록 균일성과 원본 일치 · SVG↔PNG 칸 단위 비교 · 프리셋 파츠 합성 = 완성본 여부. 이후 8배 격자로 직접 확인.

| 대상 | 판정 | 내용 |
| --- | --- | --- |
| `base/*_24x32.png`, `*_2x/4x/8x.png` (16개) | 파일은 정상 / **그림 3종 수정 필요** | 손상·반투명 없음, 배율본은 원본과 픽셀 단위로 같음. 깨져 보인 원인은 아래 파츠 문제 |
| `svg/*.svg` (4개) | 정상 | viewBox 24×32, 정수 좌표 rect 만, PNG 와 전 칸 일치 |
| `parts/` 96개 | 대부분 정상 | 모두 24×32 같은 캔버스, 반투명 없음, 레이어 순서대로 겹치면 완성본과 0픽셀 차이 → **조합형 구조로 사용 가능** |
| `parts/face/happy.png` | **수정 필요** | 두 눈이 같은 방향 대각선 2픽셀(`\ \`) → 화난/✕ 눈처럼 보임. 민트·핑크·옐로우가 사용 |
| `parts/hair_front/spiky_*` (6색) | **수정 필요** | 이마 위 3×2 가닥 덩어리가 머리와 떨어져 "큰 민트색 눈"처럼 보임 |
| `parts/hair_front/fluffy_*` (6색) | **수정 필요** | 머리 바깥 오른쪽에 떨어진 3×3 머리카락 덩어리 |
| `parts/hair_front/long_*` (6색) | **수정 필요** | 옆머리가 얼굴 안쪽 1칸까지 들어와 오른쪽 눈을 가림(원본 핑크가 찡그린 얼굴로 보인 원인) |
| 프리셋 `pink` | **수정 필요** | 이름은 핑크인데 갈색 머리 + 크림 모자 → 정체성 불일치 |
| `parts/accessory/cap.png` | 수정 필요(미사용) | 상자처럼 머리를 덮음. 기본 4종에서 사용하지 않음 |
| `parts/hair_*/bun_*` | 정상(주의) | 옆 번이 위로 붙은 디자인, 외곽선 연결됨. 기본 4종에서 미사용 |
| `status/*.png` (4개) | **사용 불가** | 반투명 테두리(안티앨리어싱). 앱은 기존 CSS 상태 배지(점·글자·기호)를 유지 |
| `preview/characters_overview.png`, `customizer_demo.html` | 참고용 | 데모는 로컬 파츠만 겹쳐 보는 정적 페이지(외부 통신 없음) |

**확대 문제**: 키트 파일 자체는 선명하다. 앱에서는 `image-rendering: pixelated` + **24px 정수배(24·48·72) 크기로만 표시**해 흐림을 막는다(`ui/Avatar.js` 의 `snap`).

## 2. 수정·생성한 에셋

`design/pixel-kit-v1.1/` (원본 v1 은 그대로 두고 사본 수정, 변경 목록은 `characters.json` 의 `fixes_v1_1`)
- `face/happy.png`: 좌우 대칭 웃는 눈(∩), 기본 표정과 같은 중심선
- `hair_front/spiky_*.png` 6개: 머리선에서 이어지는 짧은 뾰족 앞머리
- `hair_front/fluffy_*.png` 6개: 떨어진 덩어리 제거
- `hair_front/long_*.png` 6개: 옆머리 안쪽 1칸 축소
- 프리셋: 민트(spiky_mint·happy) · 핑크(long_pink·default 표정·리본) · 블루(bob_navy·남색 상의·헤드폰) · 옐로우(fluffy_blonde·happy·안경)
- `base/` · `svg/` 재생성

`public/assets/characters/` (앱에서 사용)
- `mint|pink|blue|yellow.png` 24×32 원본, `@2x.png` 48×64 표시용, `@4x.png` 96×128 미리보기용, `.svg`
- 모두 투명 배경, 알파 0/255 만(반투명 없음)

## 3. 앱 적용 방식
- `assets/characters/index.js` `IMAGE_OVERRIDES` 에 4종 PNG 연결. 이미지를 못 불러오면 기존 코드 도트로 대체.
- 캐릭터 배정: 모임 안 참가 순서대로 민트→핑크→블루→옐로우 반복(4명까지 서로 다름). 꾸미기 저장값이 생기면 그 값을 우선.
- 상태 표시는 그대로: 미응답 = 회색 + ⏰ 배지, 응답 완료 = ✓ 배지, 가능 시간 없음 = ✕ 배지, 모두 상태 글자 병기. 캐릭터 색만으로 상태를 나타내지 않음.

## 4. 캐릭터 꾸미기 설계 (아직 구현 안 함)

**원칙**: 기본 캐릭터가 자동 배정되므로 꾸미기는 건너뛸 수 있다. 응답·초대 흐름과 분리한다.

**데이터** (추가 마이그레이션 `003_avatar.sql` 예정, 기존 표·행 보존)
- `participants.avatar jsonb null` — 예: `{"v":1,"hair":"long_pink","skin":"peach","face":"default","top":"coral","bottom":"navy","accessory":"bow"}`
- `set_my_avatar(p_meeting_id, p_avatar jsonb)` RPC: 본인 참가자 행만, 허용된 파츠 키(`characters.json` 의 `part_choices`)만 통과, 크기 제한. 확정 이후에도 변경 허용(일정·장소와 무관).
- 사람 단위로 여러 모임에 같은 캐릭터를 쓰려면, 익명 세션 기준 `profiles(user_id, avatar)` 를 따로 두고 모임 참가 시 복사하는 방식을 검토.

**파츠 체계** (24×32 같은 캔버스, 레이어 순서 `hair_back → bottom → skin → top → face → hair_front → accessory`)
- 헤어: 스타일 6(bob·bun·fluffy·long·side·spiky) × 색 6(mint·brown·navy·blonde·pink·black)
- 피부 4 · 표정 4(default·happy·wink·sleepy) · 상의 6 · 하의 4 · 액세서리 6(none·cap·headphones·glasses·bow·star)
- 앱 합성: `<canvas>` 에 24×32 로 겹친 뒤 정수배로 표시하거나, 같은 크기 `<img>` 를 겹쳐 쌓기(`image-rendering: pixelated`). 결과를 캐시.

**필요한 추가 작업**
1. 남은 파츠 전수 검수(모든 헤어×표정×액세서리 조합에서 눈·얼굴 가림 확인), cap 재작업
2. `003_avatar.sql` 작성·실행(사용자 실행), RPC 테스트(본인만·허용 키만)
3. 꾸미기 화면(Figma 시안 기준): 미리보기 + 파츠 탭 + "기본으로" + "건너뛰기"
4. `Sprite` 가 `person.avatar` 를 받으면 레이어 합성, 없으면 기본 4종
5. 공개 주소 배포 후 실기기에서 선명도 확인(기기 배율 2.625 처럼 정수가 아닌 화면은 미세한 픽셀 크기 차이가 날 수 있음)
