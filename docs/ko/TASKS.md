# 태스크

> English: [../en/TASKS.md](../en/TASKS.md)

지금까지 만든 것 (v0.1 기반): 그룹/프로젝트 사이드바, 프로젝트별 탭, xterm(WebGL) 안의 실제 `claude` / `codex` / 셸,
hooks 기반 Claude 상태, 그 외 세션은 출력 기반 상태, 알림, 프로젝트별 공용/개인 Claude 계정, 한/영 UI, 디자인 시스템,
단축키 ⌘T ⌘⇧T ⌘⌥T ⌘W ⌘1–9.

**병렬로 진행하는 법:** 세션 하나에 태스크 하나, 각자 브랜치/워크트리에서
(`git worktree add ../aquila-T1 -b task/T1-split-view`). **담당 파일** 안에서만 작업하세요. 공유 파일
(`pages/workspace/*`, `src/shared/api/types.ts`, `src/shared/i18n/dictionary.ts`, `electron/main.ts`, `electron/preload.ts`, `components.css`)은
작게, 추가 위주로만 수정합니다. 같은 공유 파일을 건드리는 태스크끼리는 번호 순서대로 머지합니다.

---

### T1 · 화면 분할
- [x] **목표:** 세션 2~4개를 한 화면에서 보고 채팅 (프로젝트 상관없이).
  _남은 것: 패널 크기는 반반 고정(경계선 드래그로 크기 조절 없음), 화면이 하나일 땐 `.c-pane__head` 숨김(탭 바와 중복)._
- **UX:** ⌘D 오른쪽 분할, ⌘⇧D 아래 분할, ⌘⌥방향키로 포커스 이동, 탭을 패널 가장자리로 끌어 놓으면 그 방향으로 분할.
  각 패널에 `.c-pane__head` (상태 점 · 종류 · 프로젝트 · 계정). 포커스된 패널은 `data-focused`.
- **담당:** `src/widgets/split-view/`, `src/widgets/split-view/model/layout.ts` (+ 테스트), `src/widgets/session-stage/` (split-view로 합침).
- **완료 기준:** 프로젝트를 바꿔도 레이아웃 유지, 세션을 닫으면 패널이 합쳐짐, 크기 바뀌면 xterm 다시 맞춤.

### T2 · 계정 설정 (공용 `claude` / 개인 `claude-personal`)
- [x] **목표:** `claude-personal`이 없는 사람도 앱에서 바로 설정.
  _남은 것: 설정 다이얼로그(와 zshrc 옵션)는 로그인 안 된 계정이 있을 때만 열 수 있음._
- **스펙:**
  - Main: `accounts:status` → 계정마다 `{ configDirExists, loggedIn }` (`loggedIn` = `<dir>/.claude.json`에
    `oauthAccount`가 있음, 공용은 `~/.claude.json`).
  - 개인 계정이 준비 안 됐으면 `AccountSwitch`에 점 + "설정하기" 표시 → 폴더를 만들고 그 계정으로 Claude 세션을 열기
    (Claude가 자체 `/login` 진행).
  - 선택, **사용자가 명시적으로 눌렀을 때만**: "터미널에서도 `claude-personal` 쓰기" → `~/.zshrc`에
    `claude-personal() { CLAUDE_CONFIG_DIR="$HOME/.claude-personal" command claude "$@"; }`가 없으면 추가
    (먼저 미리보기 표시). rc 파일에 쓰는 건 여기가 유일한 예외.
- **담당:** `electron/accounts.ts`, `src/features/setup-account/`, `src/features/switch-account/`.

### T3 · 변경사항 패널
- [x] **목표:** 에이전트가 바꾼 걸 앱 안에서 바로 확인.
  _남은 것: 읽기 전용(stage/되돌리기 없음), 추적 안 된 파일 diff는 20개까지, 패널 폭 고정._
- **UX:** ⌘⇧G로 오른쪽 `.c-panel` 토글: 브랜치, 변경 파일(상태 글자 + 경로), `.c-diff__line--*`로 그린 diff.
  앱에 포커스가 오면, 그리고 열려 있는 동안 5초마다 새로고침.
- **담당:** `electron/git.ts` (`git status --porcelain=v1 -b`, `git diff --no-color`, 400KB 제한),
  `src/widgets/changes-panel/`, `src/entities/diff/` (parseDiff + 테스트).

### T4 · 다시 열면 세션 복원
- [x] **목표:** 앱을 다시 켜면 탭이 돌아옴.
  _남은 것: 화면 분할과 포커스된 탭은 복원 안 됨(첫 프로젝트의 탭을 띄움); 한 프로젝트의 codex 탭 두 개는 같은 마지막 세션을 resume; 셸은 cwd/스크롤백 유지 안 함._
- **스펙:** 열린 탭을 `~/.aquila/state.json`에 저장. Claude: 우리가 만든 `--session-id <uuid>`로 시작하고
  `claude --resume <uuid>`로 복원. Codex: 해당 폴더에서 `codex resume --last`. 셸: 새 셸.
- **담당:** `electron/state.ts`, `sessions.ts`에 작은 추가.

### T5 · 프로젝트 관리 UI (JSON 직접 수정 없이)
- [x] **목표:** 앱에서 프로젝트/그룹 추가·이름 변경·삭제·순서 변경.
  _남은 것: 그룹 순서는 끌기 대신 메뉴(위로/아래로 이동); 프로젝트 경로는 앱에서 못 바꿈; 같은 폴더 중복 경고 없음._
- **UX:** 사이드바 아래 "+" → 폴더 선택(`dialog.showOpenDialog`), 이름 = 폴더 이름, 그룹 + 계정 선택.
  행 우클릭 → 이름 변경 / 그룹 변경 / 삭제. 끌어서 순서 변경.
- **담당:** `src/features/manage-projects/`, `electron/config.ts` (저장 헬퍼 추가).

### T6 · 커맨드 팔레트
- [x] **목표:** ⌘K로 어떤 프로젝트/세션이든 바로 이동하거나 동작 실행.
  _남은 것: "프로젝트 추가" 동작 없음(폴더 선택 흐름은 사이드바에 있음), 최근 사용 순 정렬 없음._
- **담당:** `src/widgets/command-palette/`, `src/shared/lib/fuzzy.ts` (+ 테스트).

### T7 · 워크트리 세션
- [x] **목표:** "워크트리에서 새 Claude" → `../<repo>-wt/<branch>` 만들고 거기서 세션 시작, 탭에 브랜치 표시.
  _남은 것: 앱에서 워크트리 삭제는 없음(`git worktree remove` 사용); Claude만 버튼 있음(API는 codex/셸도 지원)._
- **담당:** `electron/worktrees.ts`, `src/features/open-in-worktree/`.

### T8 · 패키징
- [x] **목표:** `npm run dist` → /Applications로 옮길 수 있는 `Aquila Agents.app` (arm64).
  _남은 것: 서명·공증 없음(받는 사람이 격리 해제, README 참고), 자동 업데이트 없음, arm64만, Windows 빌드 없음, CLI가 없을 때 안내 화면은 아직(PATH 복원은 됨)._
- **스펙:** electron-builder, 디자인 시스템 기반 아이콘(어두운 타일 + 강조색 마크), `node-pty`는 asar 밖으로.
- **담당:** `electron-builder.yml`, `build/`, `package.json` 스크립트.

---

## v0.1 이후 로드맵

근거: [`docs/research/`](../research/README.md) (사용 편의성 조사, 2026-11-19, 로드맵 항목 `#n`). 순서: **Now** →
**Next** → **Later**. 플랫폼 계층(T13)과 상태 엔진(T14)이 맨 앞인 이유는 나머지 거의 전부(그리고 Windows)가 그 위에
올라가기 때문이에요.

## Now

### T13 · 플랫폼 계층
- [ ] **목표:** macOS와 Windows에서 달라지는 것을 한곳에 모아, 이후 기능을 한 번만 쓰게. (#1)
- **명세:** 인터페이스 하나 뒤의 `electron/platform/{darwin,win32}.ts`: 셸 탐지와 프로필(Windows: pwsh 7 > Windows
  PowerShell 5.1 > Git Bash > CMD, WSL 배포판은 시작 시 1회와 요청 시에만 탐지, 폴링 금지), 셸별 spawn 템플릿
  (`pwsh -NoLogo -NoExit -Command`, `cmd /K`, `bash -l -i -c "…; exec bash -l -i"`,
  `wsl.exe -d <distro> --cd <path> -- bash -lic "…"`), 경로 변환(`wslpath -a`, `\\wsl.localhost\…`), 알림.
  플랫폼 독립 단축키 맵 하나를 `src/shared/lib/shortcuts.ts`에(`CommandOrControl`식 id) 두고 키 처리·팔레트·메뉴·가이드가
  모두 읽어요. 표기는 macOS ⌘, Windows Ctrl+Shift.
- **담당:** `electron/platform/`, `src/shared/lib/shortcuts.ts`(+ 테스트), `sessions.ts`·`useShortcuts.ts` 소폭 수정.

### T14 · 상태 엔진: OSC 7501 우선, http hook
- [ ] **목표:** "누가 나를 기다리나"가 정확하고 즉시. 거짓 "done" 없음. (#25, #2, #3, #24)
- **명세:**
  - Main이 pty 스트림의 OSC 7501 질의에 응답(`OSC 7501 ; ?` → `states=idle,working,done,blocked,error :
    kinds=permission,question,auth`)하고 보고를 파싱(청크 경계에 걸친 시퀀스는 버퍼링). Claude Code 2.1.295+
    (Codex도 내보내면 — 먼저 스파이크)의 1차 상태로 씀. 모르는 키·상태는 무시, 원문은 디버그 로그, 휴리스틱은 폴백으로 유지.
  - hook을 모든 플랫폼에서 `type: "http"`로(로컬 수신기 `url`, `AQUILA_TAB_ID`로 `X-Aquila-Session` 헤더,
    `timeout: 5`, `onFailure: "continue"`). command+curl은 구버전 Claude에만(`claude --version`). `PermissionRequest`
    (→ 즉시 waiting, decision 안 돌려줌), `StopFailure`(→ error: rate limit·인증·결제·서버) 추가. `PermissionDenied` /
    `PostToolUse` / `UserPromptSubmit` / 그 세션에 키 입력 시 waiting 해제. `idle_prompt`는 쓰지 않음.
    `SubagentStart/Stop` 카운트로 서브에이전트 중 Stop은 working 유지.
  - 새 상태 `stopped`(Ctrl+C / 정상 종료)를 `error`와 분리. 휴리스틱 "done"은 추정(흐리게)으로 표시.
  - Codex 폴백은 7501을 안 내보낼 때만: `-c tui.notifications=true -c tui.notification_method="osc9"
    -c tui.notification_condition="always"` 후 OSC 9 가로채기.
- **담당:** `electron/hooks.ts`, `electron/status/`(OSC 파서 + 테스트), `sessions.ts` 상태 부분, `entities/session` 상태.

### T15 · 주의 관리: 배지, 다음 대기 세션, 맥락 있는 알림
- [ ] **목표:** 나를 기다리는 탭을 찾아 헤매지 않게. (#5, #6)
- **명세:** 대기 수를 Dock 배지(macOS) / 작업 표시줄 overlay 아이콘 + `flashFrame`(Windows)으로. 프로젝트를 가로지르는
  "다음 대기 세션" 단축키(waiting > error > done 순환), 탭/행에 "12분째 대기" 경과 시간과 1회 리마인드. 알림 본문:
  프로젝트 · 탭 · `last_assistant_message` 첫 줄(Stop) 또는 `PermissionRequest` 도구 요약("Bash: npm install").
  같은 상태 반복은 디바운스. 클릭하면 정확한 세션으로(있음). 이미 보이는 세션은 알리지 않음(있음).
- **담당:** `electron/notify.ts`, `src/features/next-waiting/`, `sessions.ts`·`useShortcuts.ts` 소폭 수정.

### T16 · 터미널 성능
- [ ] **목표:** 세션 15개 이상에서도 부드럽고 가볍게. (#4, #18, #19)
- **명세:** WebGL은 보이는 pane(≤4)에만. 숨기면 dispose + `term.refresh(0, rows-1)`, context loss면 DOM 렌더러.
  `@xterm/xterm` 5.5 → 6.x, addon 짝 맞추기(webgl 0.19, fit 0.11, web-links 0.12 — 지금은 5.5에 webgl 0.19 혼용).
  스크롤·viewport와 smoke 재확인. Main이 pty 출력을 묶어 보냄(16 ms 또는 64–100 KB, 숨긴 세션 100–250 ms) + 렌더러
  ACK 흐름 제어(대기 5면 pause, 2면 resume). 검증: `yes` 후 Ctrl-C가 빨리 먹는지. 리사이즈는 rAF로 합치고 cols/rows가
  바뀔 때만 `fit()`/pty resize. 스크롤백은 일괄 10,000줄 대신 종류별.
- **담당:** `src/entities/session/`(TerminalView, terminalBus), `electron/sessions.ts` 출력 경로, `package.json` xterm 의존성.

### T17 · 첫 실행 체크리스트
- [ ] **목표:** 첫 실행이 조용히 실패하지 않게. (#7)
- **명세:** 체크리스트 화면: PATH 복원(macOS, 있음), `claude` / `codex` / `git` 감지와 버전(Windows: 네이티브와 WSL
  배포판별). 없으면 설치 명령 복사, 바이너리 경로 직접 지정, "폴더 추가"(드래그앤드롭), "로그인은 CLI 안에서" 안내.
  선택 항목은 기본 건너뛰기. 한 번만 표시(`~/.aquila/`에 저장), 다시 열 수 있음.
- **담당:** `src/features/first-run/`, `electron/detect.ts`(+ 테스트).

### T18 · 한글 IME
- [ ] **목표:** 우리 호스트에서 한글 입력이 깨지지 않게. (#8)
- **명세:** smoke가 macOS·Windows에서 도는 회귀 체크리스트: 자모 분리, 중복 입력, 조합 중 표시, 조합 중 Enter/Space,
  한/영 전환 직후 Ctrl/⌘ 단축키. 우리 입력 계층에서 수정(VS Code의 xterm 통합 방식 기준). `--font-*` 토큰에
  `"Cascadia Mono", "D2Coding", Consolas` 폴백.
- **담당:** `electron/smoke.ts`(IME 시나리오), `TerminalView`의 IME 처리, 폰트 토큰.

### T9 · 배터리 측정 + 절전 프로필
- [ ] **목표:** 추측 말고 숫자로 — 그리고 배터리에서는 덜 쓰게. (#26)
- **명세:** `scripts/measure-energy.sh`: `top -l 6 -s 5 -o power`, `powermetrics --samplers tasks` idle wakeups/s,
  `yes` Ctrl-C 테스트. 같은 세션(Claude 5개, 1개 스트리밍)으로 Aquila Agents vs Terminal.app / Ghostty / iTerm2.
  결과는 `docs/en/ENERGY.md` + `docs/ko/ENERGY.md`. `powerMonitor`(`on-battery`, `speed-limit-change`, macOS
  `thermal-state-change`)로 절전 프로필: 폴링 간격 늘리기, 커서 깜빡임·반복 애니메이션 끄기. Windows 측정 도구는 미정.
- **담당:** `scripts/`, `electron/power.ts`, 위 두 문서.

## Next

### T19 · Windows 런타임
- [ ] **목표:** Windows 10 1809+ / 11, x64 + arm64, 네이티브와 WSL에서 제대로 동작. (#9–#13)
- **명세:**
  - node-pty: kill을 짧은 큐로 직렬화, 이미 끝난 pty는 kill 금지, 종료 시 남은 conhost 정리, CI에서 아키텍처별로
    Electron ABI에 맞춰 리빌드, 렌더러 `windowsPty: { backend: 'conpty', buildNumber }`(build number는 IPC로).
  - T13 맵의 단축키: Ctrl+Shift+T/W/K/G, Ctrl/Alt+1–9, Alt+방향키 포커스. Ctrl+C는 선택 있으면 복사, 없으면 SIGINT.
    Ctrl+V는 pty로(이미지 붙여넣기 — Ctrl+V vs Alt+V 실측). Ctrl+Alt 조합 금지(AltGr).
  - 창: `titleBarStyle: 'hidden'` + `titleBarOverlay`(높이 = `--size-titlebar`, 색은 토큰), `env(titlebar-area-*)`
    피하기. 창 컨트롤이 오른쪽이라 탭 바 오른쪽 끝 다시 보기.
  - 계정: spawn env의 `CLAUDE_CONFIG_DIR`(shared는 비움). WSL 세션은 "이 배포판에서 따로 로그인" 표시.
  - WSL 프로젝트: 프로젝트별 실행 환경(네이티브 / 배포판) 저장, 변경사항 패널은 `wsl.exe -e git`, NAT 모드에서
    hook이 필요하면 수신기 주소(호스트 IP + 토큰).
  - 알림: `app.setAppUserModelId()`, AUMID가 있는 시작 메뉴 바로가기.
- **담당:** `electron/platform/win32.ts`, `sessions.ts`의 Windows 부분, `main.ts` 창 옵션, CI 워크플로.

### T20 · Windows 패키징 + 서명
- [ ] **목표:** 사람들이 실행할 수 있는 Windows 설치 파일. (#28)
- **명세:** 서명 경로부터 결정(한국 개인: Azure Artifact Signing 불가, 한국 법인: 가능 → 법인 + Artifact Signing /
  미서명 + winget/scoop + SmartScreen 안내 / MSIX — MSIX 파일시스템 제약 확인). NSIS x64 + arm64, electron-updater
  (macOS도).
- **담당:** `electron-builder.yml`, `build/`, `electron/updater.ts`.

### T21 · 복원 v2
- [ ] **목표:** 다시 열면 내용까지, 빠르게. (#14 + T4 남은 것)
- **명세:** 탭마다 마지막 스크롤백을 `~/.aquila/`에 저장. resume이 실패하면 읽기 전용으로 보여주고 같은 폴더에 새 셸
  (cold restore). 보이는 탭부터 spawn, 백그라운드 탭은 처음 클릭할 때. codex 세션 id를 잡아 codex 탭 두 개가 각자
  세션으로 resume. 분할 레이아웃과 포커스된 탭 복원.
- **담당:** `electron/state.ts`, `src/widgets/split-view/model/`(레이아웃 저장/복원).

### T22 · 분할: 확대 + 크기 조절
- [ ] **목표:** 다시 나누지 않고 긴 출력 읽기. (#15 + T1 남은 것)
- **명세:** pane 확대 토글(한 pane이 화면을 채웠다가 되돌림), 구분선 드래그와 키보드 리사이즈, 크기는 레이아웃 트리에 저장.
- **담당:** `src/widgets/split-view/`.

### T23 · 앱 내 가이드(? 버튼)
- [ ] **목표:** 문서 없이도 모든 기능을 찾을 수 있게. (#16, 오너)
- **명세:** 사이드바 하단 `?`, ⌘/(Windows Ctrl+/, 보조 F1). 모달: 왼쪽은 검색되는 기능 목록, 오른쪽은 스크린샷이나 짧은
  루프(번들 WebP/MP4, reduced motion이면 첫 프레임), 1~2줄 설명, 단축키. 레지스트리
  `{ id, titleKey, bodyKey, media, shortcutId }`, 단축키는 T13 맵에서 읽음, 전체 단축키 시트 포함. 첫 실행 체크리스트
  다음에 한 번만 제안("둘러보기 / 건너뛰기"), `~/.aquila/`에 저장. 모달 껍데기는 디자인 시스템 컴포넌트(T27·T35와 공유).
- **담당:** `src/features/guide/`, `design-system/react/` 모달, `components.css`(추가만).

### T24 · 가이드 미디어 smoke 캡처
- [ ] **목표:** 가이드와 릴리즈 노트 화면이 낡지 않게. (#17, 오너)
- **명세:** smoke 시나리오가 고정 픽스처로(실제 사용자 데이터 없음) 가이드 항목별 데모 상태를 연출하고
  `capturePage(rect)`로 ko/en(OS 러너별) 캡처, 짧은 애니메이션 인코딩(도구 선택 필요). 미디어 없는 항목이 있으면 smoke 실패.
  해상도와 길이(3~5초) 예산.
- **담당:** `electron/smoke.ts`, `scripts/capture/`, `src/features/guide/media/`.

### T25 · 변경사항 패널 v2: 감시 + 리뷰 루프
- [ ] **목표:** 앱을 떠나지 않고 에이전트가 한 일을 리뷰하고 피드백 보내기. (#20, #21)
- **명세:** 5초 폴링 대신 `fs.watch`(재귀) + 300–500 ms 디바운스 + lazy diff, 30–60초 폴링은 안전망. "git working tree ·
  n초 전 갱신" 표시. unified / side-by-side, j/k 파일 이동. 줄 코멘트 → 프롬프트(`파일:줄` + 코드 인용 + 코멘트)를
  포커스된 세션 입력에 붙여넣기, 전송은 사용자가 Enter. 그다음 확인창(+ stash 백업)이 있는 hunk/파일 stage·revert,
  "세션 시작 이후 diff"(spawn 때 HEAD 기록), "커밋 메시지 / PR 설명 써줘" 프롬프트 붙여넣기 버튼. Windows는 `git.exe` 탐지.
- **담당:** `electron/git.ts`, `src/widgets/changes-panel/`, `src/entities/diff/`.

### T11 · 세션 기록 (읽기 전용)
- [ ] **목표:** 지난 세션을 찾아서 resume — CLI picker가 비워 둔 자리. (#22)
- **명세:** ⌘Y 패널: 계정마다 Claude `<configDir>/projects/*/*.jsonl`, Codex jsonl rollout **과** SQLite 저장소(읽기 전용
  어댑터). 묶음은 인코딩된 폴더명이 아니라 transcript 안의 `cwd` 기준. 행: 지정 이름(없으면 첫 사용자 메시지), 마지막 활동,
  브랜치/cwd, 계정, 세션 id 복사. 이름·첫 메시지·본문 전체 검색. resume은 항상 id로 새 탭에서(`claude --resume <id>` +
  맞는 계정 / `codex resume <id>`). `cleanupPeriodDays` 30일 삭제 경고, Markdown 내보내기. 이름·즐겨찾기는
  `~/.aquila/`에(`~/.claude*`에는 절대 안 씀). **`~/.claude*` / `~/.codex`에서 아무것도 지우거나 쓰지 않음.**
- **담당:** `electron/history.ts`(+ 픽스처 파일 테스트), `src/widgets/history-panel/`, `src/features/resume-session/`.

### T26 · 프로젝트 설정
- [ ] **목표:** JSON 대신 프로젝트별 기본값. (#23 + T5 남은 것)
- **명세:** 프로젝트 설정 다이얼로그: 경로(변경 가능), 실행 환경(네이티브 / WSL 배포판 / SSH 호스트, T29), 기본 에이전트,
  기본 브랜치, setup 스크립트, 포트 베이스, "Open in" 에디터. 같은 폴더 중복 경고. 팔레트에 "프로젝트 추가".
- **담당:** `src/features/manage-projects/`, `electron/config.ts`.

### T28 · 터미널 보조 기능
- [ ] **목표:** 매일 겪는 불편을 호스트에서 작게 해결. (#27)
- **명세:** 클립보드가 이미지일 때 ⌘V(그리고 파일 드래그앤드롭) → 임시 파일로 저장하고 경로를 세션에 입력. "마지막 응답
  복사". 위로 스크롤하면 자동 스크롤 멈추고 "맨 아래로" 버튼. 키보드 URL/경로 선택(QuickSelect식).
- **담당:** `src/features/terminal-helpers/`, `TerminalView` 소폭 수정.

### T29 · 원격 세션(SSH) MVP
- [ ] **목표:** 프로젝트를 이 Mac 또는 SSH 서버에서 열기. (#43, #44, 오너)
- **명세:** `project.location = local | ssh { alias, path, claudeConfigDir }`. 실행:
  `ssh -t <alias> -- tmux -L aquila new-session -A -s aq-<id> -c <path> -e CLAUDE_CONFIG_DIR=… '<cmd>'`(전용 tmux 서버,
  원격 `~/.aquila/tmux.conf`에 `allow-passthrough on`). 3→6→12→60초 백오프 재연결, `ServerAliveInterval=20`, 앱을
  다시 켜면 `tmux -L aquila ls`로 재부착. 상태는 T14와 같은 OSC 파서(tmux를 지나 7501 왕복 실측), 폴백은 출력 휴리스틱.
  첫 연결: `uname`, `claude`/`codex`/`tmux`/`git`과 로그인 확인, 설치 명령은 *안내만*. 사용자의 `~/.ssh/config`와
  ssh-agent 사용, 비밀 저장 안 함, 원격 `~/.aquila/` 밖에는 안 씀. UI: 호스트 배지, 연결 점(연결됨 / 다시 연결 중 /
  끊김), 끊기면 배너, `KillUserProcesses=yes` 안내.
- **담당:** `electron/remote/`, `src/entities/project`(호스트 배지), `sessions.ts`·`config.ts` 소폭 수정.

## Later

### T27 · 릴리즈 노트 모달 + 파이프라인
- [ ] **목표:** 업데이트 뒤 무엇이 바뀌었는지 한 번 보여주기. (#29, #30, 오너)
- **명세:** `~/.aquila/`의 `lastSeenVersion`과 `app.getVersion()` 비교, 높을 때만 열기(새 설치면 안 띄우고 버전만 기록,
  대신 가이드 제안). T23과 같은 모달: 미디어 있는 헤드라인 3~5개, "사용법 보기" → 가이드 항목. `?` 메뉴 "새로운 기능"에서
  지난 버전 목록, 건너뛴 버전은 묶어서. 버전별로 번들(`release-notes/<version>.{ko,en}.md` 또는 `guideId`·미디어가 있는
  JSON), 오프라인. 초안은 지난 태그 이후 Conventional Commits에서 만들고 사람이 다듬음. 해당 버전 ko/en 노트가 없으면 패키징 실패.
- **담당:** `src/features/release-notes/`, `release-notes/`, `scripts/release-notes.ts`.

### T30 · 계정별 사용량 게이지
- [ ] **목표:** 5시간·주간 한도가 계정별로 얼마나 남았는지. (#33)
- **명세:** 세션별이 아니라 계정 config 폴더별로(statusline은 계정이 섞임), 리셋 시각과 함께 나란히, "추정" 표기.
  한도 임박 시 알림 + "다른 계정으로 새 세션 열기".
- **담당:** `electron/usage.ts`, `src/widgets/usage-gauge/`.

### T31 · 탭별 컨텍스트 게이지
- [ ] **목표:** auto-compact에 놀라기 전에 컨텍스트 사용량 보기. (#34)
- **명세:** 주입하는 `--settings`에 statusline 명령을 넣어 `context_window` JSON을 `~/.aquila/`에 기록, 탭마다 작은 게이지
  (60% 근처 힌트). 사용자가 자기 `statusLine`을 쓰면 주입 안 함(우리 것이 대체해 버림).
- **담당:** `electron/hooks.ts`(설정 파일), `src/entities/session` 게이지.

### T32 · Figma MCP (선택)
- [ ] **목표:** 클릭 한 번으로 프로젝트의 Claude에 공식 Figma MCP 연결. (#35, #36)
- **명세:** 기본 꺼짐, 프로젝트별 토글, 꺼지면 Figma UI 숨김. `~/.aquila/mcp/figma.json`(`https://mcp.figma.com/mcp`)을
  `--mcp-config`로(`--strict-mcp-config` 없이), 인증은 CLI 안에서(`/mcp`). Codex: `-c mcp_servers.figma.*` 실측, 안 되면
  확인 후 repo `.codex/config.toml`에 쓰기. "연결"은 숨은 짧은 `claude -p`로 `whoami`를 불러 플랜·시트를
  `~/.aquila/figma-profile.json`에 캐시(방어적 파싱, 모르면 "알 수 없음"). 비활성 사유는 툴팁("Dev 시트 필요",
  "Organization 플랜이 필요할 수 있음"), 한도 숫자는 하드코딩 말고 Figma 문서 링크.
- **담당:** `electron/figma.ts`, `src/features/figma/`.

### T33 · 앱 내 프리뷰 + 요소 선택
- [ ] **목표:** 돌아가는 앱을 가리키며 에이전트에 고칠 것 말하기 — Claude와 Codex 둘 다. (#37)
- **명세:** dev server 감지(`.claude/launch.json`, pty 출력의 `localhost:\d+`). 디바이스 프리셋 390/768/1440의
  `WebContentsView`. Select 모드에서 selector, 텍스트, computed style, 가능하면 React 컴포넌트명, `capturePage(rect)` 크롭을
  모아 포커스된 세션에 텍스트 + 이미지 경로로 붙여넣기. "디자이너 프리셋" 레이아웃: 터미널 + 프리뷰 + Figma 패널.
- **담당:** `src/widgets/preview/`, `electron/preview.ts`.

### T34 · Figma 프롬프트 칩 + Design vs Build
- [ ] **목표:** 덜 타이핑하고 디자인→코드 결과는 더 좋게. (#38)
- **명세:** Figma 링크를 붙이면 프롬프트 칩 제안("기존 컴포넌트와 토큰으로 이 프레임 구현" — `get_variable_defs`로 토큰 먼저,
  프론트엔드는 `download_assets` 에셋, 백엔드는 `get_figjam` 플로우와 `get_comments` → TODO). 프리뷰 캡처 위에 Figma
  `get_screenshot` 겹쳐 보기. 선택: REST `/v1/files/:key` 버전 폴링으로 "디자인이 바뀌었나" 확인(REST 토큰 필요, 고급 설정).
- **담당:** `src/features/figma/`(칩, 오버레이).

### T35 · AI 트렌드 버튼
- [ ] **목표:** 앱을 떠나지 않고 내 CLI와 업계의 새 소식 보기. (#39)
- **명세:** Main이 시작 시와 6시간마다 가져와 `~/.aquila/news-cache.json`에 캐시, 새 IPC 채널로 전달. 소스: GitHub
  Releases(claude-code, codex. ETag, 60 req/h 한도, prerelease 제외), Claude Code CHANGELOG, OpenAI News RSS, Cursor
  changelog RSS, Antigravity blog RSS, Simon Willison, Latent Space, HN Algolia(`points%3E100`). 탭 1 "내 CLI 업데이트":
  로컬 `claude --version` / `codex --version`보다 새 릴리스의 "Added" 줄 3~5개. 탭 2 "업계 흐름": 키워드 분류(subagent,
  hook, agent view, ADE, harness). 사이드바 상단 띠에 버튼 + 미확인 배지. 제목·링크·짧은 발췌만. LLM 요약은 `claude -p`
  옵트인(사용자 쿼터 사용). 모달은 T23과 공유, 제목·아이콘은 다르게("AI 트렌드" vs "새로운 기능").
- **담당:** `electron/news.ts`(+ 피드 파싱 테스트), `src/widgets/trends/`.

### T36 · 원격 패널
- [ ] **목표:** 원격 프로젝트에서도 변경사항 패널과 기록. (#45)
- **명세:** 같은 SSH 연결(ControlMaster)로 `git` / 기록 읽기, 지연 실측. Windows OpenSSH는 별도 제어 채널 필요.
- **담당:** `electron/remote/`, `git.ts` / `history.ts`의 원격 어댑터.

### T10 · 라이트 테마
- [ ] `tokens.css`에 `[data-theme='light']` 시맨틱 재매핑, `nativeTheme` 추종. 터미널 테마와 Windows `titleBarOverlay` 색도
  따라감. 컴포넌트 수정 금지. (#41)
