# Aquila Agents 디자인 시스템

> English: [../en/DESIGN-SYSTEM.md](../en/DESIGN-SYSTEM.md)

창 하나, 에이전트 여러 개. UI는 터미널 뒤로 물러나 있다가 에이전트가 나를 필요로 할 때만 말을 겁니다.

- 기준 파일: `design-system/tokens.css` (값), `design-system/components.css` (컴포넌트 스타일),
  `design-system/react/` (그 스타일을 그리는 React 컴포넌트).
- 미리보기: `open design-system/preview.html`.
- 규칙: **앱 코드에 hex/px 직접 쓰지 않기.** 새 값이 필요하면 원시 토큰 + 시맨틱 토큰부터 추가.

## 원칙

1. **터미널이 주인공.** 사이드바·탭은 어둡고 조용하게. `--color-bg-canvas`가 가장 어두운 면.
2. **크게 말하는 색은 상태뿐.** 파랑 = 선택/포커스. 주황(`--color-status-waiting`)은 "내가 뭔가 해야 함" 전용, 장식 금지.
3. **하나의 그리드.** 모든 값은 4px 배수, 영역 사이 가장자리 정렬 (아래 레이아웃 참고).
4. **v0.1은 다크 전용.** 라이트 테마는 시맨틱 토큰 재매핑만으로.

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
| `--color-action-primary(-hover)` | 주요 버튼 |
| `--color-agent-claude` / `-codex` / `-shell` | 세션 종류 |
| `--color-account-shared` / `-personal` | Claude 계정 배지 (`claude` / `claude-personal`) |
| `--color-diff-*` | diff 추가 / 삭제 / 헝크 |
| `--color-terminal-*` | xterm 테마 (실행 중에 읽음): 배경, 글자, 커서, 선택, 스크롤바(+ `-hover`) |

### 세션 상태 — 앱의 핵심 언어

| 상태 | 토큰 | 의미 | 출처 |
|---|---|---|---|
| working | `--color-status-working` (깜빡임) | 에이전트 작업 중 | OSC 7501 `working`, Claude hooks, 보고하지 않는 프로그램은 출력 활동 |
| waiting | `--color-status-waiting` (후광) | 나를 기다림: 권한 승인이나 질문 | OSC 7501 `blocked`, Claude hook `PermissionRequest` / `Notification` |
| done | `--color-status-done` | 끝났고 아직 안 봄 | OSC 7501 `done`, Claude hook `Stop` |
| done (추정) | `--color-status-done-estimated` (`data-estimated`, 흐리게) | 아마 끝남: 출력이 조용해져서 추측 | 출력 활동 (보고하지 않는 codex/셸) |
| error | `--color-status-error` | 실패: API 오류(사용량 제한·로그인·결제·서버)나 0이 아닌 종료. 이유는 점의 라벨 | OSC 7501 `error`, Claude hook `StopFailure`, pty 종료 코드 |
| stopped | `--color-status-stopped` (고리) | 내가 멈춤(Esc / Ctrl+C) 또는 정상 종료 | 입력한 키, `SessionEnd`, 종료 코드 0 / 130 |
| idle | `--color-status-idle` | 아무 일 없음 / 이미 봄 | 기본값 |

프로젝트 행은 세션 중 가장 급한 상태를 보여줍니다: `waiting > error > working > done > stopped > idle`.

## 글자

- UI: 시스템 폰트 (SF Pro + Apple SD Gothic Neo). 고정폭: JetBrains Mono (번들), 한글은 D2Coding 대체.
- `--font-size-caption` 11 (메타, 라벨) · `-label` 12 (탭, 버튼) · `-body` 13 (본문, 터미널) · `-title` 15.
- 섹션 라벨: 11 / 600 / 대문자 / 0.06em / `--color-text-tertiary`.

## 간격·모서리 (역할별)

`--space-inline-xs|sm` 4|8 (한 줄 안 요소 사이) · `--space-inset-sm|md` 8|12 (안쪽 여백) · `--space-stack-md|lg` 16|24 (그룹/섹션 사이).
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
| `--size-row` | 32 | 사이드바 행, 탭도 32 (40 − 위 여백 8) |
| `--size-control` | 28 | 버튼, 세그먼트 컨트롤 |
| `--size-pane-head` | 28 | 분할 패널 헤더 |
| `--size-focus-line` | 2 | 포커스된 패널 헤더 아래 강조선 (패널의 유일한 포커스 표시) |
| `--size-split-handle` | 8 | 분할 구분선을 잡는 영역, 1px 선 가운데 |
| `--size-badge` / `--size-dot` | 16 / 8 | |
| `--size-meter` | 4 | 미터 막대 (사용량 게이지) |
| `--size-sidebar` / `--size-panel` | 248 / 416 | |
| `--size-panel-wide` | 720 | 나란히 보기 때 변경사항 패널(창의 절반까지) |
| `--size-diff-gutter` / `--size-diff-comment` | 40 / 384 | diff의 줄 번호 칸 하나 / 줄 코멘트 상자 |
| `--size-dialog` / `--size-dialog-wide` | 440 / 560 | 다이얼로그 너비 / 체크리스트가 있는 다이얼로그(첫 실행) |
| `--size-palette` / `--size-palette-list` | 560 / 352 | 명령 팔레트 너비 / 스크롤 전 목록 높이(11줄) |
| `--size-modal` / `--size-modal-height` / `--size-modal-aside` | 760 / 520 / 240 | 목록 + 상세 모달(가이드, 릴리즈 노트) / 목록 열 너비 |
| `--size-modal-wide` / `--size-modal-wide-height` / `--size-modal-wide-aside` | 960 / 640 / 320 | `.c-modal--wide` (세션 기록: 긴 행, 대화 미리보기) / 목록 열 너비 |

## 컴포넌트 (`components.css`)

| 클래스 | 내용 |
|---|---|
| `.c-dot[data-status]` | 상태 점 |
| `.c-btn` `--primary` `--ghost` `--icon` | 버튼 |
| `.c-segment`, `__item[aria-checked]` | 세그먼트 컨트롤 (계정 전환) |
| `.c-kbd` | 단축키 표시 |
| `.c-elapsed` | 세션이 기다린 시간("12분", 고정폭, 대기 색) — 탭·프로젝트 행 |
| `.c-badge` `--claude` `--codex` `--shell` `--account-shared` `--account-personal` | 태그 |
| `.c-badge--host`, `.c-badge__conn[data-conn=connecting\|connected\|reconnecting\|lost]` | 원격 호스트 이름(대문자로 안 바꿈)과 연결 점: 회색 / 초록 / 주황 깜빡임 / 빨강 (T29) |
| `.c-term-overlay__banner` `__banner-text` `__banner-meta` | 터미널 위쪽을 가로지르는 클릭 가능한 바, 빨간 테두리: 연결 끊김 + 카운트다운 + 동작 (T29) |
| `.c-label` | 섹션 라벨 |
| `.c-sidebar` `__drag` `__body` `__group` `__foot` `__lang` | 사이드바 |
| `.c-meter[data-tone=warn\|danger][data-unknown]` `__head` `__value` `__track` `__fill` `__caption` | 한도 대비 비율: 라벨 · 값, 4px 막대(회색 → 75% 이상 주황 → 90% 이상 빨강), 캡션. 한도를 모르면 테두리만 있는 빈 막대 (T30) |
| `.c-usage` `__head` `__est` `__account` `__bars` | 사이드바 푸터 위 사용량 띠: 계정마다 한 블록, 미터 두 개 나란히 (T30) |
| `.c-row[aria-current]` `__name` `__meta` | 프로젝트 행 |
| `.c-row[data-drop=before\|after]` `[data-dragging]`, `.c-sidebar__group[data-drop]`, `.c-sidebar__empty` | 끌어서 순서 변경: 놓일 위치 선, 끄는 행은 흐리게, 빈 그룹도 놓을 수 있음 |
| `.c-tabbar` `__add` `__trailing`, `.c-tab[aria-selected]` `__title` `__branch` `__close` | 탭 (`__branch` = 워크트리 브랜치, mono, 먼저 잘림) |
| `.c-split`, `.c-pane[data-focused]` `__head` `__term` | 화면 분할 |
| `.c-split--free`, `.c-split__drop`, `.c-pane__title` `__close` | 앱의 화면 분할: 절대 배치 패널, 드롭 표시(영역 사이를 미끄러지듯 이동), 패널 헤더 제목 + 닫기 |
| `.c-split__divider[data-dir][data-active]`, `.c-split[data-resizing]`, `.c-pane__zoom[aria-pressed]` | 드래그 구분선(호버/드래그 시 강조선), 드래그 중 화면 전체 리사이즈 커서, 패널 헤더의 확대 토글 |
| `.c-panel` `__head` `__body` `__actions` `__section` `__note` `__bar` `__bar-end`, `.c-panel--wide` | 오른쪽 패널 (밀려 들어옴, 헤더는 탭 바처럼 창 드래그 영역); `__bar` = 헤더 아래 줄바꿈되는 컨트롤 띠; `--wide`는 나란히 보기용(창의 절반까지) |
| `.c-diff` `__line--add/del/hunk/file/meta`, `__file[aria-current]`, `__num`, `__actions`, `__line[data-commentable][data-commented]`, `.c-diff--split` `__row` `__line--empty`, `__comment` `__comment-actions` | diff (한 줄: 가장 긴 줄만큼 넓어짐, 나란히: 줄바꿈되는 두 칸). 줄 번호 칸, 파일/hunk 줄의 작은 버튼, 코멘트 가능/있음 표시, 줄 아래 코멘트 상자 |
| `.c-change`, `__status[data-status]` `__path` `__dir` | 변경 파일 행: 색이 있는 git 상태 글자, 이름, 흐린 폴더 |
| `.c-btn--ghost[aria-pressed]` | 켜진 토글 버튼 |
| `.c-empty` `__title` `__path` `__actions` | 빈 화면 |
| `.c-dialog` `__title` `__body` `__actions` `__check` `__code` `__form` | 모달 다이얼로그 (네이티브 `<dialog>`, 아래에서 떠오름) |
| `.c-palette` `__input` `__list` `__item[aria-selected]` `__leading` `__label` `__mark` `__hint` `__empty` `__foot` | 명령 팔레트 (화면 위쪽 네이티브 `<dialog>`, 떠오름): 입력칸은 타이틀 바 높이, 줄 32px, 매치된 글자 굵게 |
| `.c-dialog--wide` | 체크리스트용 넓은 다이얼로그 |
| `.c-modal--wide`, `__tools` `__group-label` `__item-meta` `__actions` `__note` (`--warn`) | 넓은 모달(세션 기록): 검색 아래 필터 줄, 행 묶음 위 폴더 이름, 행 끝 캡션(시간), 상세의 버튼 줄, 캡션 한 줄(주황 = 사라질 수 있는 것) |
| `.c-meta` `__label` `__value` (`--mono`) | 이름 · 값 행 (폴더, 브랜치, ID) |
| `.c-transcript` `__message[data-role]` `__role` `__text` | 읽기 전용 대화: 누가, 그다음 쓴 그대로의 텍스트(줄바꿈); 사용자 메시지는 primary 색 |
| `.c-modal` `__head` `__title` `__body` `__aside` `__search` `__list` `__item[aria-selected]` `__item-label` `__empty` `__main` `__heading` `__text` `__keys` `__foot` | 큰 목록 + 상세 모달 (네이티브 `<dialog>`, 떠오름): 머리와 검색칸은 타이틀 바 높이, 왼쪽 검색 목록, 오른쪽 상세 (가이드; 릴리즈 노트·트렌드와 공유) |
| `.c-media` `__frame` `__placeholder` | 스크린샷이나 짧은 루프용 16:10 틀, 없으면 자리표시 |
| `.c-shortcuts` `__group` `__row` `__label` `__keys` | 단축키 시트: 그룹별 줄, 왼쪽 이름, 오른쪽 키 |
| `.c-checklist` `__item` `__lead` `__main` `__title` `__meta` `__actions` `__detail` `__command` | 테두리 있는 점검 목록: 제목 줄의 점 · 제목(+ 배지) / 모노 메타 · 버튼, 아래에 전체 폭 상세(복사 버튼 있는 설치 명령, 드롭 영역) |
| `.c-dropzone[data-over]` | 점선 드롭 영역. 끌어 올리는 동안 강조 테두리 + 선택 배경 |
| `.c-field` `__label` `__hint`, `.c-input` (`--multiline`), `.c-select` `__control` | 폼 필드: 라벨, 텍스트 입력 / 선택 (포커스 = 파란 테두리), 모노스페이스 힌트 (`data-tone="warning"` = 대기 주황) |
| `.c-field__row`, `.c-field-grid` | 컨트롤 옆에 버튼(경로 + "바꾸기…"); 짧은 필드 두 개를 나란히 |

## React 컴포넌트 (`design-system/react/`)

`@design-system/react`에서 가져와 씁니다. 앱 코드는 `.c-*` 클래스를 직접 쓰지 않고 이 컴포넌트를 씁니다. 레이아웃 전용 블록
(사이드바, 탭 바, 분할/패널, 오른쪽 패널, diff)은 각 위젯 안에서 클래스를 그대로 씁니다. 이 폴더는 `src/`를 import하면 안 됩니다
(ESLint가 막음). 새 컴포넌트 → `components.css`에 클래스, 여기에 컴포넌트, 아래 표에 한 줄.

| 컴포넌트 | 그리는 것 |
|---|---|
| `Button` `variant="primary\|ghost"` `icon` `ref?` | `.c-btn` |
| `Dot` `status` `estimated?` `label?` | `.c-dot` |
| `Badge` `tone` | `.c-badge--<tone>` |
| `HostBadge` `host` `conn?` `label?` | `.c-badge--host` (+ `.c-badge__conn`) |
| `Kbd`, `Label` | `.c-kbd`, `.c-label` |
| `Elapsed` `title?` | `.c-elapsed` |
| `Meter` `label` `value` `fraction` (null = 모름) `tone?` `caption?` `title?` | `.c-meter` |
| `Segment` `options` `value` `onChange` | `.c-segment` |
| `EmptyState` `title` `path` `actions` | `.c-empty` |
| `Dialog` `open` `title` `onClose` `actions` `wide`, `DialogCheck`, `DialogCode`, `DialogForm` `id` `onSubmit` | `.c-dialog` |
| `Checklist` `label`, `ChecklistItem` `leading` `title` `tag` `meta` `actions`, `ChecklistCommand` `command` `action` | `.c-checklist` |
| `Dropzone` `over` (+ div 속성) | `.c-dropzone` |
| `TermOverlay` (+ div 속성, `ref`), `TermJump` (Button 속성), `TermNote` `bar?`, `TermHint` `box` `label?` `typed?` | `.c-term-overlay`, `.c-term-overlay__jump`, `.c-term-overlay__note(--bar)`, `.c-term-hint` (터미널 위 도우미, T28) |
| `TermBanner` `meta?` `action?` | `.c-term-overlay__banner` (연결 끊김, T29) |
| `Field` `label` `hint` `warning`, `FieldRow`, `FieldGrid`, `Input`, `Textarea`, `Select` `options` `onChange(value)` | `.c-field`, `.c-field__row`, `.c-field-grid`, `.c-input`, `.c-input--multiline`, `.c-select` |
| `ChangeRow` `status` `path` | `.c-change` |
| `Palette` `open` `onClose` `label` `query` `onQueryChange` `listId` `activeId`, `PaletteList`, `PaletteItem` `selected` `label` `marks` `leading` `hint` `kbd`, `PaletteEmpty` | `.c-palette` (combobox + listbox) |
| `Modal` `open` `title` `onClose` `closeLabel` `aside` `footer` `wide`, `ModalSearch` (열 때 포커스), `ModalList` `id` `label`, `ModalItem` `selected` `label` `meta` `trailing` `onSelect`, `ModalEmpty`, `ModalDetail` `heading` `text` `keys`, `ModalGroup` `label` `hint`, `ModalTools`, `ModalActions` `onSubmit?`, `ModalNote` `warn` | `.c-modal` |
| `MetaList`, `MetaRow` `label` `mono` | `.c-meta` |
| `Transcript` `label`, `TranscriptMessage` `role` `label` | `.c-transcript` |
| `Media` `src` `kind` `poster` `alt` `still` `placeholder` | `.c-media` (reduced motion이나 `still`이면 영상 대신 포스터) |
| `ShortcutSheet` `groups` | `.c-shortcuts` |

## 문구

한국어와 영어 둘 다 (`src/shared/i18n.ts`). 짧고 그대로. 버튼은 무슨 일이 일어나는지 말함:
"Claude 열기 / Open Claude". 알림: `<프로젝트>` · `Claude · 작업 완료 / Done`, `입력 필요 / Needs input`.
