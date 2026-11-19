# Aquila Agents Windows 지원: 사용자·엔지니어링 관점 조사 (2026-11 기준)

> 조사 범위: macOS 우선 Electron 터미널 앱(Aquila Agents: Electron 45 + React 19 + xterm 5.5 WebGL + node-pty)을 Windows에서도 쓸 만하게 만드는 데 무엇이 필요한가.
> 출처 표기 원칙: 모든 사실에 [출처] 링크를 단다. 링크가 없는 내용은 "추론" 또는 "Gaps"에 둔다. 여기서 "학습 지식"이라고 적은 항목은 이번 세션에서 웹으로 검증하지 못한 것이다.

## 1. Claude Code와 Codex CLI는 Windows에서 어떻게 돌아가나 (2026 말)

### Takeaway

두 CLI 모두 **네이티브 Windows(PowerShell/CMD)를 공식 지원**하며 WSL은 "선택지"다. Claude Code는 Git for Windows가 있으면 Git Bash를, 없으면 PowerShell을 도구 셸로 쓴다. 단 Claude Code의 샌드박스는 네이티브 Windows에서 지원되지 않고(WSL2에서만), Codex는 자체 Windows 샌드박스(mxc/elevated/unelevated)가 있다. 그래서 Aquila Agents는 "네이티브 + WSL" 둘 다를 1급 실행 대상으로 다뤄야 한다.

### Cited Findings

**Claude Code**

- 지원 OS: Windows 10 1809+ / Windows Server 2019+, x64·ARM64. 지원 셸: Bash, Zsh, PowerShell, CMD. — [Claude Code setup](https://code.claude.com/docs/en/setup)
- 설치: PowerShell `irm https://claude.ai/install.ps1 | iex`, CMD `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`, 또는 `winget install Anthropic.ClaudeCode`(WinGet은 자동 업데이트 안 됨). 관리자 권한 불필요. — [setup](https://code.claude.com/docs/en/setup)
- 네이티브 설치 위치: `%USERPROFILE%\.local\bin\claude.exe`, 버전들은 `%USERPROFILE%\.local\share\claude`. — [setup (Uninstall 섹션)](https://code.claude.com/docs/en/setup)
- 네이티브 vs WSL 표: 네이티브 Windows = 요구사항 없음(Git for Windows는 선택), **샌드박싱 미지원**. WSL2 = 샌드박싱 지원. WSL1 = 샌드박싱 미지원. — [setup](https://code.claude.com/docs/en/setup)
- Git for Windows가 없으면 PowerShell tool로 명령 실행. 있으면 Bash tool이 Git Bash를 사용. 못 찾으면 settings.json `env.CLAUDE_CODE_GIT_BASH_PATH`(`C:\\Program Files\\Git\\bin\\bash.exe`)로 지정. Bash tool·Monitor tool은 Git Bash 필요. — [setup](https://code.claude.com/docs/en/setup)
- WSL에서는 리눅스 설치 스크립트로 WSL 안에 설치하고 "WSL 터미널 안에서" `claude`를 실행(PowerShell/CMD에서가 아님). WSL은 Git for Windows 불필요. — [setup](https://code.claude.com/docs/en/setup)
- WinGet 자동 업그레이드는 실행 중인 exe가 Windows에서 잠겨 실패할 수 있음. — [setup](https://code.claude.com/docs/en/setup)
- Windows 바이너리는 "Anthropic, PBC"로 Authenticode 서명. — [setup](https://code.claude.com/docs/en/setup)

**Codex CLI**

- Codex는 데스크톱 앱, CLI, IDE 확장으로 Windows 지원. "PowerShell에서 네이티브로" 실행 가능, WSL/VM 불필요. — [Codex Windows sandbox docs](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- 샌드박스 구현: `mxc`(권장, 관리자 설정 불필요; Windows 11 24H2 build 26100.9278 / 25H2 26200.9278 이상 필요), `elevated`(레거시 대체, 관리자 승인 설정 필요), `unelevated`(네트워크 격리 약함, deny-read 미지원). `config.toml`의 `[windows] sandbox = "elevated"`. — [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- 최소 OS: Windows 11 권장, Windows 10은 best effort이며 1809+ 필요(ConPTY 때문), winget 필요. mxc에서는 포그라운드 명령 종료 시 자식 프로세스가 정리되어 분리된 dev server가 죽을 수 있음. — [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- WSL은 "리눅스 네이티브 툴이 필요하거나 이미 WSL2에서 작업하는 경우" 권장. — [Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- 2026년 3월 Windows 버전에서 네이티브 PowerShell 지원과 Windows 네이티브 에이전트 샌드박스 추가(2차 출처). — [Wikipedia: OpenAI Codex](<https://en.wikipedia.org/wiki/OpenAI_Codex_(AI_agent)>)

**사용자 고통 (GitHub 이슈, 사용자 보고)**

- Claude Code: 한글(CJK) 붙여넣기가 no-flicker 렌더러에서 UTF-8→Windows-1252로 깨짐(2.1.167에서도 재현), 우회책 `CLAUDE_CODE_NO_FLICKER=0`. — [anthropics/claude-code#65806](https://github.com/anthropics/claude-code/issues/65806)
- Claude Code: Windows 11 25H2에서 한글 IME 조합창 튐/글자 누락. 우회책은 Git Bash에서 `winpty claude` + D2Coding 폰트. 단 보고자가 2026-04-28에 2.1.121에서 기본 Windows Terminal로 정상 동작한다고 했고 7/30에 종료. — [anthropics/claude-code#51768](https://github.com/anthropics/claude-code/issues/51768)
- Claude Code: IME 토글이 포커스 이동 없이 안 됨, 한글 IME 차단 등 관련 이슈 다수. — [#45055](https://github.com/anthropics/claude-code/issues/45055), [#68952](https://github.com/anthropics/claude-code/issues/68952)
- Claude Code: Windows에서 Ctrl+V 이미지 붙여넣기 무반응(v2.1.131). 문서상 Windows/WSL은 Alt+V로 이미지 붙여넣기(2차 출처에서 언급). — [#57316](https://github.com/anthropics/claude-code/issues/57316), [felloai 정리](https://felloai.com/claude-code-images/)
- Codex 데스크톱(Windows): WSL 선택했는데 PowerShell 5.1에서 스레드 시작, 잘못된 `C:\mnt\c` 경로. — [openai/codex#28302](https://github.com/openai/codex/issues/28302), [#21147](https://github.com/openai/codex/issues/21147)
- Codex: PATH가 MS Store(MSIX) `pwsh.exe` App Execution Alias(`Microsoft\WindowsApps`)를 가리키면 샌드박스 러너가 spawn 실패. 일반 PowerShell 7 설치로 해결. — [openai/codex#18937](https://github.com/openai/codex/issues/18937)
- Codex: WSL 안에 CLI가 없을 때 재연결 루프/Ubuntu 재시작/WSLg 포커스 탈취, ~20초마다 wsl.exe 폴링으로 로그 폭증(2026-11). — [#60204](https://github.com/openai/codex/issues/60204), [#62097](https://github.com/openai/codex/issues/62097), [#14461](https://github.com/openai/codex/issues/14461)

### Inferences

- Aquila Agents가 Windows에서 "claude 열기"를 할 때 기본값은 **네이티브 `claude.exe`를 PowerShell 7(없으면 Windows PowerShell) 안에서 실행**이 가장 안전하다. WSL은 프로젝트 경로가 `\\wsl$`/`\\wsl.localhost` 이거나 사용자가 프로필로 선택했을 때.
- Codex 데스크톱 이슈들은 "WSL 감지/폴링을 잘못하면 사용자 머신을 괴롭힌다"는 교훈이다. WSL 탐지는 앱 시작 시 1회 + 사용자 요청 시에만.
- `pwsh` 탐지 시 `WindowsApps` 앨리어스 경로는 피하고 실제 설치 경로(`C:\Program Files\PowerShell\7\pwsh.exe`)를 우선해야 한다.

### Gaps

- Claude Code 공식 문서에 Windows 알림(터미널 bell/OSC) 동작 설명은 찾지 못함.
- Codex CLI의 Windows 자격 증명 저장 위치(`auth.json` vs Credential Manager)는 이번 세션에서 확인 못 함.

## 2. node-pty / xterm.js on Windows

### Takeaway

node-pty는 이제 **ConPTY만** 쓴다(winpty 제거, Windows 10 1809+ 필수). 번들 conpty.dll 디렉터리가 저장소에 있다. 다수 세션을 동시에 spawn/kill하는 앱(Aquila Agents가 정확히 그 형태)에서 크래시·conhost.exe 누수 이슈가 2025–2026에 보고되어 있다. xterm.js 쪽은 `windowsPty` 옵션을 반드시 설정해야 리사이즈/스크롤백이 정상이다.

### Cited Findings

- node-pty: Windows 10 1809(build 18309)+ 필수, Node 16 / Electron 19 이상, 빌드에 Python·C++ 컴파일러·Windows SDK "Desktop C++ Apps"·Spectre-mitigated libs(MSB8040 회피) 필요. PowerShell이 `SystemRoot` env 없이 시작하면 오류 8009001d. 저장소에 `third_party/conpty/1.25.260303002` 존재. — [microsoft/node-pty README](https://github.com/microsoft/node-pty)
- winpty 지원 제거 제안/진행. — [node-pty#842](https://github.com/microsoft/node-pty/issues/842)
- 여러 프로세스에서 ConPTY 동시 spawn/kill 시 `conpty_console_list_agent`가 "AttachConsole failed"로 크래시, exit 이벤트 미전달(node-pty 1.1.0, 1.2.0-beta.18, Win11 26200). — [node-pty#1007](https://github.com/microsoft/node-pty/issues/1007)
- `ptyHandles` 데이터 레이스로 0xC0000005 크래시 → upstream PR #922(뮤텍스)로 수정되었다고 타 프로젝트가 인용. — [omp-unified-exec#68](https://github.com/oh-my-omp/omp-unified-exec/issues/68)
- 자연 종료 후 conhost.exe 고아화 / conout worker 미종료 → Qwen Code가 번들 ConPTY로 우회 PR. — [QwenLM/qwen-code#11497](https://github.com/QwenLM/qwen-code/pull/11497), [#11313](https://github.com/QwenLM/qwen-code/pull/11313)
- 이미 종료된 셸을 kill할 때 ConPTY 내부 0xC0000005 크래시 보고. — [clawdling#4](https://github.com/jddavenportOpen/clawdling/issues/4)
- VS Code 디버거 하에서 spawn 멈춤 → 디버거 붙으면 ConPTY 비활성화. — [node-pty#640](https://github.com/microsoft/node-pty/issues/640)
- node-pty에 ConPTY의 화면 재출력을 막기 위한 `clear()` 메서드가 있음. — [node-pty docs (jsdocs)](https://www.jsdocs.io/package/node-pty)
- xterm.js 5.2+: `windowsMode` 대신 `windowsPty: { backend: 'conpty', buildNumber }`. ConPTY + Win11 build 21376+면 reflow 비활성화/줄 wrap 처리, rows 증가 시 내용을 스크롤백으로 밀어냄(ConPTY가 아래에 빈 줄을 추가하기 때문). — [xterm 5.3 typings](https://cdn.jsdelivr.net/npm/xterm@5.3.0/typings/xterm.d.ts), [xterm 5.2 release](https://newreleases.io/project/npm/xterm/release/5.2.0)

### Inferences

- Aquila Agents 렌더러: `process.platform === 'win32'`이면 `new Terminal({ windowsPty: { backend: 'conpty', buildNumber: os.release() 세 번째 숫자 } })`. buildNumber는 main에서 IPC로 전달.
- 세션 kill 경로를 직렬화(동시 kill 금지, 짧은 큐)하고, 이미 exit한 pty는 kill하지 않으며, 앱 종료 시 남은 conhost.exe를 정리하는 로직이 필요할 수 있다.
- 네이티브 모듈: Windows x64/arm64용 node-pty를 Electron 45 ABI로 CI에서 빌드(`@electron/rebuild`)해야 하고 Windows 러너가 필요하다(macOS에서 교차 빌드 불가 — 학습 지식).
- Ctrl+C: ConPTY는 Ctrl+C를 `\x03`로 받아 콘솔 앱에 CTRL_C_EVENT로 전달하므로 그대로 pty.write하면 된다(학습 지식, 미검증).

### Gaps

- node-pty 최신 버전의 prebuilt 바이너리 제공 여부, Windows ARM64 공식 지원 여부: README에 언급 없음.
- xterm.js + ConPTY 환경에서 한글 IME 조합 이슈의 최신 상태(VS Code 이슈 트래커 확인 필요).

## 3. 셸 선택과 WSL 실행

### Takeaway

VS Code·Windows Terminal의 패턴이 사실상 표준: 셸 자동 감지(PowerShell 7 > Windows PowerShell, Git Bash, CMD, 각 WSL 배포판) + "기본 프로필" 선택 + 프로필별 args/env. WSL은 `wsl.exe -d <distro>`로 실행. 현재 Aquila Agents의 `$SHELL -l -i -c "<cmd>; exec $SHELL -l -i"` 패턴은 Windows에 그대로 옮길 수 없고 셸별 템플릿이 필요하다.

### Cited Findings

- VS Code: `terminal.integrated.profiles.windows`, `terminal.integrated.defaultProfile.windows`. 기본은 PowerShell. `source: "PowerShell" | "Git Bash"`로 자동 탐지. PowerShell 6+ 설치 시 Windows PowerShell은 기본 목록에서 숨김. WSL 셸 자동 감지(`terminal.integrated.useWslProfiles`로 끔), 수동 WSL 프로필은 `path: C:\WINDOWS\System32\wsl.exe`, `args: ["-d","Debian"]`. Cygwin/MSYS2/Cmder 같은 "unsafe" 경로는 경고 후에만 노출. `bash.exe` vs `git-bash.exe` 차이 존재. — [VS Code terminal profiles](https://code.visualstudio.com/docs/terminal/profiles)
- Windows Terminal 프로필 예: `"commandline": "C:\\Program Files\\Git\\bin\\bash.exe -i -l -c 'winpty claude; exec bash'"`, `"startingDirectory": "C:\\path\\to\\project"` (Aquila Agents의 현재 실행 패턴과 같은 모양). — [anthropics/claude-code#51768](https://github.com/anthropics/claude-code/issues/51768)
- `wsl --distribution <name> --user <user>`, `wsl --list --verbose`(`--quiet`는 이름만), `wsl ~`, WSL2는 Win11 또는 Win10 1903(18362)+. 32비트 프로세스에서는 `C:\Windows\Sysnative\wsl.exe`. — [WSL basic commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
- 에이전트 매니저 비교(벤더 페이지, Pane): 최선은 "에이전트·터미널·git 모두 배포판 안에서 리눅스 파일시스템 대상으로 실행". `\\wsl$` 경로를 Windows git으로 여는 방식은 느리고 리눅스 전용 스크립트가 깨짐. 일부 앱은 WSL 경로를 거부. — [runpane.com](https://runpane.com/agent-managers-for-windows)

### Inferences

- Windows 셸별 래핑 템플릿(제안):
  - PowerShell 7/5: `pwsh.exe -NoLogo -NoExit -Command "claude"` (프로필 로드됨 → 사용자 PATH/함수 적용; `-NoExit`가 "`exec $SHELL`" 역할).
  - CMD: `cmd.exe /K claude`.
  - Git Bash: `bash.exe -l -i -c "claude; exec bash -l -i"` (현재 macOS 로직 재사용 가능).
  - WSL: `wsl.exe -d <distro> --cd <linuxPath> -- bash -lic "claude; exec bash -li"`. `--cd`는 학습 지식으로 존재(Windows 경로와 리눅스 경로 모두 허용)하나 이번에 가져온 MS 문서 페이지에는 나오지 않음 → 구현 전 `wsl --help`로 확인.
- 경로 변환: `C:\Users\a\proj` ↔ `/mnt/c/Users/a/proj`는 단순 규칙이지만 사용자가 `automount.root`를 바꿨을 수 있으므로 `wsl.exe -d X -e wslpath -a 'C:\...'`로 변환하는 것이 정확(학습 지식). `\\wsl.localhost\Ubuntu\home\a\proj` → 배포판=Ubuntu, 경로=`/home/a/proj`.
- `wsl --list` 출력은 UTF-16LE라 Node에서 디코딩 주의(학습 지식, 미검증). `WSL_UTF8=1` env로 UTF-8 출력 가능하다는 것도 학습 지식.
- 프로젝트 단위로 "실행 환경(native/WSL distro)"을 저장하는 것이 사용자의 기대(Pane이 이를 강점으로 내세움).

### Gaps

- Warp/Wave/Tabby의 셸 선택 UX 세부(이번 세션에서 미조사). Tabby·Wave는 Windows 빌드가 있고 WSL 프로필 자동 감지를 한다는 것은 학습 지식 수준.

## 4. Claude 계정 분리 (CLAUDE_CONFIG_DIR) on Windows

### Takeaway

**Windows에는 Keychain 문제가 없다.** 자격 증명은 `%USERPROFILE%\.claude\.credentials.json` 파일이고, `CLAUDE_CONFIG_DIR`을 설정하면 그 디렉터리 아래에 저장된다. 따라서 Windows에서는 계정 분리가 macOS보다 단순하다. zsh 함수의 대응물은 PowerShell `$PROFILE`의 함수다.

### Cited Findings

- "On Windows, credentials are stored in `%USERPROFILE%\.claude\.credentials.json` and inherit the access controls of your user profile directory." `CLAUDE_CONFIG_DIR` 설정 시 `.credentials.json`을 그 디렉터리에 저장하고, macOS Keychain 항목도 그 디렉터리에 키잉. — [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- 다중 계정 공식 방법: 계정별 `CLAUDE_CONFIG_DIR`. 예시는 bash/zsh alias `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'`. 단, API key 없는 Console 로그인은 config dir 밖에 저장되어 분리 안 됨. — [authentication](https://code.claude.com/docs/en/authentication)
- Anthropic profile 디렉터리는 Windows에서 `%APPDATA%\Anthropic`. — [authentication](https://code.claude.com/docs/en/authentication)
- PowerShell에서 env 설정 문법 `$env:CLAUDE_CODE_OAUTH_TOKEN = "..."`, CMD `set ...`. — [authentication](https://code.claude.com/docs/en/authentication)

### Inferences

- PowerShell `$PROFILE` 대응(제안, T2의 "사용자 확인 후 쓰기" 규칙 적용):
  ```powershell
  function claude-personal { $env:CLAUDE_CONFIG_DIR = "$HOME\.claude-personal"; try { claude @args } finally { Remove-Item Env:CLAUDE_CONFIG_DIR } }
  ```
  `$PROFILE` 경로는 PowerShell 7(`Documents\PowerShell\...`)과 5.1(`Documents\WindowsPowerShell\...`)이 다르고 OneDrive 문서 폴더 리디렉션이 흔함(학습 지식) → 두 프로필 중 어디에 쓸지 사용자에게 보여주고 확인.
- Aquila Agents가 직접 spawn하는 세션은 node-pty `env`에 `CLAUDE_CONFIG_DIR`을 넣으면 셸 종류와 무관하게 동작하므로, Windows에서는 `$PROFILE` 수정 기능은 우선순위 낮음.
- "공유 계정은 변수를 unset" 규칙은 Windows에서는 Keychain 이유가 없지만, 기본 `%USERPROFILE%\.claude` 사용을 위해 여전히 unset이 맞다.
- WSL 세션은 WSL 내부 `~/.claude`를 쓰므로 Windows 쪽 로그인과 별개(Pane이 "WSL에서 기존 로그인 재사용"을 기능으로 내세운다는 점에서 사용자에게 실제 마찰임 — [runpane.com](https://runpane.com/agent-managers-for-windows)).

### Gaps

- Codex CLI의 다중 계정(`CODEX_HOME`) Windows 동작은 미확인(문서 예시 `C:\Users\alice\.codex`만 확인 — [Codex sandbox docs](https://learn.chatgpt.com/docs/windows/windows-sandbox)).

## 5. Hooks on Windows

### Takeaway

**`curl` command hook 대신 `type: "http"` hook으로 바꾸는 것이 1순위.** Windows에서 command hook은 Git Bash(없으면 PowerShell)로 실행되어 따옴표/셸 차이와 "Git Bash 없으면 실패가 tool call을 막는" 엄격 모드 문제가 있다. HTTP hook은 셸 없이 Claude가 직접 POST한다.

### Cited Findings

- Hook 타입: `command`, `http`(이벤트 JSON을 URL로 POST), `mcp_tool`, `prompt`, `agent`. `http` 필드: `url`, `headers`(`$VAR` 보간, `allowedEnvVars`로 허용), `onFailure`(`continue`/`block`, v2.1.295+), `timeout`(기본 600초). 2xx+빈 body=성공, 연결 실패/non-2xx=비차단 오류. 관리자는 `allowedHttpHookUrls`로 제한 가능. — [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- Shell form command hook: macOS/Linux는 `sh -c`, Windows는 Git Bash, 없으면 PowerShell. `shell: "bash" | "powershell"` 필드. `args`가 있으면 exec form(셸 없이 직접 spawn). — [hooks](https://code.claude.com/docs/en/hooks)
- Windows 주의: exec form은 실제 실행 파일 필요(.cmd/.bat shim 불가). Git Bash 없으면 PreToolUse/PermissionRequest에서 0/2 외 exit code는 실패로 보고 tool call을 차단 → `"onFailure": "continue"` 권장. PowerShell에서 따옴표 문자열만 있는 command는 실행되지 않고 출력됨(`&` 필요). Windows엔 `/dev/tty` 없음 → `terminalSequence` JSON 필드 사용. — [hooks](https://code.claude.com/docs/en/hooks)

### Inferences

- Aquila Agents의 `~/.aquila/claude-hooks.json`을 플랫폼 공통으로 `{"type":"http","url":"http://127.0.0.1:<port>/hook/<event>","headers":{"X-Aquila Agents-Session":"$AQUILA_SESSION_ID"},"allowedEnvVars":["AQUILA_SESSION_ID"],"timeout":5,"onFailure":"continue"}` 형태로 바꾸면 curl·따옴표·셸 문제가 모두 사라지고 macOS에서도 프로세스 spawn 비용이 줄어든다. 최소 Claude Code 버전 요구(특히 `onFailure` 2.1.295+)를 감지해 폴백(command+curl)을 둘지 결정.
- `--settings` 경로는 Windows에서 `%USERPROFILE%\.aquila\claude-hooks.json`; 공백 포함 경로 인용 주의.
- WSL 세션의 hook은 WSL 안에서 실행되므로 `127.0.0.1`이 Windows 호스트를 가리키는지가 WSL 네트워킹 모드(mirrored vs NAT)에 의존(학습 지식). NAT 모드에서는 Windows 호스트 IP(`ip route` default gateway — [WSL basic commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands))로 접속해야 하고, Windows 방화벽이 막을 수 있음. → WSL 세션에는 호스트 주소를 env로 주입하거나 서버를 `0.0.0.0` + 토큰 인증으로 바인딩해야 할 수 있다.

### Gaps

- `curl.exe`가 Windows 10 1803+에 기본 포함된다는 점은 학습 지식(이번 세션 미검증). HTTP hook으로 가면 무관.

## 6. Electron UI 관례 on Windows

### Takeaway

타이틀바(`titleBarOverlay`), 단축키 매핑(Ctrl 충돌), 알림(AppUserModelID), 폰트/IME가 핵심. Cmd→Ctrl 단순 치환은 터미널에서 Ctrl+C/V/W/T와 정면 충돌하므로 Windows Terminal/VS Code처럼 **Ctrl+Shift 계열**을 앱 단축키로 써야 한다.

### Cited Findings

- `titleBarStyle: 'hidden'` + Windows/Linux에서는 `titleBarOverlay` 필수(창 컨트롤 복원). 객체로 `height`, `color`, `symbolColor`(Windows only) 지정, 투명색 허용. CSS `env(titlebar-area-x/width/height)`로 컨트롤 영역 회피. 컨트롤은 RTL/설정에 따라 좌/우. 드래그는 `app-region: drag`. macOS `hiddenInset`은 고정 인셋 프리셋, `trafficLightPosition`으로 정밀 위치. — [Electron custom title bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- Windows Terminal 기본 키: 창 분할 Alt+Shift+Plus/Minus, 자동 분할 Alt+Shift+D, 포커스 이동 Alt+화살표, 리사이즈 Alt+Shift+화살표, 창 닫기 Ctrl+Shift+W, 명령 팔레트 Ctrl+Shift+P. — [Windows Terminal panes](https://learn.microsoft.com/en-us/windows/terminal/panes)
- Windows 알림: Start Menu 바로가기에 AppUserModelID + ToastActivatorCLSID 필요. Squirrel이면 자동 설정, 개발 중엔 `app.setAppUserModelId()` 직접 호출. 고급 알림은 `toastXml`(잘못된 XML이면 `failed` 이벤트), 액션 버튼은 `action` 이벤트. 집중 모드 등으로 버려질지 확인은 `windows-notification-state` 모듈. — [Electron notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)
- Claude Code 데스크톱 실행 중 시스템 전역 한글 IME가 다른 앱에서 깨지는 보고(Windows 11) — IME는 Windows에서 특히 민감한 영역. — [anthropics/claude-code#84395](https://github.com/anthropics/claude-code/issues/84395)
- 한글 표시에 D2Coding 폰트 권장(사용자 우회책). — [#51768](https://github.com/anthropics/claude-code/issues/51768)

### Inferences

- 단축키 매핑 제안: macOS ⌘T/⌘W/⌘1–9/⌘K → Windows Ctrl+Shift+T/W, Ctrl+1–9(또는 Alt+1–9), Ctrl+Shift+K. 복사/붙여넣기는 "선택 영역이 있으면 Ctrl+C=복사, 없으면 SIGINT" + Ctrl+Shift+C/V + 우클릭 붙여넣기(Windows Terminal/VS Code 관례 — 학습 지식). Ctrl+V는 **Claude Code가 이미지 붙여넣기에 쓰므로** 기본적으로 pty에 그대로 전달하는 것이 안전(이미지 paste 이슈 #57316 참고). ⌘⌥T 같은 기존 단축키는 Ctrl+Alt가 AltGr과 겹쳐 유럽 키보드에서 문자 입력을 깨므로 피함(학습 지식).
- 단축키 표기·처리는 `CommandOrControl` 같은 플랫폼 추상화를 shared 레이어에 둔다.
- 알림: electron-builder NSIS도 `appId`로 AppUserModelID와 Start Menu 바로가기를 만든다(학습 지식, 미검증). 개발 모드에서는 `app.setAppUserModelId(appId)` 호출 필수.
- 작업 표시줄: `win.setOverlayIcon()`(대기 세션 수 배지), `win.flashFrame(true)`(입력 대기 시)가 macOS dock 배지 대체(학습 지식).
- `shell.trashItem`은 Windows에서 휴지통으로 이동(학습 지식). T11(세션/메모리 휴지통)은 그대로 동작할 가능성 높음.
- 폰트 스택: `"Cascadia Mono", "D2Coding", Consolas, monospace` — Cascadia는 Win11 기본 포함(학습 지식). 디자인 토큰 `--font-*`에 플랫폼 폴백 추가.
- WebGL: 일부 GPU/원격 데스크톱/VM에서 WebGL 컨텍스트 손실이 잦으므로 `onContextLoss` 시 DOM/canvas 렌더러로 폴백(학습 지식).

### Gaps

- Windows 11 snap layouts와 `titleBarOverlay` 상호작용: 이번에 가져온 문서에 없음.
- 작업 표시줄 배지/트레이 관련 공식 문서는 이번 세션에서 미조회.

## 7. 시스템 모니터 대응

### Takeaway

`vm_stat/sysctl/pmset/memory_pressure/ps`는 Windows에 없다. Node 내장(`os.cpus()`, `os.totalmem()/freemem()`, `os.loadavg()`는 Windows에서 [0,0,0] — 학습 지식) + PowerShell `Get-CimInstance`(Win32_Battery, Win32_PerfFormattedData) 또는 `systeminformation` 패키지가 현실적이다.

### Cited Findings

- `systeminformation`은 Windows를 "partial" 지원으로 표기, 최신 안정 5.33.23, v6 베타(breaking). — [systeminformation.io](https://systeminformation.io/)

### Inferences

- 학습 지식: `wmic`는 Windows 11에서 deprecated이며 최신 빌드에서 기본 제거(FoD) — 사용 금지. `Get-CimInstance Win32_Battery`(EstimatedChargeRemaining, BatteryStatus), 프로세스 CPU/메모리는 `Get-Process` 또는 `Get-CimInstance Win32_PerfFormattedData_PerfProc_Process`. PowerShell 기동이 수백 ms라 폴링마다 spawn하지 말고 장수명 pwsh 프로세스 하나를 유지하거나 주기를 길게.
- CPU 사용률은 `os.cpus()` times 델타로 크로스플랫폼 계산 가능 → 플랫폼 공통 코드 우선, 배터리/메모리 압력만 플랫폼별.
- "memory pressure" 개념은 Windows에 직접 대응이 없음 → 커밋 메모리/가용 메모리 비율로 대체하고 UI 문구를 플랫폼별로.

### Gaps

- `systeminformation`의 Windows 성능(내부적으로 PowerShell/WMI 사용 여부)과 함수별 지원 범위는 사이트 첫 페이지에서 확인 불가.

## 8. 패키징·서명·배포

### Takeaway

electron-builder NSIS + Azure Artifact Signing(구 Trusted Signing)이 비용 대비 표준 경로지만 **서명해도 SmartScreen 경고가 사라지지 않는다**(평판은 다운로드 이력으로 쌓임, 2026년 3월 CA 교체 후 경고 재발 보고). 대상국 제한(개인 개발자는 미국·캐나다만)이 한국 개발자에게 결정적 제약일 수 있다. ARM64 Windows 빌드도 사용자가 기대한다.

### Cited Findings

- electron-builder는 `win.sign`에 `type: "azure"` 백엔드 지원, 어떤 OS에서도 동작, 자격 증명은 env(tenant/client id/secret). — [electron-builder Windows code signing](https://www.electron.build/docs/features/code-signing/code-signing-win)
- Electron 문서: Azure Artifact Signing이 가장 저렴하고 SmartScreen 경고를 없앤다고 서술. — [Electron code signing](https://electronjs.org/docs/latest/tutorial/code-signing)
- Microsoft: Artifact Signing은 즉시 SmartScreen 신뢰를 주지 않으며 평판은 시간이 지나며 쌓임(위 Electron 서술과 충돌). 자격: 조직은 미국·캐나다·EU·UK, **개인은 미국·캐나다만**. — [Microsoft code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- 2026-03-26 새 intermediate CA 이후 서명된 릴리스에서 SmartScreen 경고 재발 보고(커뮤니티, MS 미확인). — [Microsoft Q&A 미러](https://dotnet.territoriali.olinfo.it/en-us/answers/questions/5855442/azure-trusted-signing-new-intermediate-cas-causing)
- 일본 개발자 관점 2026 서명/SmartScreen 현실 정리 글 존재(비미국 개발자 참고). — [codenote.net](https://codenote.net/en/posts/windows-desktop-app-code-signing-distribution-japan-2026/)
- 에이전트 매니저 사용자 기대: 서명된 설치 파일(미서명은 SmartScreen 경고), Snapdragon용 ARM64 빌드(x64는 에뮬레이션). — [runpane.com](https://runpane.com/agent-managers-for-windows)

### Inferences

- 한국 개인 개발자라면 Azure Artifact Signing 자격이 안 될 가능성이 높음 → (a) 법인 설립 후 OV/EV 인증서(HSM/클라우드 서명), (b) 초기엔 미서명 + winget/scoop 배포 + README에 SmartScreen 안내, (c) MS Store(MSIX, 스토어가 서명) 중 선택. MSIX는 샌드박스/파일시스템 가상화로 `~/.aquila`, node-pty 자식 프로세스, `%USERPROFILE%\.claude` 접근에 제약이 생길 수 있어(학습 지식) 터미널 앱에는 NSIS가 무난.
- 자동 업데이트: electron-updater + NSIS(GitHub Releases) 조합이 일반적(학습 지식).
- CI: Windows 러너에서 x64·arm64 각각 node-pty 리빌드.

### Gaps

- Squirrel.Windows vs NSIS 최신 권장, EV 인증서의 SmartScreen 즉시 신뢰 정책 변화(2024년 이후 EV도 즉시 신뢰 안 준다는 이야기가 있으나 이번에 1차 출처 확인 못 함).

## 9. 비교 대상 앱들의 크로스플랫폼 현황

### Takeaway

에이전트 전용 앱 중 **Conductor, cmux, Superset(Paradev)은 Windows 미지원**이다. Windows에 빌드가 있는 경쟁자는 Pane, Orca, Emdash, T3 Code 등이며, 그중에서도 WSL 레포를 제대로 다루는 앱은 소수다. 즉 "Windows + WSL을 제대로" 하면 차별점이 된다.

### Cited Findings

- 30개 앱 중 14개가 네이티브 Windows 빌드(Pane, Orca, Herdr, Ghostex, Maestri, Solo, Kandev, T3 Code, Traycer, Paseo, Emdash, Agent Orchestrator, Waku, Reliant). WSL 레포에서 에이전트를 제대로 돌린 것은 6개(Pane, Orca, Herdr, Ghostex, Maestri, Solo). T3 Code WSL 백엔드 크래시 루프, Paseo는 Windows 앱에서 WSL 레포 에이전트 시작 불가. Maestri는 첫 실행에 에이전트 설정에 스킬 28개 설치, Reliant는 PATH 수정 → `~/.claude`, `~/.codex` 백업 권고. (벤더=Pane 작성, Win11 x64 + Ubuntu 24.04 WSL2, 2026-10 테스트) — [runpane.com](https://runpane.com/agent-managers-for-windows)
- Conductor: macOS only, Windows 대기자 명단. Superset: Windows 미지원, Linux 실험적. cmux: 네이티브 macOS 앱(Linux/Windows 현황은 출처 간 불일치). — [cloudroom.dev](https://www.cloudroom.dev/blog/conductor-alternatives), [superset.sh 비교](https://superset.sh/compare/conductor-alternative), [agentastic.dev](https://www.agentastic.dev/alternatives/cmux)
- Codex 데스크톱(OpenAI 자체)도 Windows/WSL 통합에서 다수 버그(1장 참조) — 대형 팀도 WSL 브리징을 어려워함. — [openai/codex#28302](https://github.com/openai/codex/issues/28302)

### Inferences

- Aquila Agents 규칙 6("사용자 CLI 설정 건드리지 않기")은 Windows 사용자 불만(Maestri/Reliant 사례)과 정확히 맞물리는 강점 — 유지하고 마케팅 포인트로.
- VS Code/Windows Terminal/Wave/Tabby/Hyper는 Windows 지원(학습 지식). Hyper는 개발 정체, Warp는 2025년 Windows 출시(학습 지식, 미검증).

### Gaps

- Warp·Wave·Tabby·Hyper의 Windows 사용자 불만은 이번 세션에서 1차 출처 조사 못 함.

---

## 권장 사항 (중요도/노력 순 랭킹) — 위 근거의 종합

| #   | 권장                                                                                                                                                                               | 중요도           | 노력  | 근거                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- | -------------------------------------- |
| 1   | **플랫폼 추상화 레이어**: `electron/platform/{darwin,win32}.ts`에 셸 탐지·spawn 명령 생성·경로·단축키·알림을 모음. `$SHELL -l -i -c` 하드코딩 제거                                 | 필수             | 중    | 3장                                    |
| 2   | **Hook을 `type:"http"`로 전환**(macOS 포함, curl 의존 제거, `onFailure:"continue"`, 짧은 timeout)                                                                                  | 필수             | 하    | 5장                                    |
| 3   | **셸 프로필**: PowerShell 7(WindowsApps 앨리어스 회피) > Windows PowerShell > Git Bash > CMD + WSL 배포판 자동 감지(시작 시 1회), 프로젝트별 실행 환경 저장                        | 필수             | 중    | 1·3장, Codex #18937·#62097             |
| 4   | **node-pty Windows 안정화**: ConPTY 전용, kill 직렬화·이미 종료된 pty kill 금지, conhost 정리, x64/arm64 CI 빌드. xterm `windowsPty` 설정                                          | 필수             | 중    | 2장                                    |
| 5   | **단축키 재매핑**: 앱 단축키는 Ctrl+Shift 계열, Ctrl+C는 선택 시 복사/아니면 SIGINT, Ctrl+V는 pty로(이미지 붙여넣기), Ctrl+Alt 조합 회피                                           | 필수             | 하–중 | 6장                                    |
| 6   | **타이틀바**: Windows에서 `titleBarStyle:'hidden'` + `titleBarOverlay`(토큰 색, `--size-titlebar` 높이), `env(titlebar-area-*)`로 사이드바/탭 배치                                 | 높음             | 하    | 6장                                    |
| 7   | **계정 분리**: spawn env로 `CLAUDE_CONFIG_DIR` 주입(이미 크로스플랫폼). Windows에선 Keychain 이슈 없음 문서화. `$PROFILE` 함수 쓰기는 후순위·확인 필수                             | 높음             | 하    | 4장                                    |
| 8   | **WSL 세션**: `wsl.exe -d <distro> --cd <path> -- bash -lic "claude; exec bash -li"`, `wslpath` 변환, `\\wsl.localhost\` 경로 인식, hook 서버 주소를 WSL 네트워킹 모드에 맞춰 주입 | 높음             | 중–상 | 3·5장, Pane                            |
| 9   | **알림**: `app.setAppUserModelId(appId)`, NSIS 바로가기, 작업표시줄 overlay icon/flashFrame                                                                                        | 중               | 하    | 6장                                    |
| 10  | **패키징**: electron-builder NSIS x64+arm64, electron-updater. 서명 경로 결정(개인=Azure 자격 없음 가능성 → OV/EV 또는 Store)                                                      | 중(배포 시 필수) | 중    | 8장                                    |
| 11  | **IME/폰트/렌더링**: 한글 폰트 폴백(Cascadia Mono, D2Coding), WebGL context loss 폴백, 한글 조합 수동 QA                                                                           | 중               | 하    | 1·6장                                  |
| 12  | **git 패널**: `git.exe` 경로 탐지, CRLF/`core.autocrlf` 차이 표시, WSL 프로젝트는 `wsl.exe -e git`                                                                                 | 중               | 하–중 | 3장(Pane: `\\wsl$`+Windows git은 느림) |
| 13  | **시스템 모니터**: `os.cpus()` 델타 공통화, 배터리/메모리는 장수명 PowerShell CIM, wmic 금지                                                                                       | 낮음             | 중    | 7장                                    |
| 14  | **Trash**: `shell.trashItem` 그대로(휴지통), 문구만 "휴지통/Recycle Bin"                                                                                                           | 낮음             | 하    | 6장(추론)                              |
