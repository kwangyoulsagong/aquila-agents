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
│           first-run                       │        │ git.ts        git status + diff (읽기만)        │
│ entities/ session (xterm, 상태), project    │        │ state.ts      ~/.aquila/state.json (열린 탭)     │
│           diff                            │        │ worktrees.ts  git worktree 만들기 / 재사용 (T7)  │
│           open-in-worktree                │        │ menu.ts       네이티브 우클릭 메뉴               │
│                                           │        │ notify.ts     알림, 리마인더, Dock 배지          │
│                                           │        │ status/       OSC 7501 파서 + 상태 판정          │
│                                           │        │ output.ts     출력 묶음 + 흐름 제어              │
│                                           │        │ detect.ts     CLI 점검, 첫 실행 상태 (T17)       │
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
   에이전트가 끝나면 탭이 셸로 남습니다.
3. 세션별 환경변수: `AQUILA_TAB_ID`, `AQUILA_PORT`, 그리고 **개인** 계정의 Claude 세션에만
   `CLAUDE_CONFIG_DIR=~/.claude-personal` (`claude-personal` 셸 함수와 같음). **공용** 계정은 설정하지 않음(그냥 `claude`).
   Claude가 이 변수로 키체인 항목을 구분하기 때문에 `~/.claude`로 명시하면 안 됩니다.
4. pty 출력 → `electron/output.ts`가 묶어서(16 ms 프레임 또는 64 KB마다 한 메시지, `session:visible`로 화면 밖이면
   200 ms) → `session:data` → `terminalBus` → 해당 id의 xterm (아직 안 붙었으면 버퍼에 보관).
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
- 렌더러: `entities/diff`가 diff를 파일/줄로 나누고(`parseDiff`, 테스트 있음) `.c-diff`로 그립니다.
  파일을 누르면 그 위치로 스크롤. 앱에 포커스가 오면, 그리고 열려 있고 보이는 동안 5초마다 새로고침. 닫혀 있으면 아무것도 안 돌아요.

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

## 워크트리 세션

- "워크트리에서 새 Claude…"(탭 바의 **+** 우클릭, 또는 ⌘K 팔레트) → `features/open-in-worktree` 다이얼로그:
  브랜치 입력칸(로컬 브랜치 추천)과 무엇을 어디에 하는지 알려주는 한 줄.
- Main (`worktrees.ts`, `session:create-worktree`): `git check-ref-format --branch`로 이름을 확인한 뒤, 그 브랜치가
  이미 체크아웃된 워크트리가 있으면 재사용(`git worktree list --porcelain`, 메인 포함), 없으면 메인 워크트리 옆
  `<repo>-wt/<branch>`에 `git worktree add` — 브랜치가 있으면 체크아웃, 없으면 프로젝트의 현재 HEAD에서 `-b`로 만들어요.
  실패하면 git 메시지를 다이얼로그에 보여줘요. 아무것도 지우지 않아요.
- 세션(`SessionInfo.worktree = { path, branch }`)은 그 폴더에서 시작. 탭에 브랜치가 보이고(`.c-tab__branch`, 툴팁에 경로),
  분할 화면 헤더·팔레트 이름·알림 제목에도 붙어요.
- 변경사항 패널은 포커스된 세션을 따라가요: 워크트리 세션이면 그 워크트리를 보여줘요(경로는 main이 살아 있는 세션 id로
  찾고, 렌더러가 준 경로는 쓰지 않아요).
- `worktree:info`는 다이얼로그에 저장소 루트, 현재 브랜치, 로컬 브랜치, 기존 워크트리를 알려줘요(읽기만).

## 다시 열면 복원

- Main이 `~/.aquila/state.json`에 열린 탭을 탭 순서대로 저장 (`{ projectId, kind, account?, worktree?, claudeSessionId? }`).
  세션 생성·종료·Claude 세션 변경 때마다 다시 씀(임시 파일 + rename)이라 앱이 죽어도 남아요. 시작할 때 세션이 생기기 전에
  한 번 읽고, 종료할 때 pty를 끄면서 덮어쓰지 않아요. smoke는 읽지도 쓰지도 않아요.
- Claude 탭은 우리가 만든 `--session-id <uuid>`로 시작. `SessionStart` hook이 Claude의 stdin JSON을 hook 수신기
  (`POST /hook`)로 보내서, `/clear`나 resume 뒤에도 저장된 id가 따라가요.
- 설정을 읽은 뒤 렌더러가 `restoreSessions()`를 실행 1회당 한 번 호출: Claude → `<configDir>/projects/*/<id>.jsonl`이
  있으면 `claude --resume <id>`(Claude는 첫 메시지 뒤에야 이 파일을 씀), 없으면 새 세션. codex → `codex resume --last`
  (codex가 cwd로 거름). 셸 → 새 셸. 없어진 프로젝트의 탭은 버리고, 없어진 계정은 프로젝트 계정으로 대체. 워크트리 탭은 그 워크트리에서 다시 열고,
  폴더가 없어졌으면 버려요.

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

hook은 `~/.aquila/claude-hooks.json`의 `type: "http"`입니다 (`url` = 로컬 수신기, `allowedEnvVars`로
`X-Aquila-Session: $AQUILA_TAB_ID`, `timeout: 5`, `onFailure: "continue"`). 수신기는 본문 없이 204로 답하므로
`PermissionRequest`에 결정을 돌려주지 않습니다. Claude는 `SessionStart`에서 http hook을 건너뛰므로 그것만
command + `curl`로 둡니다. 2.1.295보다 오래된 Claude(시작할 때 `claude --version`)는 `claude-hooks-legacy.json`을 받는데,
전부 같은 JSON을 보내는 command + `curl`입니다. 7501 원본 보고와 hook 이벤트 이름은 `~/.aquila/status.log`에
남깁니다 (512 KB에서 교체).

`done`은 그 세션을 화면에 띄우면 `idle`로 바뀝니다. 프로젝트 행 = 세션 중 가장 급한 상태
(`waiting > error > working > done > stopped > idle`).

### 주의 끌기 (`electron/notify.ts`, `features/next-waiting`)

- **알림:** 창에 포커스가 없거나 다른 세션을 보고 있을 때 done / waiting / error(종료 코드 오류 제외)가 되면 띄웁니다.
  제목 = 프로젝트(· 워크트리 브랜치), 본문 = `Claude · 입력 필요 — Bash: npm install`. 맥락은 waiting이면
  `PermissionRequest`의 도구 요약(없으면 7501 `msg`, `Notification` 메시지), done이면 `Stop`의
  `last_assistant_message` 첫 줄(없으면 7501 `msg`)이고, 새 턴이 시작되면 지웁니다. 알림은 400 ms 기다렸다
  띄워서(늦게 온 hook 맥락은 합치고, waiting → working으로 금방 바뀌면 버림), 같은 세션의 같은 상태는 30초 안에
  두 번 알리지 않습니다. 클릭 → 창을 올리고 그 세션으로.
- **리마인더:** 화면 밖에서 10분째 기다리면 한 번 더 알림("10분째 입력 대기").
- **Dock 배지** = `waiting`인 세션 수 (0이면 비움).
- **대기 시간:** 탭과 프로젝트 행에 기다린 시간(`12분`, `since` 기준, 1분 이상)을 `.c-elapsed`로 보여 줍니다.
  행은 가장 오래 기다린 세션 기준.
- **다음 대기 세션**(⌘J, 팔레트에도): 프로젝트를 가로질러 waiting > error > done 순으로 돌고, 같은 단계에서는
  오래 기다린 것부터. 목록 밖 세션에서 누르면 맨 앞으로.

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

- 사이드바 하단 **+** → 네이티브 폴더 선택(`dialog:pick-folder`) → 다이얼로그: 이름(= 폴더 이름), 그룹, 계정
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

## 다국어

`src/shared/i18n/dictionary.ts`에 모든 문구가 `ko`/`en`으로 있습니다 (한쪽이라도 빠지면 타입 체크 실패).
렌더러는 `useT()`, main(알림)은 `translator(config.language)`.

## 빌드·점검

- 렌더러: Vite → `dist/`. Main + preload: `tsc -p tsconfig.electron.json` → `dist-electron/` (CommonJS).
- `node-pty`는 네이티브 모듈이라 `postinstall`에서 `electron-rebuild` 실행. Electron 버전을 바꾸면 `npm install` 다시.
- `npm run smoke`: 빌드 후 앱을 띄워 셸 세션을 열고 pty 왕복을 확인, `dist/smoke.png` 스크린샷 저장 후 종료 (성공 0 / 실패 1).
  `claude`/`codex`가 PATH에 있는지도 로그로 남기고, ⌘K로 첫 실행 체크리스트를 열어 봅니다(`dist/smoke-first-run.png`). 패키징된 앱은 스크린샷을 임시 폴더에 저장합니다.
- Finder에서 연 앱은 launchd의 최소 PATH를 받습니다. `env.ts`가 시작할 때 한 번 로그인 + 인터랙티브 셸의 PATH를 읽어
  앞에 붙입니다 (세션은 원래 로그인 셸로 뜨므로, main이 직접 실행하는 `git` 등을 위한 것).
- `npm run dist`: electron-builder(`electron-builder.yml`) → `release/*.dmg` + `.zip`, arm64, 서명 없음. 런타임 의존성은
  `node-pty`뿐이고(렌더러 라이브러리는 Vite가 번들하므로 devDependencies) asar 밖으로 풀어 둡니다. 아이콘:
  `build/icon.svg` → `npm run icon` → `build/icon.png` (Electron으로 렌더링, `electron/tools/render-icon.ts`).
