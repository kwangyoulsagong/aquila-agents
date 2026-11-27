# Aquila Agents 디자인 시스템

> English: [../en/DESIGN-SYSTEM.md](../en/DESIGN-SYSTEM.md)

창 하나, 에이전트 여러 개. UI는 터미널 뒤로 물러나 있다가 에이전트가 나를 필요로 할 때만 말을 겁니다.

- 기준 파일: `design-system/tokens.css` (값), `design-system/components.css` (컴포넌트 스타일),
  `design-system/react/` (그 스타일을 그리는 React 컴포넌트).
- 미리보기: `open design-system/preview.html` (`?theme=light` 또는 `?theme=dark`로 강제).
- 규칙: **앱 코드에 hex/px 직접 쓰지 않기.** 새 값이 필요하면 원시 토큰 + 시맨틱 토큰부터 추가.

## 원칙

1. **터미널이 주인공.** 사이드바·탭은 조용하게. `--color-bg-canvas`(창 + 터미널)는 다크에선 가장 어두운 면,
   라이트에선 가장 밝은 면이라 터미널이 항상 크롬과 구분돼요.
2. **크게 말하는 색은 상태뿐.** 파랑 = 선택/포커스. 주황(`--color-status-waiting`)은 "내가 뭔가 해야 함" 전용, 장식 금지.
3. **하나의 그리드.** 모든 값은 4px 배수, 영역 사이 가장자리 정렬 (아래 레이아웃 참고).
4. **다크와 라이트는 기본적으로 macOS를 따라감.** ⚙ 화면 모드(시스템 / 라이트 / 다크, `config.theme`)가 Electron의
   `nativeTheme.themeSource`를 정해요. `src/shared/lib/theme.ts`가 `prefers-color-scheme`(Electron이 `nativeTheme`을
   연결)로 `<html data-theme>`를 정해요. `tokens.css`는 `[data-theme='light']`에서 **`--color-*`만** 재매핑해요.
   컴포넌트는 테마로 분기하지 않아요. 새 색 토큰은 두 블록 모두에 값이 있어야 해요. `AQUILA_THEME=light|dark`로
   강제할 수 있어요(스모크, 캡처, 확인용).

## 토큰 2단 구조

| 단계 | 접두사 | 누가 쓰나 |
|---|---|---|
| 원시(Primitive) | `--p-*` (`--p-slate-950`, `--p-blue-400`, `--p-size-8`) | `tokens.css`의 시맨틱 블록**만** |
| 시맨틱(Semantic) | `--color-*` `--font-*` `--space-*` `--radius-*` `--size-*` `--motion-*` | 모든 컴포넌트와 앱 코드 |

확인: `grep -rn -- '--p-' src design-system/components.css` 결과에 규칙 주석 한 줄만 나와야 함.

## 색 (시맨틱)

| 토큰 | 용도 |
|---|---|
| `--color-bg-canvas` | 창 + 터미널 배경 |
| `--color-bg-surface` | 사이드바, 탭바, 패널 |
| `--color-bg-hover` / `--color-bg-pressed` | 호버 / 눌림·선택 |
| `--color-bg-selected` | 현재 프로젝트 행 |
| `--color-bg-scrim` | 다이얼로그 뒤 배경 |
| `--color-border-subtle` / `-default` / `-focus` | 구분선 / 컨트롤 테두리 / 포커스 링 |
| `--color-text-primary` / `-secondary` / `-tertiary` / `-on-accent` | 글자 단계 (tertiary는 힌트 전용) |
| `--color-meter-track` / `-outline` | 사용량 게이지: 빈 막대 / 한도를 모를 때 테두리 (라이트에선 더 진하게 — bg-pressed, border-subtle은 사이드바에 묻혀요) |
| `--color-action-primary(-hover)` | 주요 버튼 |
| `--color-agent-claude` / `-codex` / `-shell` | 세션 종류 |
| `--color-account-shared` / `-personal` | Claude 계정 배지 (`claude` / `claude-personal`) |
| `--color-graph-note` / `-tag` / `-code` / `-missing` / `-other` / `-edge` / `-focus` | 지식 그래프 캔버스 (T66): 노드 종류, 연결선, 선택한 노트. WebGL은 CSS를 못 읽어서 패널이 `getComputedStyle`로 값을 읽고, 테마가 바뀌면 다시 읽음 |
| `--color-graph-group-1` … `-8` | 묶음으로 칠한 전체 지도 (T72): 가장 큰 묶음 8개, 큰 순서(파랑, 피치, 청록, 보라, 초록, 분홍, 노랑, 빨강. 어두운 테마 `-300` / 밝은 테마 `-600`·`-700`). 나머지 묶음은 `--color-graph-missing` |
| `--color-callout-note` / `-tip` / `-important` / `-warning` / `-caution` (+ `-bg`) | 노트 콜아웃 카드 (T82, `> [!KIND]`): 테두리·아이콘·라벨 색, `-bg`는 카드 바탕 (파랑, 초록, 보라, 주황, 빨강. 어두운 테마 `-400`/`-300`, 밝은 테마 `-600`) |
| `--color-diff-*` | diff 추가 / 삭제 / 헝크 |
| `--color-terminal-*` | xterm 테마 (실행 중에 읽고, 테마가 바뀌면 다시 읽음): 배경, 글자, 커서, 선택, 스크롤바(+ `-hover`), 찾기 일치 `-match` / `-match-active`(불투명 `#RRGGBB` — xterm 데코레이션이 요구; 호박색). 라이트에선 xterm `minimumContrastRatio`를 4.5로 둬서 다크 배경용으로 고른 CLI 색도 읽혀요 |

### 세션 상태 — 앱의 핵심 언어

| 상태 | 토큰 | 의미 | 출처 |
|---|---|---|---|
| working | `--color-status-working` (깜빡임, 동작이 꺼지면 반쯤 찬 원) | 에이전트 작업 중 | OSC 7501 `working`, Claude hooks, 보고하지 않는 프로그램은 출력 활동 |
| waiting | `--color-status-waiting` (후광) | 나를 기다림: 권한 승인이나 질문 | OSC 7501 `blocked`, Claude hook `PermissionRequest` / `Notification` |
| done | `--color-status-done` (체크가 뚫린 원) | 끝났고 아직 안 봄 | OSC 7501 `done`, Claude hook `Stop` |
| done (추정) | `--color-status-done-estimated` (`data-estimated`, 흐린 체크) | 아마 끝남: 출력이 조용해져서 추측 | 출력 활동 (보고하지 않는 codex/셸) |
| error | `--color-status-error` (`!`가 뚫린 둥근 사각형) | 실패: API 오류(사용량 제한·로그인·결제·서버)나 0이 아닌 종료. 이유는 점의 라벨 | OSC 7501 `error`, Claude hook `StopFailure`, pty 종료 코드 |
| stopped | `--color-status-stopped` (고리) | 내가 멈춤(Esc / Ctrl+C) 또는 정상 종료 | 입력한 키, `SessionEnd`, 종료 코드 0 / 130 |
| idle | `--color-status-idle` | 아무 일 없음 / 이미 봄 | 기본값 |
| live | `--color-status-done` (그냥 원) | 떠 있는 프로세스 — Run 슬롯 전용(T60), 세션 상태는 아님 | 실행 시작, 아직 안 끝남 |

상태마다 모양도 달라서 파랑·초록·빨강을 구분하지 못해도 읽힌다: 깜빡임, 후광, 체크, `!` 사각형, 고리, 그냥 원. 동작이 꺼지면(동작 줄이기, 절전) working은 깜빡일 수 없어서 대신 반쯤 찬 원으로 보인다. 체크와 `!`는 알파 마스크로 뚫어서(뒤 배경이 비쳐 두 테마 모두 맞음) `--size-dot-sm`에서도 알아볼 수 있다. `preview.html`에 모든 상태를 두 크기, 컬러와 회색조로 보여 주고, 동작 끄기 토글이 있다.

프로젝트 행은 세션 중 가장 급한 상태를 보여줍니다: `waiting > error > working > done > stopped > idle`.

## 글자

- UI: 시스템 폰트 (SF Pro + Apple SD Gothic Neo). 고정폭: JetBrains Mono (번들), 한글은 D2Coding 대체.
- `--font-size-caption` 11 (메타, 라벨) · `-label` 12 (탭, 버튼) · `-body` 13 (본문, 터미널) · `-title` 15 · `-heading-1/2/3` 20 / 17 / 15 (노트 에디터 제목, T67).
- 노트 문서 (T82, 라이브 프리뷰를 문서처럼): `--font-size-doc-body` 15 (`--line-height-doc` 1.6 → 24) · `-doc-code` 13 (`--line-height-code` 1.55) · `-doc-title` 28 (첫 H1, 없으면 이름) · `-doc-h1/h2/h3/h4` 24 / 20 / 17 / 15 (`--line-height-heading` 1.3, 자간 -0.01em, 제목 -0.02em).
- 섹션 라벨: 11 / 600 / 대문자 / 0.06em / `--color-text-tertiary`.

## 간격·모서리 (역할별)

`--space-inline-xs|sm` 4|8 (한 줄 안 요소 사이) · `--space-inset-sm|md` 8|12 (안쪽 여백) · `--space-stack-md|lg` 16|24 (그룹/섹션 사이) · `--space-stack-xl` 32 (문서 둘레: 노트 에디터 본문, T82).
`--radius-badge` 4 · `--radius-control` 6 · `--radius-container` 10.

## 레이아웃 — 하나의 그리드, 맞춘 가장자리

```
 x=0        x=20                 x=248
 ┌──────────┬────────────────────┬─────────────────────────────────────────────┬──────────────┐  y=0
 │ ● ● ●    (신호등 버튼)          │ [● Claude 공용 ×] [● Codex ×] +   [공용|개인] │ 패널 헤더     │
 ├─────────────────────────────── ┼──────────── y=40 한 줄로 이어짐 ─────────────┼──────────────┤  y=40  (--size-titlebar = --size-tabbar)
 │   회사                (라벨 16) │ ● Claude · data-bahn  (패널 헤더 28)          │              │
 │   ● data-bahn   2   (행 32)    │ ❯ 터미널 글자는 패널 + 12에서 시작              │  패널 416     │
 │   개인                          │                                             │              │
 │   ● SALT        1              │                                             │              │
 ├────────────────────────────────┤                                             │              │
 │ 설정 파일 열기         English  │                                             │              │
 └────────────────────────────────┴─────────────────────────────────────────────┴──────────────┘
   사이드바 248 · 내용 기준선 x=20 (8 + 12): 라벨, 상태 점, 하단 글자가 모두 여기서 시작
```

| 토큰 | px | |
|---|---|---|
| `--size-titlebar` = `--size-tabbar` | 40 | 사이드바·탭·패널을 가로지르는 한 줄 |
| `--size-window-controls` | 0 / 140 | 오른쪽 위 OS 창 버튼 자리: macOS 0, `:root[data-platform='win32']`에서 140 (맨 오른쪽 열의 탭 바 / 패널 헤드가 그만큼 비움) |
| `--size-traffic-lights` | 80 / 0 | 맨 타이틀 띠(`.c-titlebar`) 왼쪽의 macOS 신호등 버튼 자리; Windows는 0 |
| `--size-row` | 32 | 사이드바 행, 탭도 32 (40 − 위 여백 8) |
| `--size-control` | 28 | 버튼, 세그먼트 컨트롤 |
| `--size-pane-head` | 28 | 분할 패널 헤더 |
| `--size-focus-line` | 2 | 포커스된 패널 헤더 아래 강조선 (패널의 유일한 포커스 표시) |
| `--size-split-handle` | 8 | 분할 구분선을 잡는 영역, 1px 선 가운데 |
| `--size-badge` / `--size-dot` | 16 / 8 | |
| `--size-ext-icon` | 16 | 확장 자체 그림(매니페스트 `icon`) — 칩과 패널 이름 |
| `--size-meter` | 4 | 미터 막대 (사용량 게이지) |
| `--size-ring` | 12 | 탭 안의 링 미터 (컨텍스트 게이지) |
| `--size-sidebar` / `--size-panel` | 248 / 416 | |
| `--size-panel-wide` | 720 | 나란히 보기 때 변경사항 패널(창의 절반까지) |
| `--size-panel-min` / `--size-stage-min` | 288 / 480 | 옆 패널의 최소 폭 / 터미널 열이 지키는 폭. 패널이 먼저 줄어든다(T49) |
| `--size-pick-list` | 224 | 고르기 목록이 스크롤되기 전 높이(7줄, 원격 폴더, T56) |
| `--size-diff-gutter` / `--size-diff-comment` | 40 / 384 | diff의 줄 번호 칸 하나 / 줄 코멘트 상자 |
| `--size-dialog` / `--size-dialog-wide` | 440 / 560 | 다이얼로그 너비 / 체크리스트가 있는 다이얼로그(첫 실행) |
| `--size-palette` / `--size-palette-list` | 560 / 352 | 명령 팔레트 너비 / 스크롤 전 목록 높이(11줄) |
| `--size-find-input` | 200 | 터미널 찾기 바의 검색어 입력 칸 (T40) |
| `--size-range` | 96 | 범위 슬라이더 (디자이너 비교 투명도, T62) |
| `--size-modal` / `--size-modal-height` / `--size-modal-aside` | 760 / 520 / 240 | 목록 + 상세 모달(가이드, 릴리즈 노트) / 목록 열 너비 |
| `--size-modal-wide` / `--size-modal-wide-height` / `--size-modal-wide-aside` | 960 / 640 / 320 | `.c-modal--wide` (세션 기록: 긴 행, 대화 미리보기) / 목록 열 너비 |
| `--size-editor-measure` / `--size-editor-side` | 720 / 240 | 노트 에디터 (T67): 전체 창에서 본문 한 줄 최대 너비 / 목차·링크 열 너비 |
| `--size-doc-check` | 16 | 노트 문서 (T82): 할 일 체크박스, 콜아웃 아이콘 |
| `--size-explorer` / `--size-tree-row` / `--size-tree-indent` | 256 / 24 / 12 | 노트 탐색기 (T83): 파일 트리 열 / 트리 한 줄(촘촘하게, 목록은 가상화) / 폴더 한 단계 들여쓰기 |
| `--size-card-list` | 224 | 그래프 카드: 제안된 연결 목록이 스크롤되기 전 높이 (T68) |
| `--size-board-column` / `--size-code-input` | 256 / 224 | 보드 보기의 열 너비 / 텍스트로 고치는 설정의 높이 (T69) |
| `--size-focus-row` / `--size-focus-center` / `--size-focus-gap` | 40 / 208 / 48 | 그래프 주변 보기 (T72): 항목 하나(라벨 + 메타 줄) / 가운데 카드 / 두 열 사이 선이 지나갈 자리 |
| `--size-bubble-min` / `--size-bubble-max` | 24 / 64 | 그래프 지도 묶음 (T73): 가장 작은 / 큰 묶음의 원 반지름 (√개수 비례) |
| `--size-bar-field` | 224 | 패널 막대 안의 검색창 (T76): 버튼 옆 남는 폭을 쓰고, 이보다 좁을 때만 한 줄을 차지 |
| `--size-props-key` / `--size-ntable-title` / `--size-ntable-col` | 128 / 288 / 160 | 속성 패널의 키 열 / 표 보기의 제목 열 / 속성 열의 최소 너비 (T78) |

## 컴포넌트 (`components.css`)

| 클래스 | 내용 |
|---|---|
| `.c-dot[data-status]` | 상태 점 |
| `.c-btn` `--primary` `--ghost` `--icon`, `__badge` | 버튼. `__badge` = 아이콘 버튼 모서리의 작은 강조 점, "새로운 것 있음"(AI 트렌드: 더 새 CLI). 상태 점 아님 |
| `.c-segment`, `__item[aria-checked]` | 세그먼트 컨트롤 (계정 전환) |
| `.c-range` | 강조색 네이티브 슬라이더 (디자이너 비교 투명도) |
| `.c-kbd` | 단축키 표시 |
| `.c-elapsed` | 세션이 기다린 시간("12분", 고정폭, 대기 색) — 탭·프로젝트 행 |
| `.c-reason` | 대기 중인 세션이 기다리는 것("Bash: npm install"). 프로젝트 행 아래 한 줄(고정폭 캡션, 이름과 정렬). 누르면 그 세션을 보여 주는 버튼. `data-risk` = 파괴적일 수 있음: 오류 색 + `.c-risk` |
| `.c-queue`, `__lead` `__text` `__title` `__meta` | 사이드바 대기열 항목(리뷰 대기열, T58): 점, 제목, 고정폭 캡션 메타 줄(둘 다 말줄임). `.c-row`와 같은 가장자리. 버튼 |
| `.c-risk` | 파괴적일 수 있는 명령의 경고 기호(⚠, 오류 색) — 대기 이유 줄과 탭 |
| `.c-graph`, `__node[data-mark]` `__box` `__label` `__detail` `__mark` `__edge` `__column` | 정적 SVG 노드 그래프(레포 뼈대, T64; 지식 그래프도 같은 모양): 호출자가 배치한 상자, 곡선 간선. 테두리 없이 면 색으로 채운 상자, 색은 바뀌는 곳에만: add = 초록 면 + 채운 점, change = 파란 면 + 고리 점, unfit = 점선 테두리 + 취소선. 표시된 상자가 있으면(`.c-graph[data-marked]`) 표시 없는 라벨은 secondary로 물러남. 호버한 단계용 `data-dim` / `data-highlight`. 애니메이션 루프 없음 |
| `.c-editor`, `__main` `__host` `__side` `__section` `__section-title` `__item` (`--level`) `__empty` `__banner[data-tone]` `__compare` | 노트 에디터 (T67): CodeMirror 자리 + 목차·링크 열, 위쪽 배너(warn = 대기 색 테두리). CodeMirror의 `.cm-*`와 라이브 프리뷰 표시 `.cm-md-*`(제목, 강조, 코드, 링크, `[[링크]]`, 체크박스, 인용·콜아웃, 구분선, 프런트매터, 렌더된 표)는 `.c-editor` 아래에서 토큰만으로 꾸밈. **문서 모양 (T82)**, 섹션 끝의 별도 블록: 가운데 본문 열(`--space-stack-xl` 여백, `note` 컨테이너가 560px 미만이면 `--space-stack-md`), 머리 `.cm-md-dochead`(H1이 없으면 `__doctitle`, `__docmeta` 폴더 · 수정 시각), `.cm-md-title`(첫 H1), 글머리 `.cm-md-bullet[data-depth]`, 그린 체크박스, 콜아웃 카드 `.cm-md-callout[data-callout]` `-start`/`-end` + `.cm-md-callout-kind`/`-icon`, 인용 `-start`/`-end`, 코드 카드 `.cm-md-codeblock` `-start`/`-end`/`-close`와 `.cm-md-codehead`(언어 + 복사), 표 카드(머리 행, 줄무늬, 가로 스크롤), 위키링크 알약. 읽기 모드는 `.cm-reading`(과 `.cm-md-blank`: 빈 줄을 반 높이로) |
| `.c-review__counts` `__add` `__del` `__meta` `__confirm` | 노트 변경 막대 (T80): diff 색의 `+12 −3 줄`, 흐린 시간, 부분 되돌리기 전 확인 문구 (`EditorBanner` / `DiffView` 덩어리 버튼 안) |
| `.c-noteid[data-state]` (defined · duplicate · unknown · loose), `.c-noteid-tip` `__title` `__meta` `__warn` `__link` `__status`, `.c-noteid-row` `__main` `__actions`, `.c-noteid-text` `__detail`, `.c-noteid-note[data-tone]` `__text` `__actions` | 요구사항 ID (T79): 노트 본문의 ID에 옅은 밑줄(모르는 ID = 점선, 중복 = 대기 색 물결, 정의 없음 = 점)과 호버 카드. "참조된 곳"과 링크 없는 언급(링크로 바꾸기)의 옆 열 줄 |
| `.c-suggest`, `__item` `__line[data-line=dotted|dashed]` `__text` `__label` `__why` `__actions` `__proposal[data-tone=warn]` | 링크 제안 (T68): 줄마다 제안된 연결 하나(선 견본, 상대 노드, 이유, ✓ / [[ / ×), 위에 제안·경고 줄(강조 / 대기 색 테두리). `GraphCard`는 `children`을 스크롤되는 `__card-body`로, `close`를 오른쪽 위에 고정된 `__card-close`로 받음(액션은 줄바꿈되고 닫기는 잘리지 않음). `GraphHint`(`.c-kgraph__hint`)는 같은 자리에 뜨는 닫을 수 있는 사용법 안내 |
| `.c-kfocus`, `__plane` `__links` `__link[data-line][data-state=hot|dim]` `__node[data-align=start|end|center][data-depth][data-state]` `__text` `__label` `__meta` `__head` `__more` | 그래프 주변 보기 (T72): `FocusStage`(스크롤되는 판, 아래에 SVG 선), `FocusNode`(열 가장자리의 점 + 한 줄 라벨과 메타. `end` = 점이 오른쪽, 왼쪽 열용 오른쪽 정렬. `center` = 테두리 있는 가운데 카드), `FocusHead`, `FocusMore`. 모든 상자 위치(`x`, `y`, `width`)는 호출하는 쪽이 정하고, 이동은 `--motion-medium`으로 움직인다. roving tabindex: `current`만 탭으로 간다. `data-live=<상태>`: 탭에 열린 세션, 점에 `--color-status-*` 테두리(작업 중은 깜빡임) |
| `.c-kgroups`, `__svg` `__link[data-lit|data-dim]` `__link-count` `__bubble[data-group=1–8][data-dim][data-selected]` `__disc` `__count` `__label` `__detail` `__hits` `__hint` | 그래프 지도 묶음 (T73): `GraphGroups` — 묶음마다 원 하나(위치·크기는 호출자, `--size-bubble-min/max`), 선 굵기는 묶음 사이 링크 수, 밝힌 선은 숫자 표시. 원은 버튼: 클릭 / Enter로 열고 ⌘ / Shift로 고름(`data-selected`). `hint`: 왼쪽 아래 조용한 한 줄 |
| `.c-kweek`, `__day` `__day-title` `__day-count` `__list` `__item` `__main` `__text` `__label` `__detail` `__live` `__time` `__side` `__burst` `__chevron` `__nest` | 그래프 "이번 주" (T74): `WeekList`는 무대를 채우고 스크롤, `WeekDay`(붙어 있는 제목 + 개수), `WeekItem`(색 점, 이름, 메타 줄, 시각. 줄을 누르면 열고, `side`는 마우스를 올리면 시각 위에 뜨는 두 번째 동작), `WeekBurst`(같은 분에 바뀐 여러 개를 한 줄로 접음. `aria-expanded`, 항목은 그 아래 들여씀) |
| `.c-kgraph__swatch[data-group=1…8]` | 전체 지도 묶음 색(`--color-graph-group-<n>`, T72). `GraphLegend` 견본이 `group`을 받음 |
| `.c-kgraph__trail`, `__lens`, `__results` / `__result`, `__foot` (`__foot-line` `__foot-title` `__foot-detail` `__foot-actions` `__foot-body`) | 그래프 스테이지 주변 (T72): `GraphTrail`(뒤로 + 경로, 마지막이 가운데), `GraphLens`(개수가 붙은 질문 칩. 눌림 = 밝힘, 0개 = 비활성), `GraphResults` / `GraphResult`(스테이지 위 검색 결과. mousedown으로 골라 입력창이 포커스를 유지), `GraphFoot`(스테이지 아래 가운데 노드의 한 줄 카드, 위로 펼쳐지는 영역) |
| `.c-steps`, `__item[data-off]` `__check` `__title` `__meta` | 체크하는 계획(T64): 체크박스 · 제목 + 배지 / 고정폭 파일 줄. 체크 해제한 단계는 흐려짐 |
| `.c-badge--verdict-apply` `--verdict-partial` `--verdict-skip` | 제안의 판정(done / waiting / tertiary) |
| `.c-badge` `--claude` `--codex` `--shell` `--account-shared` `--account-personal` `--risk` | 태그 (`--risk`: 한 번 더 볼 변경 파일, 대기 색 — T57) |
| `.c-badge--host`, `.c-badge__conn[data-conn=connecting\|connected\|reconnecting\|lost]` | 원격 호스트 이름(대문자로 안 바꿈)과 연결 점: 회색 / 초록 / 주황 깜빡임 / 빨강 (T29) |
| `.c-term-overlay__banner` `__banner-text` `__banner-meta` | 터미널 위쪽을 가로지르는 클릭 가능한 바, 빨간 테두리: 연결 끊김 + 카운트다운 + 동작 (T29) |
| `.c-term-find` `__input` `__count[data-empty]` | 터미널 오른쪽 위의 클릭 가능한 찾기 바: 검색어 · 개수(일치 없으면 빨강) · 대소문자 토글(`aria-pressed`) · 이전 · 다음 · 닫기; 비활성 버튼은 tertiary 색 (T40) |
| `.c-term-overlay__chips` `__chips-group` `__chips-label` `__chips-close` | 터미널 위쪽을 가로지르는 클릭 가능한 바(CLI 입력창은 안 가림): 라벨 붙은 프롬프트 칩 그룹 + 닫기 (Figma 링크 붙여 넣기, T34) |
| `.c-titlebar` `__title` `__actions` | 탭 바 높이의 맨 타이틀 띠, 드래그 가능, 왼쪽에 신호등 자리: 앞 요소 + 말줄임 제목 + 동작 (전체 창, T37) |
| `.c-label` | 섹션 라벨 |
| `.c-sidebar` `__drag` `__body` `__group` `__add` `__foot` `__lang`, `[data-drop-folder]` | 사이드바 (`__drag` = 상단 띠, 안의 컨트롤은 클릭 가능. `__add` = 목록 아래 "+ 프로젝트 추가" 텍스트 행. `[data-drop-folder]` = Finder 폴더를 끌어 올린 상태) |
| `.c-meter[data-tone=warn\|danger][data-unknown]` `__head` `__value` `__track` `__fill` `__caption` | 한도 대비 비율: 라벨 · 값, 4px 막대(회색 → 75% 이상 주황 → 90% 이상 빨강), 캡션. 한도를 모르면 테두리만 있는 빈 막대 (T30) |
| `.c-usage` `__head` `__est` `__account` `__bars` | 사이드바 푸터 위 사용량 띠: 계정마다 한 블록, 미터 두 개 나란히 (T30) |
| `.c-ring[data-tone=warn\|danger]` `__svg` `__track` `__fill` `__value` | 탭에 들어가는 12px 원형 미터, 값 글자는 선택; 회색 → 주황 → 빨강 (컨텍스트 게이지, T31) |
| `.c-row[aria-current]` `__name` `__meta` | 프로젝트 행 |
| `.c-row[data-drop=before\|after]` `[data-dragging]`, `.c-sidebar__group[data-drop]`, `.c-sidebar__empty` | 끌어서 순서 변경: 놓일 위치 선, 끄는 행은 흐리게, 빈 그룹도 놓을 수 있음 |
| `.c-tabbar` `__add` `__trailing`, `.c-tab[aria-selected]` `__title` `__branch` `__close` | 탭 (`__branch` = 워크트리 브랜치, mono, 먼저 잘림) |
| `.c-split`, `.c-pane[data-focused]` `__head` `__term` | 화면 분할 |
| `.c-split--free`, `.c-split__drop`, `.c-pane__title` `__close` | 앱의 화면 분할: 절대 배치 패널, 드롭 표시(영역 사이를 미끄러지듯 이동), 패널 헤더 제목 + 닫기 |
| `.c-split__divider[data-dir][data-active]`, `.c-split[data-resizing]`, `.c-pane__zoom[aria-pressed]` | 드래그 구분선(호버/드래그 시 강조선), 드래그 중 화면 전체 리사이즈 커서, 패널 헤더의 확대 토글 |
| `.c-panel` `__head` `__body` `__actions` `__section` `__note` `__bar` `__bar-end`, `.c-panel--wide` | 오른쪽 패널 (밀려 들어옴, 헤더는 탭 바처럼 창 드래그 영역); `__bar` = 헤더 아래 줄바꿈되는 컨트롤 띠; `--wide`는 나란히 보기용(창의 절반까지); 드래그한 폭은 `--panel-width`로, `[data-pinned]` = 마지막으로 조절한 패널은 폭을 지키고 다른 패널이 먼저 줄어든다 |
| `.c-resize[data-edge][data-active]` | 패널 가장자리 크기 조절(T49): 패널 구분선 위의 잡는 영역, 호버/포커스/드래그 시 강조선, 포커스 시 ←/→, 더블클릭하면 기본값 |
| `.c-preview` `__body` `__stage` | 프리뷰 패널 (T33, `.c-panel--wide` 위): stage 위치에 main이 네이티브 페이지 뷰를 올림. stage 자체 내용(빈 상태, 로드 오류)은 그 뷰가 숨었을 때만 보임 |
| `.c-diff` `__line--add/del/hunk/file/meta`, `__file[aria-current]`, `__num`, `__actions`, `__line[data-commentable][data-commented]`, `.c-diff--split` `__row` `__line--empty`, `__comment` `__comment-actions` | diff (한 줄: 가장 긴 줄만큼 넓어짐, 나란히: 줄바꿈되는 두 칸). 줄 번호 칸, 파일/hunk 줄의 작은 버튼, 코멘트 가능/있음 표시, 줄 아래 코멘트 상자 |
| `.c-change`, `__status[data-status]` `__path` `__dir` | 변경 파일 행: 색이 있는 git 상태 글자, 이름, 흐린 폴더 |
| `.c-btn--ghost[aria-pressed]` | 켜진 토글 버튼 |
| `.c-btn--labelled` `__glyph` `__label` | 글리프 + 텍스트 라벨(탭 바 변경·프리뷰, 프리뷰 DevTools). 탭 바가 640px 미만이거나 프리뷰 바가 400px 미만이면 라벨이 접히고 정사각 버튼이 된다(컨테이너 쿼리 `tabbar` / `panelbar`. 컨테이너 쿼리에는 커스텀 속성을 쓸 수 없어 길이를 직접 적는다) |
| `.c-empty` `__title` `__path` `__actions` | 빈 화면 |
| `.c-dialog` `__title` `__body` `__actions` `__check` `__code` `__form` | 모달 다이얼로그 (네이티브 `<dialog>`, 아래에서 떠오름) |
| `.c-palette` `__input` `__list` `__item[aria-selected]` `__leading` `__label` `__mark` `__hint` `__empty` `__foot` | 명령 팔레트 (화면 위쪽 네이티브 `<dialog>`, 떠오름): 입력칸은 타이틀 바 높이, 줄 32px, 매치된 글자 굵게 |
| `.c-dialog--wide` | 체크리스트용 넓은 다이얼로그 |
| `.c-modal--wide`, `__tools` `__group-label` `__item-meta` `__actions` `__note` (`--warn`) `__bullets` | 넓은 모달(세션 기록): 검색 아래 필터 줄, 행 묶음 위 폴더 이름, 행 끝 캡션(시간), 상세의 버튼 줄, 캡션 한 줄(주황 = 사라질 수 있는 것), 짧은 글머리 목록(릴리스의 "Added" 줄, T35) |
| `.c-meta` `__label` `__value` (`--mono`) | 이름 · 값 행 (폴더, 브랜치, ID) |
| `.c-commands`, `.c-command[data-state=ok\|error\|interrupted\|pending]` `__state` `__text` `__time` | 에이전트가 실행한 명령(T59): 끝난 방식을 모양과 색으로(✓ ✕ ■ …), 명령은 고정폭 한 줄(말줄임), 표시, 시간 |
| `.c-runs`, `.c-runs__item[aria-current]` `__name` `__state` | Run 슬롯 명령(T60): 한 줄에 하나, 점(`live` / 고리 / `!` / idle), 고정폭 이름, 상태. 현재 것은 강조. `.c-run`(패널), `__state`, `__reason`, `__log`가 패널 배치 |
| `.c-ext` `__pick` `__name` `__stage` `__review` `__text[--muted]` `__actions` | 확장 패널(T71): 고르기 바, 그 아래 main이 확장의 샌드박스 네이티브 뷰를 올리는 stage, 또는 켜기 전 권한 확인(`.c-meta` 목록 + 켜기). 떠 있는 동안에는 `__review`에 창 투명도 Range(전체 너비)와 토글 |
| `.c-ext-chips` | 사이드바 푸터 위 띠(T71): 확장이 `chip.set`으로 정한 글자를 보여 주는 라벨 고스트 버튼. 글리프(또는 확장의 `icon`, `.c-ext-icon`, 픽셀 그대로)가 20px 콘텐츠 선에 맞음 |
| `.c-transcript` `__message[data-role]` `__role` `__text` | 읽기 전용 대화: 누가, 그다음 쓴 그대로의 텍스트(줄바꿈); 사용자 메시지는 primary 색 |
| `.c-modal` `__head` `__title` `__subtitle` `__body` `__aside` `__search` `__list` `__item[aria-selected]` `__item-label` `__empty` `__main` `__heading` `__text` `__keys` `__foot` | 큰 목록 + 상세 모달 (네이티브 `<dialog>`, 떠오름): 머리와 검색칸은 타이틀 바 높이, 왼쪽 검색 목록, 오른쪽 상세 (가이드; 릴리즈 노트·트렌드와 공유) |
| `.c-media` `__frame` `__placeholder` | 스크린샷이나 짧은 루프용 16:10 틀, 없으면 자리표시 |
| `.c-shortcuts` `__group` `__row` `__label` `__keys` | 단축키 시트: 그룹별 줄, 왼쪽 이름, 오른쪽 키 |
| `.c-pick` `__head` `__path` `__list` `__item` `__label` `__empty` | 대화상자 안의 고르기 목록: 버튼이 있는 모노 경로 머리, 아래에 누를 행(원격 폴더 고르기, T56) |
| `.c-checklist` `__item` `__lead` `__main` `__title` `__meta` `__actions` `__detail` `__command` | 테두리 있는 점검 목록: 제목 줄의 점 · 제목(+ 배지) / 모노 메타 · 버튼, 아래에 전체 폭 상세(복사 버튼 있는 설치 명령, 드롭 영역) |
| `.c-dropzone[data-over]` | 점선 드롭 영역. 끌어 올리는 동안 강조 테두리 + 선택 배경 |
| `.c-field` `__label` `__hint`, `.c-input` (`--multiline`, `--inline`), `.c-select` `__control` | 폼 필드: 라벨, 텍스트 입력 / 선택 (포커스 = 파란 테두리), 모노스페이스 힌트 (`data-tone="warning"` = 대기 주황). `--inline`은 줄 안에서 제목을 바로 고친다(탭 이름 바꾸기, T43): 그 줄의 글꼴, 고정 높이 없음 |
| `.c-field__row`, `.c-field-grid` | 컨트롤 옆에 버튼(경로 + "바꾸기…"); 짧은 필드 두 개를 나란히 |
| `.c-props` `__head` `__toggle` `__count` `__actions` `__list` `__row` `__key` `__value` `__input` `__remove` `__chips` `__chip` `__raw` | 노트 본문 위의 속성 (T78): 접히는 머리, 키 · 값 · 지우기 줄; 목록 값은 칩, 그대로 두는 값은 모노 |
| `.c-ntable` `__frame` `__bar` `__chips` `__chip[aria-pressed]` `__head` `__th[aria-sort]` `__sort` `__row` `__group` `__cell[data-editable\|data-editing]` `__open` `__input` `__empty` | 표 보기 (T78): 가상화된 격자, 한 줄 = `--size-row`; 고정된 정렬 머리, 제목 열 다음 속성 열; 위에 필터 / 상태 칩 |
| `.c-explorer` `__head` `__filter` `__note[data-tone]`, `.c-editor__explorer` | 에디터 왼쪽의 노트 탐색기 열 (T83): 소스 + 정렬 + 버튼, 거르기 칸, 상태 줄(warn = 오류), 그 아래 트리 |
| `.c-tree` `__spacer` `__section` `__row` (`--level`, `aria-selected` `aria-expanded` `data-current` `data-cursor` `data-drop` `data-dragging` `data-kind`) `__twisty` `__icon` `__name` (`mark` = 거르기 일치) `__count` `__dot[data-tone=done\|active\|other\|changed]` `__actions` `__action` `__input[aria-invalid]` `__ghost` | 가상화된 파일 트리: 고정 높이 `--size-tree-row` 줄을 절대 위치로, 폴더는 노트 수, 노트는 상태 · "방금 바뀜" 점, 마우스를 올리면 버튼, 그 자리에서 이름 입력, 끌 때 따라오는 이름표. 놓을 폴더는 강조색 테두리 |

## React 컴포넌트 (`design-system/react/`)

`@design-system/react`에서 가져와 씁니다. 앱 코드는 `.c-*` 클래스를 직접 쓰지 않고 이 컴포넌트를 씁니다. 레이아웃 전용 블록
(사이드바, 탭 바, 분할/패널, 오른쪽 패널, diff)은 각 위젯 안에서 클래스를 그대로 씁니다. 이 폴더는 `src/`를 import하면 안 됩니다
(ESLint가 막음). 새 컴포넌트 → `components.css`에 클래스, 여기에 컴포넌트, 아래 표에 한 줄.

| 컴포넌트 | 그리는 것 |
|---|---|
| `Button` `variant="primary\|ghost"` `icon` `glyph?` `label?` `ref?` | `.c-btn` (`label` → `.c-btn--labelled`) |
| `Dot` `status` `estimated?` `label?` | `.c-dot` |
| `Badge` `tone` | `.c-badge--<tone>` |
| `HostBadge` `host` `conn?` `label?` | `.c-badge--host` (+ `.c-badge__conn`) |
| `Kbd`, `Label` | `.c-kbd`, `.c-label` |
| `Elapsed` `title?` | `.c-elapsed` |
| `Reason` `text` `risk?` `riskLabel?` `onClick?` | `.c-reason` |
| `QueueItem` `leading?` `title` `meta?` `tooltip?` `onClick?` | `.c-queue` |
| `RiskMark` `label` | `.c-risk` |
| `Meter` `label` `value` `fraction` (null = 모름) `tone?` `caption?` `title?` | `.c-meter` |
| `Ring` `fraction` `label` `valueText` `showValue?` `tone?` `title?` | `.c-ring` |
| `Segment` `options` `value` `onChange` | `.c-segment` |
| `Range` `label` `value` `onChange` | `.c-range` |
| `ResizeHandle` `onChange` `onReset` `edge` `label` | `.c-resize` (부모를 직접 잼: 시작 폭, `min-width`, 유연한 형제가 내줄 수 있는 폭) |
| `EmptyState` `title` `path` `actions` | `.c-empty` |
| `Dialog` `open` `title` `onClose` `actions` `wide`, `DialogCheck`, `DialogCode`, `DialogForm` `id` `onSubmit`, `DialogGroup` `ref?` | `.c-dialog` (`DialogGroup` = `.c-dialog__group`, fields kept together and scrolled to) |
| `PickList` `label` `path` `actions` `empty`, `PickItem` `onClick` `trailing` | `.c-pick` |
| `Checklist` `label`, `ChecklistItem` `leading` `title` `tag` `meta` `actions`, `ChecklistCommand` `command` `action` | `.c-checklist` |
| `Dropzone` `over` (+ div 속성) | `.c-dropzone` |
| `TermOverlay` (+ div 속성, `ref`), `TermJump` (Button 속성), `TermNote` `bar?`, `TermHint` `box` `label?` `typed?` | `.c-term-overlay`, `.c-term-overlay__jump`, `.c-term-overlay__note(--bar)`, `.c-term-hint` (터미널 위 도우미, T28) |
| `TermBanner` `meta?` `action?` | `.c-term-overlay__banner` (연결 끊김, T29) |
| `TitleBar` `lead?` `actions?` (+ div 속성) | `.c-titlebar` (전체 창, T37) |
| `TermChips` `label` `closeLabel` `onClose`, `TermChipGroup` `label` | `.c-term-overlay__chips`, `.c-term-overlay__chips-group` (프롬프트 칩, T34) |
| `TermFind` `label` `query` `onQuery` `onKeyDown?` `inputRef?` `placeholder?` `count?` `empty?` `caseSensitive` `onToggleCase` `onPrev` `onNext` `onClose` `labels` | `.c-term-find` (터미널에서 찾기, T40) |
| `Field` `label` `hint` `warning`, `FieldRow`, `FieldGrid`, `Input`, `InlineInput`, `Textarea`, `Select` `options` `onChange(value)` | `.c-field`, `.c-field__row`, `.c-field-grid`, `.c-input`, `.c-input--inline`, `.c-input--multiline`, `.c-select` |
| `ChangeRow` `status` `path` `badge?` | `.c-change` |
| `Palette` `open` `onClose` `label` `query` `onQueryChange` `listId` `activeId`, `PaletteList`, `PaletteItem` `selected` `label` `marks` `leading` `hint` `kbd`, `PaletteEmpty` | `.c-palette` (combobox + listbox) |
| `Modal` `open` `title` `subtitle?` `onClose` `closeLabel` `aside` `footer` `wide`, `ModalSearch` (열 때 포커스), `ModalList` `id` `label`, `ModalItem` `selected` `label` `meta` `trailing` `onSelect`, `ModalEmpty`, `ModalDetail` `heading` `text` `keys`, `ModalGroup` `label` `hint`, `ModalTools`, `ModalActions` `onSubmit?`, `ModalNote` `warn`, `ModalBullets` `items` | `.c-modal` |
| `MetaList`, `MetaRow` `label` `mono` | `.c-meta` |
| `Transcript` `label`, `TranscriptMessage` `role` `label` | `.c-transcript` |
| `CommandList` `label`, `CommandRow` `state` `stateLabel` `command` `time?` `marks?` | `.c-commands`, `.c-command` |
| `RunList` `label`, `RunItem` `name` `status` `state` `current` `title?` `onClick` | `.c-runs`, `.c-runs__item` |
| `Graph` `width` `height` `label` `nodes` `edges` `columns?` | `.c-graph` |
| `NoteEditor` `hostRef` `top?` `side?` `explorer?` `placeholder?`, `EditorBanner` `tone?` `actions?`, `EditorCompare`, `EditorSection` `title` `empty?`, `EditorItem` `label` `detail?` `level?` `onClick` | `.c-editor` |
| `Explorer` `label` `head` `filter?` `note?`, `Tree` `label` `height` `scrollRef?` `onScroll?` `onKeyDown?`, `TreeSection` `top`, `TreeRow` `top` `level` `kind` `name` `rel` `matches?` `open?` `selected?` `current?` `cursor?` `drop?` `dragging?` `count?` `dot?` `actions?` `editor?`, `TreeAction` `label` `onClick`, `TreeInput` `value` `label` `invalid?` `onChange` `onSubmit` `onCancel`, `TreeGhost` `x` `y` | `.c-explorer`, `.c-tree` |
| `ReviewCounts` `added` `removed` `unit?`, `ReviewMeta`, `ReviewConfirm` `actions` | `.c-review` |
| `NoteIdRow` `actions?`, `NoteIdText` `label` `detail?` `title?`, `NoteIdNote` `tone?` `actions?` | `.c-noteid-*` |
| `StepList` `label`, `StepItem` `checked` `onToggle` `title` `checkLabel?` `tags?` `meta?` `onHover?` | `.c-steps` |
| `Media` `src` `kind` `poster` `alt` `still` `placeholder` | `.c-media` (reduced motion이나 `still`이면 영상 대신 포스터) |
| `ShortcutSheet` `groups` | `.c-shortcuts` |
| `PropPanel` `title` `count?` `open` `onToggle` `actions?`, `PropRow` `name` `onRemove?` `removeLabel?`, `PropChips`, `PropChip` `label` `onRemove?`, `PropInput`, `PropRaw` | `.c-props` |
| `DataGrid` `label` `columns` `count` `renderRow(i)` `rowKey(i)` `empty?`, `GridRow`, `GridGroup` `title` `count`, `GridOpen` `label` `onOpen`, `GridCell` `text` `muted?` `onEdit?` `editing?` `editor?`, `GridInput`, `GridBar`, `GridChips` `label`, `GridChip` `label` `count?` `pressed` `onClick`, `GridFrame` | `.c-ntable` (화면에 보이는 줄만 그림) |

## 문구

한국어와 영어 둘 다 (`src/shared/i18n.ts`). 짧고 그대로. 버튼은 무슨 일이 일어나는지 말함:
"Claude 열기 / Open Claude". 알림: `<프로젝트>` · `Claude · 작업 완료 / Done`, `입력 필요 / Needs input`.
