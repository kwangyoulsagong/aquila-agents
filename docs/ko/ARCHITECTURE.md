# 아키텍처

> English: [../en/ARCHITECTURE.md](../en/ARCHITECTURE.md)

```
┌──────── 렌더러 (src/, React, FSD) ────────┐        ┌──────────── Main (electron/, Node) ─────────────┐
│ app/      진입점, 전역 스타일                │  IPC   │ main.ts       창 + IPC 핸들러                     │
│ pages/    workspace (상태 훅, 단축키)        │◀──────▶│ config.ts     ~/.aquila/config.json             │
│ widgets/  sidebar, session-tabs,          │preload │ sessions.ts   세션마다 node-pty 하나              │
│           split-view, changes-panel       │        │ accounts.ts   계정 상태, ~/.claude-* 폴더,        │
│ features/ switch-account, switch-language,│  .ts   │               zsh 함수 (명시적 클릭만)            │
│           open-session, setup-account     │        │ hooks.ts      127.0.0.1:<port> hook 수신기       │
│                                           │        │               + ~/.aquila/claude-hooks.json     │
│ entities/ session (xterm, 상태), project    │        │ git.ts        git status + diff (읽기만)        │
│           diff                            │        │ state.ts      ~/.aquila/state.json (열린 탭)     │
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
4. pty 출력 → `session:data` → `terminalBus` → 해당 id의 xterm (아직 안 붙었으면 버퍼에 보관).
5. 안 보이는 세션도 마운트 상태 유지(`hidden`) → 스크롤 기록 유지, xterm은 숨겨진 화면을 그리지 않음.

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

## 다시 열면 복원

- Main이 `~/.aquila/state.json`에 열린 탭을 탭 순서대로 저장 (`{ projectId, kind, account?, claudeSessionId? }`).
  세션 생성·종료·Claude 세션 변경 때마다 다시 씀(임시 파일 + rename)이라 앱이 죽어도 남아요. 시작할 때 세션이 생기기 전에
  한 번 읽고, 종료할 때 pty를 끄면서 덮어쓰지 않아요. smoke는 읽지도 쓰지도 않아요.
- Claude 탭은 우리가 만든 `--session-id <uuid>`로 시작. `SessionStart` hook이 Claude의 stdin JSON을 hook 수신기의
  `/session/<tab>`으로 보내서, `/clear`나 resume 뒤에도 저장된 id가 따라가요.
- 설정을 읽은 뒤 렌더러가 `restoreSessions()`를 실행 1회당 한 번 호출: Claude → `<configDir>/projects/*/<id>.jsonl`이
  있으면 `claude --resume <id>`(Claude는 첫 메시지 뒤에야 이 파일을 씀), 없으면 새 세션. codex → `codex resume --last`
  (codex가 cwd로 거름). 셸 → 새 셸. 없어진 프로젝트의 탭은 버리고, 없어진 계정은 프로젝트 계정으로 대체.

## 상태

| 출처 | 대상 | 방식 |
|---|---|---|
| Claude hooks | 로컬 `claude` | `UserPromptSubmit`/`PostToolUse` → working, `Notification` → waiting, `Stop` → done. hook = 로컬 수신기로 `curl` |
| 출력 활동 | codex, 셸 | 3초 넘게 출력 → working, 이후 3초 조용 → done |
| 종료 코드 | 전부 | 0이 아니면 → error |

`done`은 그 세션을 화면에 띄우면 `idle`로 바뀝니다. 창에 포커스가 없거나 다른 세션을 보고 있을 때
done/waiting이 되면 알림을 띄웁니다. 프로젝트 행 = 세션 중 가장 급한 상태 (`waiting > error > working > done > idle`).

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

계정 설정 (`accounts.ts`): `accounts:status`가 계정마다 `{ configDirExists, loggedIn }`을 읽습니다 (`loggedIn` =
`.claude.json`에 `oauthAccount`가 있음, 공용은 `~/.claude.json`). 로그인 안 된 계정은 계정 전환 옆에 "설정" 버튼이 뜨고
→ 다이얼로그 → 폴더 생성(`~/.claude-*`만 허용) 후 그 계정으로 Claude 세션을 엽니다
(`createSession(projectId, 'claude', account)`). 로그인은 Claude가 자체 `/login`으로 진행해요. 상태는 창 포커스 때,
그리고 로그인 안 된 계정이 있으면 창이 포커스된 동안 5초마다 다시 읽습니다. 같은 다이얼로그에서 미리보기 후
**명시적으로 눌렀을 때만** `~/.zshrc`에 `claude-<id>() { … }`를 추가해요. `whence`나 rc에 이미 있으면 건너뜁니다.

## 다국어

`src/shared/i18n/dictionary.ts`에 모든 문구가 `ko`/`en`으로 있습니다 (한쪽이라도 빠지면 타입 체크 실패).
렌더러는 `useT()`, main(알림)은 `translator(config.language)`.

## 빌드·점검

- 렌더러: Vite → `dist/`. Main + preload: `tsc -p tsconfig.electron.json` → `dist-electron/` (CommonJS).
- `node-pty`는 네이티브 모듈이라 `postinstall`에서 `electron-rebuild` 실행. Electron 버전을 바꾸면 `npm install` 다시.
- `npm run smoke`: 빌드 후 앱을 띄워 셸 세션을 열고 pty 왕복을 확인, `dist/smoke.png` 스크린샷 저장 후 종료 (성공 0 / 실패 1).
  `claude`/`codex`가 PATH에 있는지도 로그로 남깁니다. 패키징된 앱은 스크린샷을 임시 폴더에 저장합니다.
- Finder에서 연 앱은 launchd의 최소 PATH를 받습니다. `env.ts`가 시작할 때 한 번 로그인 + 인터랙티브 셸의 PATH를 읽어
  앞에 붙입니다 (세션은 원래 로그인 셸로 뜨므로, main이 직접 실행하는 `git` 등을 위한 것).
- `npm run dist`: electron-builder(`electron-builder.yml`) → `release/*.dmg` + `.zip`, arm64, 서명 없음. 런타임 의존성은
  `node-pty`뿐이고(렌더러 라이브러리는 Vite가 번들하므로 devDependencies) asar 밖으로 풀어 둡니다. 아이콘:
  `build/icon.svg` → `npm run icon` → `build/icon.png` (Electron으로 렌더링, `electron/tools/render-icon.ts`).
