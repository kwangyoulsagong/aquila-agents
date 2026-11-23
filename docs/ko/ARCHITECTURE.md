# 아키텍처

> English: [../en/ARCHITECTURE.md](../en/ARCHITECTURE.md)

```
┌──────── 렌더러 (src/, React, FSD) ────────┐        ┌──────────── Main (electron/, Node) ─────────────┐
│ app/      진입점, 전역 스타일                │  IPC   │ main.ts       창 + IPC 핸들러                     │
│ pages/    workspace (상태 훅, 단축키)        │◀──────▶│ config.ts     ~/.aquila/config.json             │
│ widgets/  sidebar, session-tabs,          │preload │ sessions.ts   세션마다 node-pty 하나              │
│           split-view, changes-panel,      │        │ accounts.ts   계정 상태, ~/.claude-* 폴더,        │
│           command-palette                 │  .ts   │               zsh 함수 (명시적 클릭만)            │
│ features/ switch-account, switch-language,│        │ hooks.ts      127.0.0.1:<port> hook 수신기       │
│           open-session, setup-account,    │        │               + ~/.aquila/claude-hooks.json     │
│           manage-projects, next-waiting,  │
│           first-run, guide                │        │ git.ts        git status/diff, 감시, stage/revert│
│ entities/ session (xterm, 상태), project    │        │ state.ts      ~/.aquila/state.json (탭, 레이아웃)│
│                                           │        │               + scrollback/ (T21)                │
│                                           │        │ codex.ts      탭별 codex 세션 id (T21)           │
│           diff                            │        │ worktrees.ts  git worktree 만들기 / 재사용 / 삭제│
│           open-in-worktree                │        │ menu.ts       네이티브 우클릭 메뉴               │
│                                           │        │ appMenu.ts    macOS 메뉴 막대 (T47)              │
│                                           │        │ notify.ts     알림, 리마인더, Dock 배지          │
│                                           │        │ status/       OSC 7501 파서 + 상태 판정          │
│                                           │        │ output.ts     출력 묶음 + 흐름 제어              │
│                                           │        │ power.ts      절전 프로필: 배터리·발열 (T9)      │
│           usage-gauge                     │        │ usage.ts      계정별 5시간·주간 사용량 (T30)     │
│                                           │        │ context.ts    탭별 컨텍스트 사용량 (T31)         │
│                                           │        │ figma.ts      Figma MCP 인자 + whoami (T32)      │
│           trends                          │        │ news.ts       CLI 릴리스 + AI 소식 피드 (T35)    │
│           preview                         │        │ preview.ts    dev server, 프리뷰 뷰, 선택 (T33)  │
│           run-slot                        │        │ runs.ts       Run 슬롯: dev 서버 / 워처 (T60)    │
│                                           │        │ detect.ts     CLI 점검, 첫 실행 상태 (T17)       │
│                                           │        │ guide.ts      둘러보기 제안 한 번만 (T23)        │
│                                           │        │ releaseNotes  마지막으로 본 버전 (T27)           │
│                                           │        │ updater.ts    업데이트 확인·설치 (T27, T20)      │
│                                           │        │ history.ts    지난 세션, 읽기 전용 (T11)         │
│                                           │        │ terminalHelpers.ts 클립보드 경로, 마지막 응답    │
│                                           │        │ remote/       ssh + tmux, 재연결, 호스트 확인    │
│                                           │        │ platform/     셸, spawn, git, kill (T19)         │
│                                           │        │ smoke.ts      npm run smoke 자동 점검            │
│ shared/   api (타입·IPC·bridge), i18n       │        │                                                 │
└───────────────────────────────────────────┘        └─────────────────────────────────────────────────┘
                                                              │ 실행 (로그인 + 인터랙티브 zsh)
                                                              ▼
                              claude --settings ~/.aquila/claude-hooks.json  |  codex  |  $SHELL
```

## FSD 규칙 (렌더러)

- 레이어 순서: `app → pages → widgets → features → entities → shared`. **아래 레이어만** import 가능.
- 다른 슬라이스는 공개 index로만: `@/entities/session` (O), `@/entities/session/ui/TerminalView` (X).
- 같은 레이어의 슬라이스끼리 import 금지. 슬라이스 사이는 `@/` 별칭 사용.
- ESLint(`eslint.config.mjs`)가 위 규칙을 강제합니다. `npm run lint`에서 걸립니다.
- `shared/api/types.ts`와 `shared/i18n/dictionary.ts`는 main 프로세스도 같이 씁니다. 그래서 의존성 없이 유지해요.

## 세션 흐름

1. 렌더러가 `createSession(projectId, kind)` 호출.
2. Main이 프로젝트 폴더에서 `$SHELL -l -i -c "<명령>; exec $SHELL -l -i"` 실행. 그래서 PATH/fnm/alias가 그대로 동작하고,
   에이전트가 끝나면 탭이 셸로 남습니다. spawn은 `electron/platform/`을 거칩니다(T19): sessions.ts는 명령을 argv로
   만들고(`SessionCommand`: 프로그램 + 인자, 이어하기 실패 표시, setup 스크립트) 플랫폼 레이어가 셸 문법으로 씁니다.
   macOS: 위의 로그인 셸. Windows: pwsh 7 > Windows PowerShell 5.1 > Git Bash > CMD (`-NoLogo -NoExit -EncodedCommand`,
   `bash -l -i -c`, `cmd /S /K`). `\\wsl.localhost\<배포판>\…` 아래 폴더는 `wsl.exe -d <배포판> --cd <리눅스 경로> -- bash -lic
   "…; exec bash -l -i"`로 실행하고 git도 `wsl.exe … -e git`으로 돌립니다. WSL 안의 Claude는 `--settings`·계정 폴더·Figma
   설정 없이 뜨고(배포판 안에서 따로 로그인) 원격 탭처럼 출력 활동으로 상태를 추정합니다. kill은 `KillQueue`를 거칩니다
   (Windows에선 50ms 간격으로 하나씩, 이미 끝난 pty는 kill하지 않음). Windows에서 종료할 때는 세션마다 `taskkill /T`도 실행합니다.
3. 세션별 환경변수: `AQUILA_TAB_ID`, `AQUILA_PORT`, 그리고 **개인** 계정의 Claude 세션에만
   `CLAUDE_CONFIG_DIR=~/.claude-personal` (`claude-personal` 셸 함수와 같음). **공용** 계정은 설정하지 않음(그냥 `claude`).
   Claude가 이 변수로 키체인 항목을 구분하기 때문에 `~/.claude`로 명시하면 안 됩니다.
   프로젝트에 **포트 시작 번호**(T26)가 있으면 `PORT`와 `AQUILA_PORT_BASE` = 시작 번호 + 10 × `git worktree list`에서의
   워크트리 순서(메인 = 0)도 넣어요. 워크트리마다 개발 서버 포트가 겹치지 않아요.
4. pty 출력 → `electron/output.ts`가 묶어서(16 ms 프레임 또는 64 KB마다 한 메시지, `session:visible`로 화면 밖이면
   200 ms, 절전 모드에서 화면 밖이면 1초 — `electron/power.ts`, `ENERGY.md` 참고) → `session:data` → `terminalBus` → 해당 id의 xterm (아직 안 붙었으면 버퍼에 보관).
   **흐름 제어:** xterm이 묶음을 다 쓰면 렌더러가 `session:ack`을 보냄. 확인 안 된 묶음이 5개면 main이 pty를 멈추고
   2개가 되면 다시 읽음 → `yes` 같은 폭주에도 수 MB가 쌓이지 않고 Ctrl+C가 즉시 먹힘(smoke가 확인). 렌더러가
   새로고침되면 카운트 초기화. 터미널이 붙기 전에 버퍼에 들어간 출력은 받는 즉시 ack.
5. 안 보이는 세션도 마운트 상태 유지(`hidden`) → 스크롤 기록 유지, xterm은 숨겨진 화면을 그리지 않음. WebGL
   (`lib/gpuPool.ts`): 화면에 보이는 터미널은 항상 사용, 숨긴 터미널은 합쳐서 12개까지 유지하고 가장 오래 안 보인
   것부터 DOM 렌더러로 바꿈(Chromium은 페이지당 live context ~16개, 넘으면 오래된 것을 끊음. DOM 렌더러는 메모리를 더
   씀: 세션 15개에서 숨긴 터미널 전부 WebGL을 끄면 +125 MB로 측정됨). context loss는 DOM으로(3번 잃으면 그 터미널은
   계속 DOM). 스크롤바는 스크롤 기록이 있을 때만 보임. 크기 변경은 프레임당 한 번으로 모으고 cols/rows가 바뀔 때만 refit.
   스크롤 기록: 셸 10,000줄, Claude/Codex 5,000줄(`model/terminal.ts`). xterm 6.x.

## 화면 분할

- `widgets/split-view/model/layout.ts`: 패널의 이진 트리(최대 4개), 순수 함수 + 테스트. 패널마다 세션 하나 또는
  없음(빈 화면 → 열기 버튼). 레이아웃은 **전역**이라 여러 프로젝트 세션을 섞어 띄울 수 있음.
- 터미널은 패널의 자식이 아님: 모든 세션을 평평한 목록에 한 번만 마운트하고 패널 위치에 절대 배치.
  분할을 바꿔도 xterm이 다시 마운트되지 않고, 크기 변화로 다시 맞춤.
- 포커스된 패널의 세션이 활성 세션. 다른 프로젝트 패널에 포커스하면 사이드바/탭도 그 프로젝트로 바뀜.
  프로젝트를 고르면 그 프로젝트를 띄운 패널로 포커스, 없으면 포커스된 패널이 그 프로젝트의 마지막 세션을 띄움.
- 탭은 드래그 가능(`shared/lib/sessionDrag.ts`). 패널 가장자리에 놓으면 분할, 가운데에 놓으면 교체.

## 변경사항 패널

- ⌘⇧G (또는 탭 바의 ± 버튼)로 선택한 프로젝트의 `widgets/changes-panel`을 오른쪽에 열고 닫습니다.
- Main (`git.ts`, `git:changes`): `git status --porcelain=v1 -b -z` → 브랜치, ahead/behind, 파일(상태 글자
  M A D R C U ?); `git diff --no-color HEAD` (첫 커밋 전에는 `git diff`) + 추적 안 된 파일 최대 20개를 새 파일 diff로
  (`--no-index /dev/null`). 출력은 400KB에서 줄 끝 기준으로 자릅니다. 읽기만 하고, `GIT_OPTIONAL_LOCKS=0`이라
  에이전트와 `index.lock`을 다투지 않습니다.
- 렌더러: `entities/diff`가 diff를 파일/줄로 나누고 옛/새 줄 번호와 hunk 번호를 붙여(`parseDiff`, 테스트 있음)
  `.c-diff`로 한 줄 또는 나란히(`toSplitRows`) 그립니다. 파일을 누르면 그 위치로 스크롤, j/k로 파일 이동.
- 새로고침(T25): 패널이 열려 있는 동안 main이 트리에 재귀 `fs.watch` 하나를 둡니다(`TreeWatcher`: 400ms 디바운스,
  최대 2초 대기, `.git/` 내부와 `node_modules`는 무시) → `git:changed`. 렌더러는 앱 포커스 때, 그리고 안전망으로 45초마다
  새로고침. 매번 `git status`만 돌리고, diff는 지문(status + HEAD + 바뀐 파일의 mtime/크기)이 바뀌었을 때만 다시 만듭니다.
  바에는 "git 작업 트리 · n초 전 업데이트".
- 세션 시작부터: `SessionManager`가 세션 spawn 때 HEAD를 기록하고(`startHeadOf`), "세션 시작부터"는 그 커밋과
  비교(`git diff <base>` + 추적 안 된 파일)해서 커밋된 작업도 보여요.
- 리뷰 루프: 줄을 누르면 코멘트 입력. "코멘트 붙여넣기"는 프롬프트 하나(`파일:줄`, 코드 인용, 코멘트)를 만들어 xterm의
  `paste`로 포커스된 세션에 붙여넣어요(`entities/session` → `pasteIntoSession`, CLI가 원하면 bracketed paste). 전송은 안
  해요 — Enter는 사용자가. "커밋 메시지" / "PR 설명"은 정해진 프롬프트를 붙여넣어요.
- 스테이지 / 되돌리기(`git:action`): 파일 stage/unstage/revert, 그리고 스테이징된 게 없는 일반 수정 파일이면 hunk
  stage/revert(hunk는 HEAD 기준 패치, `git apply [--cached|-R]`). 되돌리기는 확인창을 거치고 먼저 백업해요: 추적 중인
  상태는 `git stash` 항목으로(`stash create` + `stash store`, 트리는 안 건드림), 추적 안 된 파일은 휴지통으로.

## 명령 팔레트

- ⌘K로 `widgets/command-palette`를 열고 닫습니다(네이티브 `<dialog>` 위의 `.c-palette`, 화면 위쪽). 열린 세션
  (급한 순: waiting > error > done > working > idle), 프로젝트(사이드바 순서), 동작 순으로 보여요.
- 동작: Claude / Codex / 셸 열기, 워크트리에서 새 Claude, 오른쪽 / 아래로 분할, 변경사항 패널, 세션 닫기, 언어 바꾸기. 워크스페이스는 지금
  할 수 있는 동작에만 핸들러를 넘겨요(프로젝트 없음 → 열기 없음, 세션 없음 → 닫기 없음).
- `shared/lib/fuzzy.ts`(테스트 있음): 검색어 글자가 순서대로 있으면 매치, 대소문자 무시. 단어 시작(camelCase 포함)과
  연속 글자는 점수가 높고, 건너뛴 글자는 조금 깎여요. 프로젝트는 그룹 · 경로로도 찾히지만 이름 매치보다 아래.
  매치된 글자는 강조돼요.
- ↑↓(또는 ⌃N/⌃P)로 고르고 Enter로 실행, Esc / 바깥 클릭으로 닫기. 한글 조합 중에는 키를 무시해요.
  명령은 다이얼로그가 닫히고 포커스를 돌려준 다음 프레임에 실행돼서, 새로 보이는 터미널이 키보드를 받아요.

## 세션 기록

- ⌘Y (또는 ⌘K → "세션 기록")로 `widgets/history-panel`을 열어요: 넓은 `Modal` — 검색, 필터(전체 / 즐겨찾기 /
  Claude / Codex), 실행된 폴더별로 묶인 지난 세션(최근 묶음이 위), 고른 세션의 상세: 버튼, 메타(에이전트 + 계정,
  시간, 프로젝트, 폴더, 브랜치, 메시지 수, ID 복사)와 대화 앞부분.
- Main (`history.ts`, `HistoryIndex`, 읽기 전용): 계정마다 Claude `<configDir>/projects/*/<id>.jsonl` (두 계정이 같은
  폴더면 한 번만; `subagents/` 폴더는 건너뜀); codex는 가장 최신 `~/.codex/state_<n>.sqlite`의 `threads`를
  `node:sqlite` `readOnly: true`로, 텍스트와 DB에 없는 세션은 `sessions/YYYY/MM/DD/` rollout 파일로, 이름은
  `session_index.jsonl`에서; 보관(archived)된 스레드는 뺌. 묶음은 transcript 안의 `cwd` 기준. 파싱한 파일은
  mtime + 크기로 캐시(약 160개 / 630 MB 첫 스캔 ≈ 1.7초, 다시 열기 ≈ 10ms). 세션마다 사용자 + 어시스턴트 텍스트만
  보관(도구 호출/결과, thinking, 슬래시 명령 래퍼, 주입된 컨텍스트, 사이드체인 제외), 검색·미리보기용으로 약 20만 자까지.
- 제목: 우리 이름 › CLI 이름(Claude `/rename`, codex 스레드 이름) › Claude ai-title › 첫 메시지. 검색: 렌더러가
  제목 / 첫 메시지 / 폴더 / 브랜치 / ID를 입력 그대로 찾고, main의 `history:search`가 전문 검색 결과(대소문자 무시
  부분 문자열)와 스니펫을 더해요. 스니펫은 대화에만 있을 때 보여요.
- 이어하기 (↵ 또는 버튼, `features/resume-session` → `history:resume`): main이 자기 인덱스에서 ID를 찾고, cwd를
  담은 프로젝트(가장 깊은 폴더) 또는 `<저장소>-wt/…` 워크트리를 골라 새 탭에서 `claude --resume <id>`(그 transcript가
  있는 계정으로) 또는 `codex resume <id>`를 열어요. 프로젝트 폴더가 아닌 cwd는 탭의 워크트리가 돼요(재실행 때 그
  자리로 복원). 프로젝트가 아닌 폴더는 먼저 추가("프로젝트로 추가하고 이어하기"). 폴더가 없으면 오류.
- 이름과 즐겨찾기: `~/.aquila/history.json` (`history:set-meta`). 내보내기: 저장 대화상자 → 디스크에서 다시 읽은 전체
  대화 Markdown. Claude의 `cleanupPeriodDays`(`<configDir>/settings.json`, 기본 30)를 아래에 보여 주고, 삭제까지
  7일 안 남은 세션(mtime + 기간)에는 주황 안내.
- **`~/.claude*`, `~/.codex` 아래는 쓰지도, 이름을 바꾸지도, 지우지도 않아요** (테스트가 fixture 폴더를 스냅샷으로 확인).

## 워크트리 세션

- "워크트리에서 열기…"(탭 바의 **+** 우클릭, 또는 ⌘K 팔레트) → `features/open-in-worktree` 다이얼로그:
  브랜치 입력칸(로컬 브랜치 추천), 무엇을 어디에 하는지 알려주는 한 줄, 에이전트(Claude / Codex / 셸, 기본값 = 프로젝트 기본 에이전트).
- 기존 워크트리(T38): **+** 메뉴의 "워크트리" 하위 메뉴(브랜치 → Claude / Codex / 셸, 메뉴를 열 때 `worktree:info`로 읽음),
  ⌘K에는 현재 프로젝트의 연결된 워크트리마다 "Claude · <브랜치>" 등(팔레트를 열 때 읽음). 둘 다 `session:create-worktree`로
  가서 워크트리를 재사용해요.
- Main (`worktrees.ts`, `session:create-worktree`): `git check-ref-format --branch`로 이름을 확인한 뒤, 그 브랜치가
  이미 체크아웃된 워크트리가 있으면 재사용(`git worktree list --porcelain`, 메인 포함), 없으면 메인 워크트리 옆
  `<repo>-wt/<branch>`에 `git worktree add` — 브랜치가 있으면 체크아웃, 없으면 프로젝트의 **기본 브랜치**(T26, 커밋을
  가리킬 때) 또는 현재 HEAD에서 `-b`로 만들어요. 실패하면 git 메시지를 다이얼로그에 보여줘요.
  새 워크트리에는 저장소의 **`.worktreeinclude`**(gitignore 문법)에 적힌 파일을 메인 워크트리에서 복사해요 — git이 무시하는
  파일만(`git ls-files --others --ignored --directory --exclude-from=.worktreeinclude`를 `git check-ignore`로 거름), 덮어쓰지 않아요.
  이번에 새로 만든 워크트리는 에이전트보다 먼저 세션의 로그인 셸에서 프로젝트 **셋업 스크립트**를 한 번 보이게 실행해요
  (실패해도 에이전트는 시작).
- 세션(`SessionInfo.worktree = { path, branch }`)은 그 폴더에서 시작. 탭에 브랜치가 보이고(`.c-tab__branch`, 툴팁에 경로),
  분할 화면 헤더·팔레트 이름·알림 제목에도 붙어요.
- 변경사항 패널은 포커스된 세션을 따라가요: 워크트리 세션이면 그 워크트리를 보여줘요(경로는 main이 살아 있는 세션 id로
  찾고, 렌더러가 준 경로는 쓰지 않아요).
- `worktree:info`는 다이얼로그에 저장소 루트, 현재 브랜치, 로컬 브랜치, 기존 워크트리를 알려줘요(읽기만).
- **정리**(**+** 메뉴와 ⌘K의 "워크트리 정리…"): `worktree:candidates`가 연결된 워크트리(잠기지 않고, 폴더가 있고, 브랜치가
  있는 것)를 `merged`(`git merge-base --is-ancestor <branch> <base>`, base = 기본 브랜치 또는 HEAD), `clean`(`git status
  --porcelain`이 비어 있음), `open`(살아 있거나 잠든 탭이 거기서 실행 중)과 함께 알려줘요. 병합 + 깨끗 + 안 열림은 추천,
  깨끗하고 닫힌 것은 모두 삭제 가능. 삭제는 한 번 더 묻고 `worktree:remove`가 그냥 `git worktree remove`를 실행 —
  **`--force`는 절대 안 씀**. main이 프로젝트의 연결된 워크트리인지, 탭에서 열려 있지 않은지 다시 확인해요. 브랜치는 남아요.

## 다시 열면 복원

- Main이 `~/.aquila/state.json`(version 2)에 열린 탭을 탭 순서대로 (`{ key, projectId, kind, account?, worktree?,
  claudeSessionId?, codexSessionId? }`), 그리고 분할 레이아웃(leaf에 탭 **key**가 든 pane 트리 + 포커스 pane 번호)을 저장.
  세션 생성·종료·Claude/codex 세션 변경·레이아웃 변경 때마다 다시 씀(임시 파일 + rename)이라 앱이 죽어도 남아요. `key`는
  실행이 바뀌어도 탭에 붙어 있는 uuid. 시작할 때 세션이 생기기 전에 한 번 읽고, 종료할 때 pty를 끄면서 덮어쓰지 않아요.
  렌더러는 복원을 마친 뒤에야 레이아웃을 보내서(`layout:save`) 저장된 레이아웃을 먼저 덮어쓰지 않아요. smoke는 읽지도 쓰지도 않아요.
- Claude 탭은 우리가 만든 `--session-id <uuid>`로 시작. `SessionStart` hook이 Claude의 stdin JSON을 hook 수신기
  (`POST /hook`)로 보내서, `/clear`나 resume 뒤에도 저장된 id가 따라가요.
- 설정을 읽은 뒤 렌더러가 `restoreSessions()`를 실행 1회당 한 번 호출: Claude → `<configDir>/projects/*/<id>.jsonl`이
  있으면 `claude --resume <id>`(Claude는 첫 메시지 뒤에야 이 파일을 씀), 없으면 새 세션. codex → 잡아 둔 id로
  `codex resume <id>`, 없으면 새 codex(T4의 `version: 1` 파일이면 `codex resume --last`). 셸 → 저장된 출력 아래 새 셸
  (cold restore). 없어진 프로젝트의 탭은 버리고, 없어진 계정은 프로젝트 계정으로 대체. 워크트리 탭은 그 워크트리에서 다시 열고,
  폴더가 없어졌으면 버려요.
- **보이는 탭 먼저:** 저장된 레이아웃의 pane에 있는 탭만 spawn(레이아웃이 없으면 첫 프로젝트의 첫 탭). 나머지는
  `dormant`(`SessionInfo.dormant`, pty도 xterm도 없음)로 돌아오고 state.json에서 자리를 지켜요. 렌더러가 그 탭이 처음
  화면에 나올 때 `startSession(id)`를 부르면 main이 같은 id로 spawn. 렌더러는 `fromSaved`로 레이아웃을 다시 만들고
  (모르는 세션의 pane은 비움), 남은 게 없으면 처음 spawn된 탭을 포커스 pane에 넣어요.
- **스크롤백:** 터미널마다 normal 버퍼를 일반 텍스트로 스냅샷(`entities/session/lib/snapshot.ts`: 줄바꿈된 행은 합침,
  마지막 2,000줄) — 바뀌었을 때 10초마다(절전 모드 30초), 그리고 unload 때 → `session:scrollback` →
  `~/.aquila/scrollback/<key>.txt`(512 KB 상한, 뒤쪽 유지). 일부러 일반 텍스트: TUI 출력 중간부터 raw escape를 다시 그리면
  깨져요. 탭을 닫으면 파일도 지우고, 더 이상 저장되지 않은 탭의 파일은 복원 때 정리해요.
- **Cold restore:** main이 저장된 텍스트를 세션 자체 출력보다 먼저 스트림에 씀 — 흐리게, 제어 문자 제거, 마지막에
  "이전 출력 · <시각> · 읽기 전용" 배너. 셸은 항상. resume된 Claude/codex는 안 씀(CLI가 자기 대화를 보여줌). 대신 명령이
  `<resume> || printf '\e]7501;aquila-resume-failed\a'`이라, spawn 후 20초 안에 이 마커가 오면(OSC 스캐너가 봄) "세션을
  이어서 열지 못했어요"와 함께 저장된 텍스트를 보여주고, 탭은 평소처럼 그 폴더의 셸로 떨어져요.
- **Codex 세션 id**(`codex.ts`, 읽기 전용): codex는 첫 프롬프트 때 `~/.codex/sessions/YYYY/MM/DD/rollout-<시각>-<id>.jsonl`을
  쓰고, 첫 줄이 `id`·`cwd`가 든 `session_meta`. id를 모르는 codex 탭에서 Enter를 치면 main이 (1.5초, 6초 뒤) 그 탭이
  spawn된 뒤 시작한 rollout의 머리를 읽고, 새 rollout마다 cwd가 같고 Enter 시각이 시작 시각에 가장 가까운 탭에 줘요
  (다른 탭이 가진 id는 건너뜀).

## 터미널 도우미 (T28)

`features/terminal-helpers/`가 세션마다 터미널 위에 `TermOverlay`를 그려요(분할 화면에서 `TerminalView` 옆에 렌더).
xterm 인스턴스는 `useTerminal(id)`(`entities/session`, `TerminalView`가 채우는 레지스트리)로 받아서, 터미널은 계속
엔티티가 소유해요.

- **⌘V로 파일·이미지:** xterm 루트의 capture `paste` 리스너가 xterm보다 먼저 받아요. 클립보드에 파일이 있으면
  `clipboard:paths`(main, `electron/terminalHelpers.ts`)가 Finder에서 복사한 경로는 그대로, 이미지는
  `$TMPDIR/aquila-paste/paste-<시각>.png`로 저장해서(하루 지나면 삭제) 돌려줘요. 경로는 셸 이스케이프해서 입력처럼
  붙여 넣어요(bracketed paste) → Claude/Codex가 이미지로 첨부. 일반 텍스트 붙여넣기는 그대로예요.
- **파일 끌어다 놓기:** 터미널의 `dragover`/`drop`(탭 드래그 제외) → `webUtils.getPathForFile` → 같은 이스케이프 경로.
- **마지막 응답 복사**(⇧⌘C, 팔레트, 우클릭): `session:last-reply`가 탭의 대화 기록 끝 4 MB를 읽어요 — Claude
  `<configDir>/projects/*/<세션 id>.jsonl`, Codex `rollout-…-<id>.jsonl` — 마지막 assistant 메시지의 텍스트(Claude는 그
  메시지의 텍스트 블록을 이어 붙임, 도구·thinking 제외)를 돌려줘요. 읽기 전용.
- **맨 아래로:** 위로 스크롤하면 xterm 6이 이미 화면을 멈춰 둬요. 오버레이는 `viewportY < baseY`를 보고 버튼을
  띄워요(그 사이 출력이 오면 "새 출력").
- **URL·경로 고르기**(⇧⌘E): 보이는 줄(줄바꿈된 줄은 이어서, 넓은 글자는 칸에 맞춰)의 URL, 경로(`a/b.ts:12`, `~/x`,
  `README.md`), 커밋 해시에 홈 row 라벨을 붙여요. 아래쪽부터 짧은 라벨, 같은 텍스트는 라벨 하나. 라벨을 치면 복사,
  ⇧+라벨은 세션에 입력, Esc는 닫기. 키는 `code`로 읽어서 한글 입력 상태여도 돼요.
- Electron 45는 preload에 `clipboard` 모듈이 없어서 `copyText`는 main의 `clipboard:write`를 거쳐요.

## 찾기 + 안전한 붙여넣기 (T40)

- `features/terminal-search`: ⌘F(Windows Ctrl+Shift+F, 단축키 맵의 `find`)나 ⌘K → "터미널에서 찾기"로 포커스된
  세션 위에 `TermFind` 바를 열어요(`openFind` 스토어, 한 번에 하나). `@xterm/addon-search`는 바가 열려 있을 때만
  import·로드하고, 일치 항목은 `--color-terminal-match(-active)` 데코레이션이에요. Enter / ⇧Enter로 다음 / 이전,
  Esc로 닫으면 하이라이트를 지우고 키보드를 터미널에 돌려줘요.
- `entities/session/lib/paste.ts`: `safePaste(term, text)`가 `term.paste` 전에 C0(탭·LF·CR 제외), DEL, C1을 빼서
  붙여 넣은 `ESC[201~`가 bracketed paste를 일찍 끝내지 못해요. 모든 붙여넣기가 이걸 거쳐요: ⌘V(xterm 루트의
  capture 리스너가 xterm 핸들러보다 먼저 돌고, 파일은 터미널 도우미에 맡김), 끌어다 놓은 경로, quick select,
  `pasteIntoSession`(패널), Figma 칩. smoke가 실제 앱에서 둘 다 확인해요.

## 원격 세션 (T29)

프로젝트를 SSH 호스트에 둘 수 있어요: `project.remote = { alias, claudeConfigDir? }`, 이때 `project.path`는 **호스트의**
폴더예요(`~/…` = 원격 홈). 사이드바 **+** → "SSH 호스트…"로 추가(`RemoteProjectDialog`: `~/.ssh/config`에서 추천하는
호스트(`remote:hosts`, `electron/remote/hosts.ts`, 와일드카드 없는 `Host` 이름, 단순 `Include`), 폴더, 이름, 그룹,
호스트의 `CLAUDE_CONFIG_DIR`(선택)). 프로젝트 설정에서 같은 항목을 고쳐요.

- **실행** (`electron/remote/ssh.ts`, 순수 함수 + 테스트, 만든 스크립트를 가짜 tmux와 `sh`로 실제 실행해 보는 테스트 포함):
  `ssh -t -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -o ConnectTimeout=15 <alias> -- 'exec "$SHELL" -l -c <script>'`
  — ssh는 명령을 로그인 없이 실행해서 `~/.profile`의 PATH(`~/.local/bin`의 tmux 등)가 빠지니까요. 스크립트는
  tmux가 있는지 보고(없으면 메시지와 함께 exit 127), 우리 `~/.aquila/tmux.conf`를 쓰고(호스트에 쓰는 유일한 파일: 상태 바
  없음, 대체 화면 없음 → 출력이 xterm 스크롤백으로, `allow-passthrough on`, OSC 52), 폴더로 `cd`한 뒤
  `exec tmux -L aquila -f ~/.aquila/tmux.conf new-session -A -s aq-<탭 키> -c "$PWD" '<inner>'`. 우리 전용 tmux 서버
  (`-L aquila`)라 사용자의 tmux는 건드리지 않아요. `<inner>` = `exec "$SHELL" -l -i -c '<에이전트>; exec "$SHELL" -l -i'`
  (로컬과 같음: 로그인 셸에서 에이전트, 끝나면 셸), Claude는 설정돼 있으면 앞에 `export CLAUDE_CONFIG_DIR=…`.
  Claude는 `--session-id` / `--resume`, codex는 `resume <id>` — 호스트 PATH의 이름 그대로.
- **탭마다 tmux 세션 하나**, 이름은 바뀌지 않는 탭 키. `-A`는 있으면 붙으니까 재연결도 앱 재실행도 돌고 있는 에이전트에
  다시 붙어요(이때 tmux는 명령과 폴더를 무시). 탭을 닫으면 `ssh -o BatchMode=yes <alias> tmux -L aquila kill-session -t aq-<키>`;
  앱 종료는 안 죽여서 다시 열면 붙어요.
- **재연결** (`electron/remote/reconnect.ts`, 수동 시계로 테스트): ssh exit 255(ssh 자체 실패: 연결 거부, keepalive
  시간 초과)면 탭을 두고 3 → 6 → 12 → 60초 뒤, 그다음은 60초마다 다시 시도해요. ssh가 2.5초 살아 있으면 연결됨으로
  봐요(ssh가 자기 오류를 출력하니 출력만으로는 연결이 아님). 그러면 백오프가 처음부터. 3번 실패하면 `lost`지만 계속
  시도해요. 다른 종료 코드는 세션이 끝난 것(에이전트와 셸이 끝났거나 tmux 없음). 시도마다 pty만 바뀌고 xterm·탭·상태는 그대로.
  상태는 `session:connection`으로 렌더러에(`connecting | connected | reconnecting | lost` + `retryAt`).
- **UI:** 탭과 분할 헤드에 연결 점이 있는 호스트 배지(`HostBadge`, `entities/project`), 사이드바엔 계정 배지 대신 호스트
  배지, `lost` 동안 터미널 위 배너(`features/remote-connection`: 카운트다운, "지금 다시 연결" → `remote:reconnect`,
  "에이전트는 호스트의 tmux에서 계속 돌아요").
- **상태:** 원격 Claude엔 훅이 없고(이 Mac의 127.0.0.1로 보내니까) tmux는 모르는 OSC를 버려서 OSC 7501이 안 와요
  (passthrough는 프로그램이 직접 감싼 시퀀스만 넘겨요). 원격 탭은 출력 활동 추정을 쓰고 '추정'으로 보여요.
- **호스트 확인** (`remote:check`, `electron/remote/check.ts`): `ssh -o BatchMode=yes`로 원격 로그인 셸에서 한 번 실행:
  `uname -sm`, claude / codex / tmux / git의 `command -v`와 버전, Claude 로그인(`<dir>/.credentials.json` 또는
  `.claude.json`의 `oauthAccount`), 패키지 관리자(설치 안내용), systemd-logind `KillUserProcesses`(+ linger). 설치 명령은
  복사 버튼과 함께 보여주기만 해요. 비밀번호나 새 호스트 키가 필요한 호스트는 여기서 ssh 메시지로 실패하지만, 세션은 진짜
  pty라 물어볼 수 있어요.
- 사용자의 `~/.ssh/config`와 ssh-agent를 써요. 비밀은 저장하지 않아요. 로컬 전용(메인이 메시지 하나로 거절, UI에선
  숨김): 워크트리, 미리보기, "열 앱", 마지막 응답 복사, 포트, 셋업 스크립트, 로컬 계정 전환.
- **공유 연결 (T36):** 모든 ssh(탭, kill, 패널)에 `ControlMaster=auto`, `ControlPath=~/.aquila/ssh/%C`,
  `ControlPersist=120`(`MUX_OPTIONS`)을 붙여서 패널은 호스트마다 마스터 하나를 같이 쓰고, 탭에서 비밀번호를 넣은 호스트도
  패널에서 돼요. main이 시작할 때 `~/.aquila/ssh`(0700)를 만들어요 — 폴더가 없으면 ssh가 exit 255. `electron/remote/exec.ts`는
  호스트에서 POSIX `sh` 스크립트를 실행하고(`BatchMode`, 로그인 셸 → `sh -c`, 입력은 stdin) 왕복 시간(ms)을 기록하고,
  출력을 무작위 경계(`\n<경계> <이름>\n`)로 나눠 로그인 잡음을 버려요.
- **SSH 변경사항 패널 (T36, `electron/remote/git.ts`):** 새로고침 한 번 = 왕복 한 번 — status, HEAD, 기준 커밋 이후
  name-status, diff, 추적 안 되는 파일 최대 20개의 diff를 각각 호스트에서 `head -c`로 잘라서. 감시는 없고 패널이 10초마다
  (그리고 포커스 / ↻에) 가져오며 `ssh <호스트> · … · n ms`를 보여요. 스테이지/되돌리기는 호스트에서 `git`을 실행하는
  `GitRun`으로 `gitAction`을 그대로 써요(패치는 stdin). 추적 안 되는 파일은 호스트의 `~/.aquila/trash/<시각>/`으로 옮겨요.
  원격 탭의 시작 커밋도 SSH로 읽어서 "세션 시작 이후"가 돼요.
- **SSH 세션 기록 (T36, `electron/remote/history.ts`):** `history:list`는 로컬만(캐시된 원격 항목 포함),
  `history:refresh-remote`가 원격 호스트마다 `<CLAUDE_CONFIG_DIR>/projects/*/*.jsonl`과
  `$CODEX_HOME/sessions/**/rollout-*.jsonl`을 mtime + 크기와 함께 나열하고(GNU 또는 BSD `stat`), 새로 생기거나 바뀐
  파일만 앞 256KB를 gzip으로 가져와요(경로는 stdin, 왕복당 64개). ref와 이름/즐겨찾기 키에 `@<호스트>`가 붙고, 그룹은
  호스트 + 폴더별이에요. 이어하기는 그 호스트에서 세션 폴더를 담은 원격 프로젝트로(없으면 추가). 내보내기는 파일 전체를
  가져와요. 호스트에는 아무것도 쓰지 않아요.
- **스모크** (`electron/remote/smoke.ts`): PATH의 가짜 `ssh` / `tmux`가 실제 스크립트를 로컬에서 실행: 첫 시도 거부 →
  다시 연결 중 → 연결됨, 입력한 표식이 돌아옴, 링크 끊김(exit 255) → 재연결 → 다시 출력, 탭 닫으면 `kill-session`.
- **실제 호스트** (선택, `electron/remote/realHostSmoke.ts`): `scripts/ssh-test-host/up.sh`가 Debian 컨테이너
  (127.0.0.1:2222의 sshd, 사용자 `dev`, tmux + git, `/work/app` 저장소, 히스토리 fixture)를 띄우고 키와
  `ssh_config`(`Host aquila-test`)를 임시 폴더에 씁니다 — `~/.ssh`는 건드리지 않습니다. 그다음
  `AQUILA_SMOKE_SSH_HOST=aquila-test AQUILA_SMOKE_SSH_CONFIG=<dir>/ssh_config npm run smoke`: 호스트 확인 → ssh +
  tmux 탭 → 탭에서 입력한 수정이 Changes에 보이고 되돌림(stash + `~/.aquila/trash`) → 히스토리가 호스트의
  트랜스크립트를 프로젝트에 맞춰 나열 → 호스트가 사용자의 sshd를 종료(`AQUILA_SMOKE_SSH_DROP`) → 같은 tmux 세션으로
  재연결 → 탭 닫으면 세션 제거. `down.sh`가 컨테이너를 지웁니다.

## 사용량 게이지 (T30)

`electron/usage.ts` + `widgets/usage-gauge`. 사이드바 푸터 위의 띠. **로그인된 로컬 계정마다** 한 블록(세션이 아니라
설정 폴더 단위 — Claude statusline의 `rate_limits`는 계정이 섞임), 미터 두 개를 나란히: 5시간 블록(리셋 시각 포함)과
최근 7일. "추정"으로 표시.

- **출처:** 그 계정의 트랜스크립트 `<configDir>/projects/*/*.jsonl`, `*/<session>/subagents/*.jsonl`. 파일마다 바이트
  오프셋부터 이어 읽음(7일간 안 바뀐 파일은 건너뜀). `message.usage`가 있는 assistant 줄만, message id + request id로
  중복 제거(Claude는 content block마다 한 줄씩 씀). 읽기 전용.
- **가중치:** 가격 비율로 환산한 입력 토큰: 입력 ×1, 출력 ×5, 캐시 쓰기 ×1.25, 캐시 읽기 ×0.1.
- **5시간 블록:** 이전 블록이 끝난 뒤 첫 메시지의 정각에서 시작해 5시간(ccusage 규칙). 진행 중인 블록이 없으면 비어
  있고 "다음 메시지부터". 주간은 최근 7일 롤링(실제 리셋 시각은 알 수 없음).
- **100% 기준:** 학습. 탭에서 `StopFailure`(`error: rate_limit`)가 오면(`SessionManager.claudeAccount`) 그 계정이 그때
  쓴 양을 `~/.aquila/usage-limits.json`에 기록. 5시간 한도로 보되, 5시간 한도를 이미 알고 블록이 그 80% 미만이면 주간
  한도로 봄. `.claude.json`의 `userRateLimitTier`(없으면 조직 것)와 함께 저장하고, 티어가 바뀌면(요금제 변경) 버림.
  그 전까지는 토큰 수와 테두리만 있는 빈 막대, 비율 없음.
- **임박(≥ 90%):** macOS 알림 1회(5시간은 블록마다, 주간은 하루마다)와 "<다른 계정> 계정으로 새 Claude" 버튼(여유가
  가장 많은 다른 로그인 계정, 로컬 프로젝트만).
- **갱신:** 마운트 때 `usage:get`, 이후 `usage:changed` 푸시: `Stop` 훅 3초 뒤, 포커스 중 1분마다, 아니면 5분마다,
  절전 모드에선 두 배. 바쁜 한 주의 첫 스캔 ≈ 2초(비동기), 이후 ~25ms.
- 빠지는 것: claude.ai, 다른 기기, 원격(SSH) 세션.
- **실제 값 (T30b, `electron/usage-live.ts`):** CLI가 실제 사용률을 알려 주면 그게 우선, 위의 추정은 대체용으로 남음.
  Claude: 로그인된 계정마다 `claude -p /usage --no-session-persistence`를 숨겨서, 그 계정의 `CLAUDE_CONFIG_DIR`로 실행
  (상속된 `CLAUDE_CONFIG_DIR` / `CLAUDECODE` / `CLAUDE_CODE_CHILD_SESSION`은 먼저 지움 — 상속된 값이 다른 계정을
  가리킨 적이 있음). 로컬 명령이라 모델 호출·사용량 없음, ~2초. "Current session: 8% used · resets Nov 20 at 1:30pm
  (Asia/Seoul)"과 "Current week (all models)" → `percent` + `resetsAt`(시간대는 문구에서, 시간만 있고 지났으면 내일,
  연도가 없으니 다음에 오는 그 날짜). 못 읽으면 null. Codex: `rate_limits`가 있는 가장 최근
  `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`(끝 512KB만 읽음)의 `primary` / `secondary` `used_percent`,
  `window_minutes`, `resets_at`. 리셋이 이미 지났으면 0%. "Codex" 한 줄, 창은 길이로 라벨(300 → 5시간, 10080 → 주간,
  그 밖엔 N일), 안 알려 준 창은 숨김. 확인은 평소 갱신 때 최대 3분에 한 번(`LIVE_EVERY_MS`) 백그라운드로 돌고
  `usage:get`을 막지 않으며, 끝나면 `usage:changed` 푸시. 사용량 제한에 걸리면 다시 물어봄. 모든 줄이 실제 값이면
  머리에 "실제", 아니면 "추정". claude.ai와 다른 기기 사용량 포함. smoke / capture에서는 끔.

## 컨텍스트 게이지 (T31)

`electron/context.ts` + `entities/session`의 `ContextGauge`. 로컬 Claude 탭마다 12px 링.

- **출처:** Claude가 statusline에 주는 JSON. 우리가 넘기는 `--settings` 파일에 `statusLine` 명령을 넣어 stdin을
  `~/.aquila/context/$AQUILA_TAB_ID.json`에 씀(임시 파일 + `mv`, 아무것도 출력 안 함, 우리 탭이 아니면 아무 일 없음).
  설정 파일은 이제 넷: http / legacy 훅 각각 statusline 있음·없음(`claude-hooks-status.json`,
  `claude-hooks-legacy-status.json`).
- **사용자 status line 우선:** 실행 전에 `statusLineSources` + `userHasStatusLine`이 `<configDir>/settings.json`,
  `<cwd>/.claude/settings.json`, `<cwd>/.claude/settings.local.json`, managed settings를 읽기만 함. 어디든 `statusLine`이
  있으면 기본 설정 파일을 쓰고(우리 것이 대체해 버리므로) 그 탭엔 게이지 없음.
- **읽기:** `ContextWatcher`가 실행 때 폴더를 비우고 `fs.watch`, 몰려오는 갱신이 끝나고 250ms 뒤 탭 파일을 읽어
  `context_window.used_percentage`(없으면 `current_usage`의 입력 + 캐시 토큰 ÷ `context_window_size`)를 씀. 첫 메시지 전엔
  보여줄 게 없음. 반올림한 비율이나 토큰이 바뀔 때만 `context:changed`(`{ id, usage | null }`) 푸시, 렌더러가 다시 뜨면
  `context:get`.
- **지움:** 탭 닫힘(`SessionManager`의 `onEnded`) 또는 `/clear`가 아닌 `SessionEnd`(Claude 종료, 셸은 남음) → 파일 삭제,
  `usage: null`. `/clear`는 새로 보고될 뿐.
- **UI:** 회색 링, 60%부터 숫자가 보이고 주황, 85%부터 빨강. 툴팁: 비율, `사용 / 전체` 토큰, 60%부터 /compact 안내.
  원격 탭(훅 없음)과 smoke에선 안 보임.

## Figma MCP (T32)

`electron/figma.ts` + `features/figma`(`FigmaSettings`, 워크스페이스 페이지가 프로젝트 설정에 끼워 넣음 — feature끼리는
import하지 않음).

- **프로젝트별 선택:** `Project.figma`(로컬 프로젝트만, 끄면 키 삭제). 프로젝트 설정의 블록은 켜기 전엔 켜기/끄기만 보임.
- **세션:** 새 Claude 탭은 `--mcp-config ~/.aquila/mcp/figma.json`(`{ type: "http", url:
  "https://mcp.figma.com/mcp" }`, 없으면 작성) — `--strict-mcp-config` 없이, 사용자 서버는 그대로. Codex 탭은
  `codex -c 'mcp_servers.figma.url="https://mcp.figma.com/mcp"'`(codex-cli 0.170에서 `codex -c … mcp list`로 확인) —
  저장소나 `~/.codex`에 아무것도 안 씀. 이미 열린 탭은 시작할 때 설정 그대로.
- **인증은 CLI 안에서:** Claude `/mcp` → figma → Authenticate(계정 config dir별), Codex `codex mcp login figma`.
- **연결 확인:** `figma:connect(account)`가 그 계정의 `CLAUDE_CONFIG_DIR`로 숨은 `claude -p`(haiku,
  `--strict-mcp-config`, `--allowedTools mcp__figma__whoami`, `--no-session-persistence`, 90초 제한)를 실행해
  `whoami` 원본 결과를 받고 방어적으로 파싱: 응답의 첫 JSON, 이메일·핸들, 여러 키 이름의 tier·seat 플랜, 없으면
  `unknown`. `NO_FIGMA_TOOL` → `needsAuth`. 계정별로 `~/.aquila/figma-profile.json`에 캐시(`figma:profiles`).
- **제한이 아니라 힌트:** "디자인 → 코드"는 Dev·Full 시트 필요, "Code Connect"는 Organization이 필요할 수 있음 —
  캐시된 플랜으로 툴팁 표시, 모르면 "Figma 문서 확인"(`figma:open-docs`가 Figma MCP 문서 열기). 사용량 제한은
  하드코딩하지 않음.

## Figma 프롬프트 칩 (T34)

`features/figma`(`FigmaChips`, `model/link.ts`)를 `widgets/split-view`가 Figma가 켜진 프로젝트의 Claude·Codex 터미널마다
얹음 — 렌더러만, IPC 없음.

- **트리거:** xterm 요소의 capture `paste` 리스너(`preventDefault` 안 함, 링크는 xterm이 그대로 붙여 넣음)가
  `parseFigmaLink` 실행: `figma.com/{design,file,proto,make}/KEY` → 디자인 파일, `/board/KEY` → FigJam, `node-id` 보존.
- **칩, 디자인 vs 구현:** 디자인 파일은 디자인 = "앱과 비교"(`get_screenshot`), "코멘트 → TODO"(`get_comments`), 구현 =
  "컴포넌트·토큰으로 구현"(먼저 `get_variable_defs` → 우리 토큰, 그다음 `get_design_context`), "에셋 받기"
  (`download_assets`). FigJam 보드는 "흐름 → 화면"(`get_figjam`, 화면 + 백엔드 TODO)과 코멘트. 칩은
  링크 뒤에 ` <프롬프트>`(한 줄)를 `term.paste`, Enter는 안 누름. Claude 탭에서는 비교·구현 칩에 Claude in Chrome 단계 추가(`figma.prompt.chromeCheck`): 프레임(Dev Mode)과
  실행 중인 앱을 열어 레이어별 Figma 속성 패널(디자인 시스템 컴포넌트·variant, 크기, 간격…) ↔ 앱의 컴포넌트·계산된 스타일 대조, 화면으로도 대조, MCP 데이터가 놓친 것(상태, 글꼴, 이미지, 넘침, 폭)까지 고치고 반복. Codex는 Chrome
  도구가 없어 MCP만 쓰는 프롬프트. 터미널의 Enter, 칩, ×로 닫힘. 프롬프트는 사전(ko / en).
- **프리뷰:** Designer 레이아웃에서 Figma 링크가 열려 있으면 선택(T33)에 한 줄 추가: 프레임 URL과 "`get_screenshot`으로
  가져와 선택한 요소의 스크린샷과 비교" — 겹쳐 보기는 에이전트가 함.

## AI 트렌드 (T35)

`electron/news.ts` + `widgets/trends`: 사이드바 상단 띠 오른쪽 끝의 ✦가 가이드의 `Modal`을 제목만 바꿔 엶.
- **필요할 때만 가져옴:** 모달을 열 때 캐시(`~/.aquila/news-cache.json`)가 30분보다 오래됐으면 가져오고, ↻는 바로
  가져옴. 실행 시 요청·폴링·배지 없음(가져오지 않으면 셀 게 없음). 소스마다 `If-None-Match` / `If-Modified-Since`로
  `net.fetch`(304면 파싱해 둔 항목 유지). 실패한 소스는 이전 항목을 남기고 푸터에 이름 표시. capture에서는 끔.
- **소스:** claude-code·codex는 GitHub `releases.atom`(최근 10개, 각 약 300KB, API 한도 없음 — asset이 붙은 REST 목록은
  30개에 약 10MB), codex는 REST `/releases/latest` 추가(피드 10개가 전부 alpha일 수 있음). `-접미사` 버전은 제외. Claude
  Code `CHANGELOG.md`는 앞 64KB만(`Range`, 잘린 마지막 섹션은 버림). RSS/Atom: OpenAI News, Cursor changelog,
  Antigravity blog, Simon Willison, Latent Space. HN Algolia(`points>100`, 최근 7일, AI 관련 제목만). 한 번에 약 3MB
  (OpenAI·Latent Space는 `Range`를 무시). 국내(T63, 업계 탭의 해외 / 국내, `NEWS_REGION`): GeekNews, AI타임스(오프셋
  없는 날짜는 KST로), 카카오·토스·우아한형제들·당근·LY 기술 블로그. GeekNews와 블로그는 AI 항목만(`AI_TOPIC`, 한국어·영어
  단어). 토스는 `Range`를 무시해서 본문을 스트림으로 읽다 64KB에서 끊음(`readHead`). XML 파서는 의존성 없이 정규식으로.
- **내 CLI:** `claude --version` / `codex --version`(지정한 바이너리)과 릴리스 비교: 더 새 것(최대 5개), 없으면 최신
  하나. 각각 "Added" 줄 3~5개("Added"로 시작하는 항목 → "New Features" 섹션 → 앞쪽 항목 순).
- **업계:** 소스당 최대 15개, 링크당 하나. 항목 본문 전체에 정규식 키워드 분류(subagent / multi-agent, hook, agent view
  / background agents, ADE, harness, MCP·스킬, 컨텍스트 엔지니어링, 바이브·에이전틱 코딩 — 각각 한국어 단어 포함), 첫 분류 아래에 표시, 나머지는 "최신". 제목·링크·220자 이하 발췌만. 분류되는
  항목이 적은 건 키워드 탓이지 버그가 아님.
- **보관 / 정리:** 아직 안 본 항목은 30일, 이전 방문(`prevSeenAt`) 때 이미 있던 항목은 7일 뒤 목록과 캐시 파일에서
  지움. 지난 방문 이후 새 행에는 점.
- **열기:** `news:open`은 현재 상태에 있는 http(s) 링크만 엶.
- **요약(옵트인):** 누르면 숨은 `claude -p --model haiku --max-turns 1 --no-session-persistence`를 지금 프로젝트의
  계정으로 실행, 프롬프트는 stdin(제목 + 발췌만). 상태와 함께 캐시.
- **smoke / capture:** `electron/fixtures/news` 픽스처 피드, 임시 캐시, 고정 버전, 픽스처 날짜(`FIXTURE_NOW`). smoke는 열
  때 가져오는지, 행·줄·업계 탭·Esc 확인, capture는 `trends` 가이드 항목을 녹화.

## 지식 그래프 인덱스 (T65)

`electron/graph/` + `entities/note` + `features/graph-sources`. Markdown 폴더(레포 안이든 밖이든)가 **소스**
(`~/.aquila/graph/sources.json`). 파일은 제자리에 두고 절대 쓰지 않는다.

- **지연 시작:** 렌더러가 그래프 API를 처음 부를 때까지(설정 ▸ 노트 소스…, 나중엔 그래프 패널) 아무것도 안 돈다.
  `GraphService`(`index.ts`)는 켜진 소스가 있을 때만 `worker_thread`(`worker.ts` → `engine.ts`)를 띄우고, 마지막
  소스를 끄면 멈춘다. 메인 프로세스는 상태만 들고 노트는 들지 않는다.
- **인덱스:** 폴더 순회(숨김·빌드 폴더 제외) → 바뀐 `.md`를 50개씩 양보하며 파싱(`parse.ts`: 제목, 제목들,
  `[[링크]]`, 상대 링크, `#태그`, frontmatter, URL, ID, 코드 같은 단어) → `build.ts`가 `GraphNode` / `GraphEdge`
  생성(타입은 `shared/api/types.ts`). `~/.aquila/graph/index.json`에 저장, 다음 시작엔 mtime/크기가 바뀐 파일만 다시 파싱.
- **엣지:** 쌍마다 하나, 가장 강한 종류가 이김: 명시(링크 1, frontmatter 0.9, 태그 0.8) · 행동(T70) · 언급(공통 ID 0.7,
  제목 0.6, 코드 이름 0.5, 공통 URL 0.4) · 제안(T68). 코드 이름은 로컬 프로젝트의 파일 이름과 export 심볼(`code.ts`,
  노트 다음에 스캔).
- **감시:** 켜진 소스마다 재귀 `fs.watch` 하나, 디바운스 400 ms(절전 2초). 파일 500개 넘는 첫 인덱싱은 절전에서
  "지금 색인"까지 멈춤.
- 패키징: 워커 파일을 띄울 수 있게 `dist-electron/electron/graph/**`는 asar 밖으로 뺀다.

## 지식 그래프 뷰 (T66)

`widgets/knowledge-graph`: 오른쪽 패널(⌘⇧N, 탭 바의 ◉ 그래프 버튼) 또는 전체 창. 프로젝트와 상관없음.

- **지연 청크:** `index.ts`는 `React.lazy` 래퍼(+ 실패하면 패널을 닫는 에러 경계). sigma.js, graphology, 레이아웃은
  처음 열 때 로드. `useGraphData`가 상태를 물어(이때 T65 색인 시작) 버전이 바뀔 때만 스냅샷을 다시 가져온다(색인 중엔 800 ms에 한 번으로 묶음).
- **뷰:** `model/view.ts`가 스냅샷을 거른다(소스, 종류, 태그, 기간, 최소 강도. 노트가 아닌 노드는 남은 노트가 이을
  때만 남음). 로컬 뷰는 선택한 노트의 깊이 1–2 이웃만, 검색은 라벨을 찾는다.
- **레이아웃:** ForceAtlas2(`graphology-layout-forceatlas2/iterate.js`를 배열 위에서, `model/layout.ts`)를 데이터가
  바뀔 때마다 새 모듈 워커에서(`layout.worker.ts`, `runLayout.ts`). 그림이 안정되거나 3초가 지나면 멈추고 종료 —
  실행 사이엔 워커가 없다. 100 ms마다 중간 위치(절전에선 없음: 최종 그림만). 있던 노드는 제자리, 새 노드는 이웃
  옆에서 시작. 워커를 못 띄우면 같은 루프가 UI 스레드에서 8 ms씩 돈다.
- **렌더:** sigma.js v4(`ui/useGraphRenderer.ts`), 바뀔 때만 그린다. 엣지: 실선(명시/행동)은 plain 레이어, 파선(언급)과
  점선(제안)은 dashed 레이어. 색은 `--color-graph-*`를 `getComputedStyle`로 읽음(테마가 바뀌면 다시). 다시 만든 뒤엔
  sigma의 첫 프레임까지 갱신을 미룬다(아직 안 그린 항목은 다시 칠하기를 거부함). 패널을 닫으면 sigma를 kill해 WebGL 컨텍스트를 놓는다.
- 노트 열기(또는 더블클릭) → 노트 에디터(T67). `graphOpenNote`(기본 앱, 켜진 소스 안의 `.md`만)는 에디터의 ↗ 버튼으로 남음.

## 노트 에디터 (T67)

`features/edit-note`: 노트 하나를 여는 오른쪽 패널 또는 전체 창. 그래프, ⌘O(색인 위 빠른 열기), `[[링크]]`·백링크에서
연다. 그래프와 에디터가 같이 쓰도록 `useGraphData`는 `entities/note`로 옮겼다.

- **지연 청크:** `index.ts`는 그래프처럼 `React.lazy` 래퍼 + 에러 경계. CodeMirror 6은 그 청크에만 있다. `QuickOpen`은
  작고, 열릴 때 스냅샷을 읽는다.
- **메인 쪽:** `electron/graph/note-file.ts`. `note:open`은 노트를 읽고(경로는 `GraphService.notePath`로 확인) 열려 있는
  동안만 그 폴더를 감시(파일이 아니라 폴더: 새 파일을 덮어 이름 바꾸는 저장 때문). `note:changed`가 새 텍스트나
  `deleted`를 보낸다. `note:write`는 제자리에 쓰고, 에디터가 읽은 mtime이 아니면 거부(`changed`). BOM은 떼었다 다시
  붙이고, 올바른 UTF-8이 아니면 읽기 전용. `note:attach`는 붙여넣은 이미지를 노트 옆
  `attachments/<노트>-<시각>.<확장자>`로 저장(png/jpg/gif/webp, 20 MB 이하). 이미지는 `aquila-note://local/<경로>`
  프로토콜로 본문에 보이고, 이 프로토콜은 켜진 소스 안의 이미지 파일만 내준다(`img-src`에 허용). `note:open-url`은 누른
  `[글](url)`을 브라우저로 연다(http/https만). 노트를 연 직후 감시기가 한 번 더 읽는다(macOS는 폴더 감시를 비동기로 시작).
- **바이트 그대로:** 에디터는 읽은 텍스트와 그 뒤의 모든 변경(하나의 `ChangeSet`으로 합침)을 들고 있고, 저장은 원래
  문자열에 그 변경만 적용(`model/serialize.ts`, CodeMirror 오프셋을 원본의 줄 시작에 매핑). 손대지 않은 줄은 줄바꿈
  (CRLF, CR, 섞임)과 끝 공백까지 그대로, 새 줄은 파일의 첫 줄바꿈을 쓴다. Markdown 키맵은 안 씀(Enter가 목록 번호를
  다시 매김): `continueMarkup`이 새 줄에만 목록·인용을 이어 쓰고, 표의 Tab / Shift-Tab / Enter(`model/tables.ts`)는
  칸 이동과 빈 행 추가만 하고 정렬은 안 한다. IME 조합 중엔 키 명령이 비켜선다.
- **라이브 프리뷰**(`model/livePreview.ts`): 데코레이션만. 뷰 플러그인이 선택이 걸친 줄을 빼고 표시(`#`, `**`, `` ` ``,
  링크 주소, `[[ ]]`, `>`)를 숨기고 할 일 표시를 체크박스로 바꿈(클릭하면 한 글자만 바뀜). 상태 필드가 커서가 없는 표를
  렌더된 블록으로 바꿈(칸을 누르면 커서가 그 칸으로). 프런트매터는 원문 그대로, 건너뜀.
- **저장:** 포커스를 잃을 때, ⌘S, 타이핑이 멈추고 1초 뒤 — 다른 타이머는 없음. 노트를 바꾸거나 닫을 때 먼저 저장.
- **디스크 변경:** 같은 바이트(우리 저장)면 mtime만 갱신. 저장 안 한 수정이 없으면 제자리에서 다시 불러옴(다른 구간만
  바꿔 커서 유지). 있으면 배너: 비교(`model/lineDiff.ts` → `DiffView`), 내 것 유지(그 위에 저장), 다시 불러오기.
- **옆 열:** 목차(코드·프런트매터 밖의 ATX 제목), 백링크(이 노트로 오는 링크·프런트매터 엣지), 링크 없는 언급(제목
  엣지)을 스냅샷에서. `[[` 자동완성은 모든 노트 제목, 넣는 건 파일 이름(색인이 먼저 찾는 것).

## 링크 제안과 규칙 (T68)

`electron/graph/similar.ts`, `extract.ts`, `rules.ts`(색인 워커 안) + `features/link-suggestions`.

- **로컬 유사도 (AI 없음):** `SimilarIndex`가 노트마다 TF-IDF 단어 수를 가짐(불용어, 숫자, 한국어 조사 제외).
  스냅샷을 만들 때 mtime/size가 바뀐 노트만 다시 계산(예전 짝은 먼저 지움): 가장 무거운 단어로 후보를 찾고,
  코사인 ≥ 0.2 이고 같은 단어 ≥ 2개면 노트당 상위 3개 → `similar` 엣지(제안, 세기 0.1–0.35, 같은 단어가 라벨).
  다른 연결이 없는 짝에만.
- **AI 추출 (소스별 opt-in, `GraphSource.ai`):** `Extractor`가 AI 소스에서 텍스트 해시가 바뀐 노트를 대기열에
  넣음. 30초 동안 변화가 없으면(절전에서는 절대 스스로 안 함, "지금 실행"은 언제나) 숨은 `claude -p`(haiku, 한 턴,
  공용 계정, cwd = tmp) 한 번에 노트 4개, 노트는 데이터로 인용하고 아는 제목 목록을 함께 보냄. JSON 답은 검증
  (모르는 id 버림, 목록 개수·길이 제한, `related`는 실제 노트로 풀리는 제목만). 소스별 하루 40개 상한. 실패하면
  그 소스의 자동 실행은 "지금 실행"까지 멈춤. `~/.aquila/graph/ai.json`에 저장되고 `person:` / `decision:` /
  `todo:` 노드와 `ai` 엣지(제안)가 됨.
- **결정 (`links.json`):** 수락 → `accepted` 엣지(explicit). 거절 → 적어 둔 연결이 없으면 그 짝을 지움. 수락할 때
  패턴을 기록(같은 ID → `id:DB`, 같은 URL → `url:host`). 규칙이 없고 "나중에" 하지 않은 패턴을 3번 수락하면 제안.
  켜진 규칙은 해당 엣지에 `rule` 이유(explicit)를 더함. 모두 `buildGraph`에서 T65 엣지 다음에 적용.
- **`[[링크]]`:** "[["는 수락하면서 main에 노트 마지막 줄로 `[[파일 이름]]`을 그 파일의 줄바꿈으로 덧붙이게 함
  (`withLink`. UTF-8이 아니거나 mtime이 바뀌었으면 거부). 사용자 파일에 쓰는 유일한 곳이고, 그 클릭에서만.
- **UI:** `LinkSuggestions`가 노드의 제안 + 본문에서 찾은 엣지를 보여 줌(✓ / [[ / ×, 위에 규칙 제안). 그래프
  카드와 에디터 옆 열에(페이지가 `renderLinks`로 넘김 — feature끼리는 import하지 않음). 설정 ▸ 링크 제안…(⌘K도):
  소스별 AI와 사용량 안내·오늘 개수, 규칙 제안, 규칙(고치기 / 끄기 / 빼기 / 추가).

## 앱 내 프리뷰 (T33)

`electron/preview.ts` + `widgets/preview`(`PreviewPanel`, ⌘⇧P 또는 탭 바의 ◫ 버튼, 로컬 프로젝트만).

- **Dev server:** `.claude/launch.json`(`configurations[].port` / `.url`, 방어적으로 파싱) + 프로젝트 터미널에 나온
  `localhost:<port>` 주소. `SessionManager`가 로컬 출력 원본을 `DevUrlTracker`에 넘기고(`onOutput`), 탭마다 256자 꼬리를
  남겨(조각에 걸친 주소도 찾음) ANSI를 지우고(Vite는 포트를 굵게 칠함) `0.0.0.0` / `127.0.0.1` / `[::1]`을 `localhost`로
  맞추고, 훅 포트는 빼고, 프로젝트마다 최근 5개를 최신순으로 둡니다. `://`가 없는 조각은 `includes` 한 번으로 끝.
  `preview:targets` / `preview:targets-changed`.
- **워크트리별 (T50):** 주소는 그 주소를 출력한 탭의 프로젝트 + 워크트리별로 따로 두고, 패널은 포커스된 탭의 워크트리로
  묻습니다(`previewTargets(projectId, worktree?)`). 그 워크트리의 launch.json, 그 워크트리에서 나온 주소, 따로 기억하는 주소
  (`aquila.preview.url.<id>@<path>`), 패널 머리의 브랜치. 포트 베이스(T26)가 있으면 워크트리의 `PORT` 범위
  (`portBase + 10 × slot` … `+9`, slot은 경로별 캐시)가 `preferred`를 정해요. 그 범위에서 본 주소가 맨 앞에 오고, 처음
  나타날 때 한 번 패널이 그 주소로 바뀝니다. 아무것도 모르면 `localhost:<PORT>`를 추측으로 넣어요(`orderTargets`).
- **뷰:** 슬롯(`app`, `figma`)마다 `WebContentsView` 하나를 창의 `contentView`에 붙임. 파티션
  `persist:aquila-preview`(샌드박스, preload 없음, `window.open` → 브라우저). 패널의 stage div가 자기 위치를
  `preview:set`으로 알림(ResizeObserver + 창 resize, 패널이 마지막 열이라 자기 크기가 바뀔 때만 움직임). null이면 뷰를
  닫음. 너비 390 / 768 / 1440: stage보다 좁으면 1×로 가운데, 넓으면 `setZoomFactor(stage / 너비)`로 미디어 쿼리가 그
  너비를 보게 함(줌은 origin별이라 이동할 때마다 다시 적용). 너비만 — 모바일 UA나 터치 에뮬레이션은 없음.
- **네이티브 뷰 vs DOM:** 뷰가 페이지 위에 그려지므로 `dialog[open]`이 있는 동안(팔레트, 모달, 대화상자)과 마지막
  로드가 실패했을 때는 패널이 숨김(`hidden`) — 실패하면 stage에 오류 + 다시 시도. 렌더러가 새로고침되면 뷰를 모두 닫음.
- **요소 선택:** `preview:pick`이 페이지에서 `PICK_SCRIPT`를 실행(`executeJavaScript`, user gesture). 하이라이트와
  `tag.class W×H` 라벨이 포인터를 따라가고, 클릭은 삼킴(캡처 리스너), Esc / `preview:pick-cancel`은 null. 결과: 짧은
  고유 selector(id, `data-testid`, 해시 없는 클래스, `:nth-of-type`, 최대 6단계), 텍스트(200자), 쓸모 있는 속성, 기본값을
  뺀 computed style, `__reactFiber$` 체인의 React 컴포넌트명(+ React ≤ 18 dev의 `_debugSource`) 또는 Vue
  `__vueParentComponent`(+ `__file`), rect. main이 `capturePage(rect × zoom + 8px)`를 잘라
  `$TMPDIR/aquila-paste/pick-*.png`에 저장(하루 뒤 정리).
- **붙여넣기:** 프롬프트(`buildPickPrompt`, 라벨은 번역)를 포커스된 Claude/Codex 탭에 붙이고, 이미지 경로를 두 번째
  붙여넣기로(경로만 있는 붙여넣기를 CLI가 이미지로 첨부), 터미널에 포커스. 전송은 안 함. 에이전트 탭이 아니면 텍스트 +
  경로를 클립보드로.
- **디자이너:** Figma를 켠 프로젝트는 디자이너 토글: Figma 링크 칸과 앱 아래 두 번째 뷰(그 안에서 Figma에 한 번
  로그인하면 파티션이 유지).
- smoke는 가짜 React fiber가 있는 페이지로 selector, 컴포넌트 체인, 스타일, 스크린샷, 취소를 확인. capture는 네이티브 뷰를
  프레임에 합성(`withViews`)하고 web-shop의 launch.json이 가리키는 데모 쇼핑 페이지를 띄움.

## Run 슬롯 (T60)

- 탭 바의 ▶ 실행(⌘⇧R, 또는 ⌘K "실행 패널 보기")이 로컬 프로젝트에서 오른쪽에 `features/run-slot`을 연다. 프리뷰처럼
  포커스된 탭의 워크트리를 따라간다: 워크트리마다 실행과 `PORT`가 따로 있다.
- 명령: 프로젝트의 `runCommands`(설정 → "실행 명령", 한 줄에 하나, `이름: 명령`). 없으면 폴더의 `package.json`에
  `dev` 스크립트가 있을 때 그것을 `packageManager`나 락파일의 패키지 매니저로 실행(`pnpm dev`, `yarn dev`,
  `bun run dev`, 아니면 `npm run dev`). 명령이 여럿이면 한 줄씩 점과 함께 보이고, 고른 것의 로그가 아래에 나온다.
- 메인(`runs.ts`, `RunManager`): `$SHELL -l -c <명령>`을 `detached`(자기 프로세스 그룹)로 프로젝트 폴더나 워크트리에서
  띄운다. `PORT` / `AQUILA_PORT_BASE`는 탭과 같고 `FORCE_COLOR=1`. 출력(stdout + stderr, pty가 아닌 파이프)은 256 KB
  꼬리로 보관하고(`run:log`) 50 ms 묶음으로 보낸다(`run:data`). 로그 팬은 읽기 전용 xterm(`convertEol`).
- 상태: `running` → `exited`(종료 코드 0 / 정지) 또는 `error`(0이 아닌 종료, 또는 `Error`, `EADDRINUSE`, `OOM`,
  `out of memory`, `NaN`이 있는 출력 줄 — 그 줄을 보여 준다). 아직 떠 있는 워처가 나중에 "다시 정상" 줄(`hmr update`,
  `ready in`, `compiled successfully`, `Found 0 errors` 등)을 찍으면 `running`으로 돌아간다. 점: 초록 원(`live`), 고리, `!` 사각형.
- 정지: 그룹에 SIGTERM, 2초 뒤 SIGKILL. 셸이 스스로 끝나도 그룹을 SIGKILL해서 남는 게 없다. 앱 종료 시 모든 실행을
  멈추고(before-quit, pty와 함께) `process.on('exit')`가 남은 그룹을 SIGKILL한다. 프로젝트를 지우면 그 실행도 멈춘다.
- 복원: `~/.aquila/runs.json`에 떠 있는 실행을 적는다(바뀔 때마다 다시 쓰고, 종료가 시작되면 고정). 다음 실행 때
  프로젝트·명령·폴더가 그대로면 다시 시작한다. smoke/capture는 건너뛴다.
- 출력의 로컬 주소(프리뷰와 같은 스캔)는 실행의 `url`이 되고 프리뷰 주소 목록에도 들어간다. "프리뷰에서 열기"는
  그 주소로 프리뷰 패널을 연다.

## 단축키

- 맵 하나: `src/shared/lib/shortcuts.ts`의 `ShortcutId` → Electron accelerator(`CommandOrControl+Shift+T`).
  `pages/workspace/model/useShortcuts.ts`가 `matchShortcut(e)`로 처리합니다(캡처 단계, 수정키 정확히 일치,
  `KeyboardEvent.code`로 비교해서 한글 입력 상태에서도 동작). `shortcutLabel(id)` / `withShortcut(label, id)`는 macOS에서
  `⇧⌘T`(Apple 순서 ⌃⌥⇧⌘), 그 외에서 `Ctrl+Shift+T`를 돌려줘 팔레트·버튼·툴팁이 씁니다. 네이티브 메뉴는
  `ContextMenuItem.accelerator`로 받습니다(표시만). 새 단축키는 맵에 추가하고 문자열로 직접 쓰지 않습니다.

## 한글 IME

- 한글 조합은 xterm의 `CompositionHelper`가 처리합니다(`.composition-view`에 조합 중 글자를 보여주고 확정 시 전송).
  빈틈 하나: 조합 중에는 keyCode 229인 keydown을 전부 버리는데, Chromium은 Enter / Tab / Esc / Ctrl+<글자>를 그렇게
  보낼 수 있어서 글자는 들어가고 Enter나 Ctrl+C가 사라졌습니다. `entities/session/lib/imeGuard.ts`가 xterm의 커스텀 키
  핸들러로 이런 키를 받아 두었다가 확정 뒤에 보냅니다(xterm의 확정 타이머가 먼저 돌아서 순서는 `글` 다음 `\r`). 같은 키가
  100 ms 안에 일반 keydown으로 한 번 더 오면(macOS Chromium) 두 번 보내지 않고 버립니다. 글자, 음절 안의 Backspace,
  Space는 xterm에 맡깁니다.
- `npm run smoke`가 자모, 받침 넘어감(한+ㅏ → 하나), 조합 중 표시, 세 가지 순서의 Enter, Space, 조합 중·한/영 전환 직후
  Ctrl+C, `ㅏ`로 들어온 ⌘K를 세션에 실제로 보낸 바이트로 확인합니다.

## 상태

모든 세션의 상태는 main이 정합니다 (`electron/status/`: `osc.ts` 파서, `tracker.ts` 세션별 상태 기계).
`session:status`로 `{ id, status, estimated?, reason?, since? }`를 보냅니다(`since` = 이 상태가 시작된 시각). 출처는 믿을 만한 순서대로:

| 출처 | 대상 | 방식 |
|---|---|---|
| OSC 7501 (Program Status Protocol) | Claude Code 2.1.295+, Codex 0.170+, 셸 탭에서 실행한 모든 프로그램 | main이 pty 출력을 훑습니다 (청크 경계에 걸친 시퀀스는 버퍼링, 4096바이트까지). `OSC 7501 ; ?`에 `OSC 7501 ; ?:states=idle,working,done,blocked,error:kinds=permission,question,auth ST`로 답하는데, 청크를 렌더러로 넘기기 **전에** 답해서 xterm의 DA1 응답보다 먼저 도착합니다 (그래야 Claude가 보고를 시작). 보고: working → working, blocked → waiting, done → done, error → error, idle → idle. `id`별 레코드(백그라운드 작업) 중 가장 급한 것이 이깁니다. 전체 `clear` = 프로그램 종료 → stopped, 폴백으로 돌아감. 모르는 키·상태는 무시. 한 번 보고한 세션은 hook·출력 활동으로 상태를 바꾸지 않습니다. |
| Claude hooks | 로컬 `claude` (7501이 없을 때 폴백) | `UserPromptSubmit`/`PostToolUse`/`PermissionDenied` → working, `PermissionRequest`와 `Notification`(`permission_prompt`, `elicitation_dialog`만 — `idle_prompt`는 절대 안 씀) → waiting, `Stop` → done (`SubagentStart/Stop` 개수가 0보다 크면 working 유지). 7501이 있어도 항상: `StopFailure` → 이유 붙은 error (사용량 제한·로그인·결제·서버, 새 턴 전까지 뒤이은 done/idle 보고로 가려지지 않음), `SessionEnd`(`/clear` 제외) → stopped. |
| 입력한 키 | 전부 | `session:write`로 들어온 것 (포커스·마우스·DA·CPR·OSC 응답은 걸러냄). 7501 없음: waiting 중 키 → working, 바쁠 때 Esc / Ctrl+C → stopped. 7501 있음: Esc / Ctrl+C 뒤 5초 안의 `idle` 보고를 stopped로. |
| 출력 활동 | 보고하지 않는 codex / 셸 | 3초 넘게 출력 → working, 이후 3초 조용 → done, `estimated`(흐린 점)로 표시 |
| 종료 코드 | 전부 | 0, 130, 시그널 → stopped, 그 밖 → error (`reason: exit`) |

hook은 `~/.aquila/claude-hooks.<port>.json`(과 `claude-hooks-status.<port>.json`)의 `type: "http"`입니다 (`url` = 로컬 수신기, `allowedEnvVars`로
`X-Aquila-Session: $AQUILA_TAB_ID`, `timeout: 5`, `onFailure: "continue"`). 포트가 파일에 들어가므로 실행 중인
인스턴스마다 자기 파일 쌍을 쓰고 종료할 때 지웁니다. 포트가 더 이상 응답하지 않는 파일 쌍은 시작할 때 정리합니다.
(예전에는 공유 파일 하나를 모든 인스턴스 — `npm run dev`, smoke, capture — 가 덮어썼고, Claude는 바뀐 설정 파일을 다시
읽기 때문에 앱의 열린 탭이 죽은 포트로 보냈습니다: "hook failed · ECONNREFUSED".) legacy 파일은 `$AQUILA_PORT`를 읽으므로 공유합니다. 수신기는 본문 없이 204로 답하므로
`PermissionRequest`에 결정을 돌려주지 않습니다. Claude는 `SessionStart`에서 http hook을 건너뛰므로 그것만
command + `curl`로 둡니다. 2.1.295보다 오래된 Claude(시작할 때 `claude --version`)는 `claude-hooks-legacy.json`을 받는데,
전부 같은 JSON을 보내는 command + `curl`입니다. 7501 원본 보고와 hook 이벤트 이름은 `~/.aquila/status.log`에
남깁니다 (512 KB에서 교체).

`done`은 그 세션을 화면에 띄우면 `idle`로 바뀝니다. 프로젝트 행 = 세션 중 가장 급한 상태
(`waiting > error > working > done > stopped > idle`).

### 주의 끌기 (`electron/notify.ts`, `features/next-waiting`)

- **알림:** 세션이 화면에 없을 때(창에 포커스가 없거나, 활성 탭도 아니고 보이는 분할 창에도 없을 때 —
  `SessionManager.onScreen`, `session:visible` 기준) waiting / error(종료 코드 오류 제외)가 되면 띄웁니다.
  `done`은 ⚙ 설정 ▸ 완료 시 알림(`config.notifyDone`)을 켰을 때만 알리고, 기본은 조용한 점만(T45).
  제목 = 프로젝트(· 워크트리 브랜치), 본문 = `Claude · 입력 필요 — Bash: npm install`. 맥락은 waiting이면
  `PermissionRequest`의 도구 요약(없으면 7501 `msg`, `Notification` 메시지), done이면 `Stop`의
  `last_assistant_message` 첫 줄(없으면 7501 `msg`)이고, 새 턴이 시작되면 지웁니다. 알림은 400 ms 기다렸다
  띄워서(늦게 온 hook 맥락은 합치고, waiting → working으로 금방 바뀌면 버림), 같은 세션의 같은 상태는 30초 안에
  두 번 알리지 않습니다. 클릭 → 창을 올리고 그 세션으로.
- **리마인더:** 화면 밖에서 10분째 기다리면 한 번 더 알림("10분째 입력 대기").
- **알림 거두기:** `Attention`이 세션마다 띄운 `Notification`을 들고 있다가, 그 세션을 보면(탭 포커스, 분할 창에
  보임, 창 포커스) · 상태가 바뀌면 · 탭을 닫으면 · 리마인더가 뜨면 `close()`해서 알림 센터에서도 지웁니다(세션당 배너 하나).
- **Dock 배지** = `waiting`인 세션 수 (0이면 비움).
- **대기 시간:** 탭과 프로젝트 행에 기다린 시간(`12분`, `since` 기준, 1분 이상)을 `.c-elapsed`로 보여 줍니다.
  행은 가장 오래 기다린 세션 기준.
- **대기 이유** (T52): `session:status`가 같은 `detail`을 함께 보냅니다(waiting / done. 늦게 온 hook이나 7501 `msg`가
  붙이면 다시 보내고, 새 턴이 시작되면 지웁니다). 프로젝트 행은 가장 오래 기다린 세션의 detail을 행 아래 한 줄로
  보여 주고(`Reason`, 누르면 그 세션), 탭은 툴팁으로 보여 줍니다. `isDestructive`
  (`src/shared/lib/risk.ts`: `rm -rf`, `push --force`, `reset --hard`, `DROP TABLE`, `migrate reset`, `--force`…)에
  걸리면 오류 색 ⚠ 표식을 붙입니다 — 막는 장치가 아니라 눈에 띄게 하는 힌트입니다.
- **다음 대기 세션**(⌘J, 팔레트에도): 프로젝트를 가로질러 waiting > error > done 순으로 돌고, 같은 단계에서는
  오래 기다린 것부터. 목록 밖 세션에서 누르면 맨 앞으로.
- **앱 메뉴 막대**(T47, `electron/appMenu.ts`, macOS): Aquila · 파일 · 편집 · 보기 · 윈도우 · 도움말. 단축키 맵으로
  만들어서 가이드의 모든 키가 메뉴에 있어요. renderer가 처리하는 키는 표시만 하고(`registerAccelerator: false`),
  클릭하면 `menu:command`(`ShortcutId` 또는 `settings` / `addProject` / `whatsNew`)를 보내 `useShortcuts`가 키와
  똑같이 실행합니다. macOS는 그래도 키를 항목에 묶기 때문에 `triggeredByAccelerator` 클릭은 무시해요(renderer가 이미
  실행함). 설정… ⌘,는 메뉴 소유로 ⚙ 메뉴를 띄웁니다. `config:set-language`, `config:edit-projects` 뒤에 다시 만들어요
  (윈도우 ▸ 프로젝트에 앞의 9개).
- **전역 단축키**(T41, `electron/globalShortcut.ts`, `features/global-shortcut`): ⚙ 설정 → 전역 단축키…(또는 ⌘K)에서
  키를 녹음하기 전에는 꺼져 있습니다. ⌘/⌃/⌥ 중 하나가 있어야 하고 앱 안 단축키와 겹치면 안 돼요.
  `globalShortcut.register`가 성공해야만 `~/.aquila/global-shortcut.json`에 저장하고, 다른 앱이 쓰는 키면 오류를
  보여 주고 이전 키를 유지합니다. `will-quit`에서 해제, smoke는 읽지도 쓰지도 등록하지도 않아요. 누르면 창을 띄우고
  `global-shortcut:fired { wasFocused }`를 보냅니다. 다른 앱에서 눌렀으면 대기 목록 맨 앞으로, Aquila 안에서
  눌렀으면 ⌘J처럼 다음으로, 목록이 비었으면 창만 띄웁니다. `AQUILA_SMOKE_GLOBAL=1 npm run smoke`는 Finder가 앞에 있을 때
  실제 키를 누르고(System Events, 터미널에 손쉬운 사용 권한 필요) 대기 상태를 보고한 셸로 창이 뜨는지 확인합니다.
  일반 smoke는 이 단계를 건너뜁니다.

## 설정 (`~/.aquila/config.json`)

Agentrix에서 이름이 바뀌었습니다: 처음 실행할 때 `~/.aquila/config.json`이 없으면 `~/.agentrix`를 복사해 옵니다
(`claude-hooks.json`은 새로 만들기 때문에 제외). 예전 폴더는 그대로 둡니다.

```jsonc
{
  "language": "ko",                       // "ko" | "en" — 사이드바 하단에서 전환
  "accounts": { "shared":   { "claudeConfigDir": null },                  // `claude`
                "personal": { "claudeConfigDir": "~/.claude-personal" } },// `claude-personal`
  "groups":   [{ "id": "work" }, { "id": "personal" }], // 라벨은 자동 번역, "label"로 덮어쓰기 가능
  "projects": [{ "id": "salt", "name": "SALT", "group": "personal", "account": "shared", "path": "~/Desktop/SALT" }]
}
```

탭바 오른쪽 계정 전환은 `project.account`를 바꿉니다. 그 프로젝트에서 **새로 여는** Claude 세션부터 적용돼요.

### 앱에서 프로젝트 관리

`features/manage-projects`(사이드바에서 사용)로 JSON을 직접 고치지 않고 프로젝트 목록을 바꿉니다:

- 사이드바 하단 **+** → 메뉴: "로컬 폴더…" 또는 "SSH 호스트…"(원격 프로젝트, T29). 로컬 → 네이티브 폴더 선택(`dialog:pick-folder`) → 다이얼로그: 이름(= 폴더 이름), 그룹, 계정
  (현재 프로젝트 값으로 미리 선택). 추가된 프로젝트가 선택돼요.
- 프로젝트 우클릭 → 네이티브 메뉴(`ui:context-menu`, `electron/menu.ts`): 이름 바꾸기… · 그룹 ▸ (새 그룹… 포함) ·
  Claude 계정 ▸ · 사이드바에서 제거… (확인 필요, 열린 세션은 닫힘, 파일은 절대 건드리지 않음).
- 그룹 라벨 우클릭 → 이름 바꾸기…(비우면 기본 이름) · 위로/아래로 이동 · 새 그룹… · 그룹 삭제(빈 그룹만).
- 행을 다른 행 위(앞/뒤)나 그룹 라벨·빈 그룹(= 맨 뒤)에 끌어다 놓기. 빈 그룹도 계속 보여요.
- 모든 변경은 `config:edit-projects`로 보내는 `ProjectEdit` 하나; main이 순수 함수 `applyProjectEdit`
  (`config.ts`, 테스트 있음)를 적용해 저장합니다. id는 이름의 slug(중복 시 번호), 홈 아래 경로는 `~/…`로 저장.
  `config.json`을 못 읽은 상태면 기본값으로 덮어쓰지 않고 실패해요.

계정 설정 (`accounts.ts`): `accounts:status`가 계정마다 `{ configDirExists, loggedIn }`을 읽습니다 (`loggedIn` =
`.claude.json`에 `oauthAccount`가 있음, 공용은 `~/.claude.json`). 로그인 안 된 계정은 계정 전환 옆에 "설정" 버튼이 뜨고
→ 다이얼로그 → 폴더 생성(`~/.claude-*`만 허용) 후 그 계정으로 Claude 세션을 엽니다
(`createSession(projectId, 'claude', account)`). 로그인은 Claude가 자체 `/login`으로 진행해요. 상태는 창 포커스 때,
그리고 로그인 안 된 계정이 있으면 창이 포커스된 동안 5초마다 다시 읽습니다. 같은 다이얼로그에서 미리보기 후
**명시적으로 눌렀을 때만** `~/.zshrc`에 `claude-<id>() { … }`를 추가해요. `whence`나 rc에 이미 있으면 건너뜁니다.

## 첫 실행 체크리스트

- `features/first-run`: `useFirstRun`이 시작할 때 한 번 main에 묻고(`first-run:get`), `~/.aquila/first-run.json`에
  `finished`가 없으면 체크리스트를 엽니다. 어떻게 닫든(시작하기 / 나중에 하기 / Esc) `finished`가 저장되므로 선택 항목은
  기본 건너뛰기입니다. ⌘K → "시작 점검"으로 다시 열고 다시 점검합니다.
- 항목: 로그인 셸의 PATH를 읽었는지(`restoreShellPath()` 결과) · `claude` / `codex`(선택) / `git`의 버전과 경로, 없으면
  복사할 수 있는 설치 명령 · 프로젝트 폴더(드롭 영역에 폴더를 끌어 놓기 — preload의 `webUtils.getPathForFile` — 또는 폴더
  선택; 첫 그룹에 공용 계정으로 추가) · "로그인은 CLI 안에서" 안내. 창으로 돌아올 때(터미널에서 설치한 뒤)와 "다시 확인"에서
  다시 점검하고, 그때 셸 PATH도 다시 읽습니다.
- Main (`detect.ts`): PATH에서 각 도구를 찾고(별칭 제외) `<bin> --version`(10초 제한)을 실행해 버전을 읽습니다.
  `/usr/bin/git`은 `xcode-select -p`가 성공할 때만 실행합니다(아니면 설치 창을 띄우는 스텁). "경로 지정…"은 파일 선택을
  열고, `--version`이 실행될 때만 `first-run.json` → `paths`에 저장합니다. 지정한 `claude` / `codex`는 세션 명령에서 이름
  대신 (따옴표로 감싸) 쓰이고 hook 버전 확인에도 쓰입니다. 지정한 `git`은 main의 PATH 맨 앞에 들어갑니다.
  smoke는 `first-run.json`을 읽거나 쓰지 않습니다.

## 앱 내 가이드

- `features/guide`: 사이드바 하단 `?`, ⌘/ (단축키 맵의 `guide`), ⌘K → "가이드"로 `Modal`(디자인 시스템, T27/T35와 공유)을
  열어요. 왼쪽은 검색되는 기능 목록, 오른쪽은 고른 기능의 미디어, 1~2줄 설명, 단축키. ↑↓로 고르고(IME 조합 중엔 무시),
  Esc / × / 바깥 클릭으로 닫아요.
- 레지스트리 `model/registry.ts`: `{ id, titleKey, bodyKey, media?, shortcuts? }` — 단축키는 `shared/lib/shortcuts.ts`의
  id(`project1` + `project9` = ⌘1–⌘9 범위)라 표기가 어긋나지 않아요. 설명 문구는 팔레트 키를 `{palette}`로 받아요.
  새 기능 → 항목 하나와 문구 두 개를 추가.
- 마지막 항목은 전체 단축키 시트(`model/sheet.ts`). 맵의 모든 단축키가 한 번씩 들어 있는지 테스트가 확인해요.
- 검색(`model/search.ts`, 테스트 있음): 제목은 퍼지, 그다음 입력한 그대로를 포함하는 설명(긴 문장에 흩어진 글자는
  매치 안 함). 시트 항목은 모든 단축키 이름으로도 찾혀요.
- 미디어(`Media`): WebP/PNG 스크린샷이나 소리 없는 MP4 루프. `prefers-reduced-motion`이나 절전 모드에서는 영상 대신
  포스터를 보여요. 미디어가 없는 항목은 T24가 캡처할 때까지 자리표시(제목 + 단축키)를 보여요.
- 제안: 첫 실행 체크리스트를 닫으면 "둘러보기 / 건너뛰기"를 한 번만 띄워요(`~/.aquila/guide.json` `offered`,
  `guide:get` / `guide:offered`). 가이드를 한 번 열어도 제안한 걸로 쳐요. smoke는 이 파일을 읽거나 쓰지 않아요.

## 릴리스 노트와 업데이트 (T27)

- 노트: `release-notes/<버전>.json` — `{ version, date, headlines: [{ guideId, media?, title: {ko,en}, body: {ko,en} }] }`,
  헤드라인 3~5개(패치 릴리스 x.y.z(z > 0)는 1~5개). `features/release-notes/model/bundle.ts`가 번들(`import.meta.glob`, 오프라인). 검증·버전 비교·초안은
  `model/notes.ts`(import 없음 — 스크립트가 직접 실행, 테스트 있음).
- `scripts/release-notes.ts`(Node 타입 제거로 실행, `tsconfig.scripts.json`): `draft [버전]`은 지난 태그 이후
  Conventional Commits로 초안(`feat` 제목 → 영어 제목, 나머지는 TODO), `check [버전]`은 파일 없음·언어 누락·TODO·헤드라인
  개수·없는 `guideId`·가이드 미디어 없음이면 실패. `npm run dist`가 먼저 `check`를 돌려요.
- 언제 열리나: `electron/releaseNotes.ts`가 `~/.aquila/release-notes.json` `lastSeenVersion`을 관리(`release-notes:get` /
  `release-notes:seen`, 뒤로 가지 않음). 새 설치(기록 없음, 이번 실행 전 `state.json` / `guide.json` 없음) → 버전만 기록하고
  안 띄움(둘러보기는 첫 실행 체크리스트 뒤에 제안). T27 이전 설치 → 현재 버전 노트만. 그 외엔 (lastSeen, current] 구간의
  모든 버전을 최신순으로, 버전별로 묶어서.
- UI: `ReleaseNotesModal`은 가이드의 `Modal`: 버전별 헤드라인, 미디어는 가이드 것(`guideMedia`, 페이지가 넘김),
  "사용법 보기" → `guide.show(guideId)`(`GuideModal` `initialId`). 사이드바 `?`는 네이티브 메뉴(가이드 ⌘/ · 새로운 기능),
  ⌘K → "새로운 기능"도 있음. 둘 다 번들된 모든 버전을 보여요.
- 업데이트: `electron/updater.ts`(패키징된 앱만, smoke/capture 제외)가 `electron-builder.yml` → `publish`의 GitHub 릴리스를
  실행 시와 6시간마다 electron-updater로 확인하고 알림. 알림을 누르면 릴리스 페이지. 서명이 없어 자동 설치는 안 되므로
  (Squirrel.Mac) macOS에서는 다운로드하지 않아요. Windows(T20)는 NSIS 업데이터가 서명 없는 빌드도 설치하므로(서명은
  `publisherName`이 있을 때만 확인, sha512는 항상) 백그라운드에서 받아 종료할 때 설치하고, 알림으로 다시 시작(`quitAndInstall`)을 제안해요.
- smoke: 전부 본 것으로 처리(자동으로 안 열림). ⌘K → "새로운 기능"이 미디어 있는 헤드라인 3개 이상을 보여 주고
  "사용법 보기"가 가이드를 열어야 함(`dist/smoke-whats-new.png`).

## 다국어

`src/shared/i18n/dictionary.ts`에 모든 문구가 `ko`/`en`으로 있습니다 (한쪽이라도 빠지면 타입 체크 실패).
렌더러는 `useT()`, main(알림)은 `translator(config.language)`.

## 빌드·점검

- 렌더러: Vite → `dist/`. Main + preload: `tsc -p tsconfig.electron.json` → `dist-electron/` (CommonJS).
- `node-pty`는 네이티브 모듈이라 `postinstall`에서 `electron-rebuild` 실행. Electron 버전을 바꾸면 `npm install` 다시.
- `npm run smoke`: 빌드 후 앱을 띄워 셸 세션을 열고 pty 왕복을 확인, `dist/smoke.png` 스크린샷 저장 후 종료 (성공 0 / 실패 1).
  `claude`/`codex`가 PATH에 있는지도 로그로 남기고, ⌘K로 첫 실행 체크리스트를, ⌘/로 가이드를 열어 봅니다(`dist/smoke-first-run.png`,
  `dist/smoke-guide.png`, `dist/smoke-guide-shortcuts.png`). 미디어가 없는 가이드 항목이 있으면 실패해요. 패키징된 앱은 스크린샷을 임시 폴더에 저장합니다.
- `npm run capture` (T24, `scripts/capture/capture.sh` + `electron/capture.ts`): `src/features/guide/media/`의 가이드
  미디어를 언어마다 다시 만들어요. 실행마다 버리는 `HOME`(`/tmp/aquila-demo`)을 쓰고, 그 안에 픽스처 zsh 프롬프트,
  고정 대본을 출력하고 OSC 7501로 상태를 알리는 데모 `claude`/`codex` 스크립트, 로그인된 데모 계정, 데모 git
  프로젝트가 있어서 실제 사용자 데이터는 화면에 나오지 않아요. 가이드 항목마다 시나리오가 상태를 연출하고
  `capturePage(rect)`로 12fps 프레임을 잡고, 숨긴 창이 Chromium 자체 MediaRecorder(VP9 WebM, 실시간 재생으로
  타이밍 유지)와 캔버스 WebP로 인코딩해요(ffmpeg 불필요). 결과: `<id>.<lang>.webp`(스틸 또는 루프의 포스터),
  움직이는 항목은 `<id>.<lang>.webm`. 960×600, 루프 5초 이하, 루프 700KB·스틸 250KB 이하(넘으면 실패). 가이드는
  `import.meta.glob`(`model/media.ts`)으로 파일을 찾고, 없는 항목이 있으면 테스트와 smoke가 실패해요. 가이드
  항목을 추가하면 `electron/capture.ts`에 시나리오를 넣고 `npm run capture`.
- Finder에서 연 앱은 launchd의 최소 PATH를 받습니다. `env.ts`가 시작할 때 한 번 로그인 + 인터랙티브 셸의 PATH를 읽어
  앞에 붙입니다 (세션은 원래 로그인 셸로 뜨므로, main이 직접 실행하는 `git` 등을 위한 것).
- `npm run dist`: electron-builder(`electron-builder.yml`) → `release/*.dmg` + `.zip`, arm64, 서명 없음. 런타임 의존성은
  `node-pty`뿐이고(렌더러 라이브러리는 Vite가 번들하므로 devDependencies) asar 밖으로 풀어 둡니다. 아이콘:
  `build/icon.svg` → `npm run icon` → `build/icon.png` (Electron으로 렌더링, `electron/tools/render-icon.ts`).
- `npm run dist:win`(T20): NSIS → `release/AquilaAgents-<버전>-{x64,arm64}-setup.exe` + `latest.yml`, 서명 없음,
  사용자별 설치(관리자 불필요), macOS에서도 빌드됨. `npmRebuild: false`: Mac 빌드는 postinstall 재빌드를 쓰고, Windows는
  `node-pty/build/`를 빼서 node-pty가 N-API `prebuilds/win32-<arch>`를 읽게 해요. CI가 각 Windows 러너에서 패키징하고
  패키징된 Electron으로 패키징된 레이아웃에서 pty를 띄워 봅니다.
