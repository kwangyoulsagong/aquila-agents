# 원격 세션 (SSH 개발 서버 / 클라우드 VM / 컨테이너) — Aquila Agents 리서치 노트

> 작성 기준일: 2026-11-19. 출처는 공식 문서 우선, 서드파티 블로그는 명시. 웹 검색 약 18회 + 페치.
> 범례: [공식] = 벤더 공식 문서, [3P] = 서드파티/블로그/이슈 미러.

## 1. 비교 대상 도구들은 원격을 어떻게 처리하나 (사용자 평가 포함)

### Takeaway

업계 표준은 **"로컬 UI + 원격에 버전 고정 헬퍼 바이너리를 SSH로 설치 + 원격 데몬이 세션을 보유 + 끊기면 재접속(reattach)"** 패턴이다(Zed, cmux, Wave, Claude Desktop, VS Code 모두 동일). 사용자 불만은 거의 전부 "슬립/네트워크 끊김 후 세션·터미널 내용 소실"과 "업데이트 후 연결 깨짐"에 집중된다.

### Cited Findings

**Zed (원격 개발)**

- 로컬 Zed가 시스템 `ssh`로 ControlMaster 연결을 만들고, 원격 `~/.zed_server`에 로컬과 **정확히 같은 버전**의 서버 바이너리가 있는지 확인. 없으면 원격이 zed.dev에서 받고, `upload_binary_over_ssh`면 로컬이 받아 SSH로 업로드(원격 인터넷 제한 시) — [공식 Zed docs](https://zed.dev/docs/remote-development)
- 각 연결은 서버를 "proxy mode"로 실행: 데몬이 없으면 띄우고 있으면 재접속 → 끊겼다 다시 붙어도 작업 지속 — [공식 Zed docs](https://zed.dev/docs/remote-development), [Zed 블로그](https://zed.dev/blog/remote-development)
- 프로젝트당 control master 하나를 만들고 Zed 프로토콜·터미널·태스크를 그 위에 멀티플렉싱. `~/.ssh/config` 상속, `-J/-L/-R/-i/-o/-F` 등 허용, `-t/-T`는 Zed가 직접 설정하므로 금지. `port_forwards`로 `-L` 포워딩 — [공식 Zed docs](https://zed.dev/docs/remote-development)
- 비밀번호는 설정에 저장하지 않음, 키 인증 권장. Windows 클라이언트는 그래픽 askpass + `ssh.exe` + ssh-agent 필요. WSL 배포판을 원격 프로젝트처럼 목록에 노출 — [공식 Zed docs](https://zed.dev/docs/remote-development)
- Zed 소스 주석: Windows에서는 ControlMaster/ControlPath 미지원 — [Zed ssh.rs (미러)](https://git.secluded.site/zed/blob/v0.218.x/crates/remote/src/transport/ssh.rs)

**cmux (Aquila와 가장 유사한 macOS 에이전트 터미널)**

- `cmux ssh user@remote` → 호스트 전용 워크스페이스. 첫 접속 시 버전 고정 relay `cmuxd-remote`를 `~/.cmux/bin/cmuxd-remote/<version>/<os>-<arch>/`에 업로드, 앱 내장 SHA-256 매니페스트로 검증, `uname -s/-m`으로 플랫폼 판별. stdio 위 JSON-RPC — [공식 cmux SSH docs](https://cmux.com/docs/ssh.md)
- 원격→로컬 알림: **HMAC-SHA256 인증된 reverse TCP 터널**. 원격 에이전트가 `cmux notify` 실행 → 로컬 사이드바. 불안정한 연결의 알림 폭주를 막는 호스트별 cooldown — [공식 cmux SSH docs](https://cmux.com/docs/ssh.md)
- 재접속: 지수 백오프 3s→6s→12s→최대 60s, relay 데몬이 세션을 유지해 재부착, PTY 크기는 가장 작은 화면 기준. 사용자 설정에 없으면 `ServerAliveInterval=20`, `ServerAliveCountMax=2` 주입 — [공식 cmux SSH docs](https://cmux.com/docs/ssh.md)
- Mosh(1.4+)는 PTY만 운반, 메타데이터·부트스트랩·업로드·재접속은 SSH가 담당. 실패 시 이유 설명 후 SSH로 폴백. `cmux mosh-tmux`/`ssh-tmux` 프로파일로 tmux 세션 생성·부착 — [공식 cmux SSH docs](https://cmux.com/docs/ssh.md)
- 딥링크는 identity file/raw ssh 옵션/ProxyCommand를 넘길 수 없고(→ `~/.ssh/config`에 두라), 접속 대상은 사용자 확인 필수 — [공식 cmux SSH docs](https://cmux.com/docs/ssh.md)
- 사이드바에 연결 상태와 원격의 listening 포트 표시, 브라우저 패인은 원격 경유로 localhost 해석, 파일 드래그 시 scp 업로드 — [cmux 블로그](https://cmux.com/blog/cmux-ssh.md)
- changelog: ssh-tmux 미러가 원격 에이전트의 OSC 777/9 알림을 원격 데몬·tmux 설정 없이 전달 — [cmux changelog (검색 스니펫)](https://cmux.com/docs/changelog/0.64.23)

**Wave Terminal**

- `wsh ssh user@host` → 내부 SSH 구현으로 접속하고 connections.json에 등록. wsh 설치 실패 시 wsh 없이 동작 시도(폴백) — [Wave docs: connections](https://docs.waveterm.dev/connections)
- v0.14 "Durable sessions": 원격에 경량 job manager(Go 프로세스)를 띄워 셸을 연결과 독립적으로 유지, 원격 Unix 소켓 통신, 원격 포트 개방 없음. 끊긴 동안 출력은 원격에 버퍼, 재연결 시 자동 재부착. 셸 상태·실행 중 프로그램·전체 스크롤백·네트워크 전환·Wave 재시작을 견딤 — [Wave docs: durable sessions](https://docs.waveterm.dev/durable-sessions)
- 한계: 원격 SSH 전용(로컬·WSL은 표준), standard↔durable 전환 시 셸 재시작, 서버 재부팅/job manager kill 시 "Lost". UI: 터미널 헤더 방패 아이콘(Standard / Durable Attached / Detached / Awaiting), 상태 Attached·Detached·Awaiting Start·Starting·Ended(Exited/Lost/Failed to Start), 메뉴 "Force Restart Controller" — [Wave docs: durable sessions](https://docs.waveterm.dev/durable-sessions)

**Claude Desktop (Claude Code) SSH 세션**

- 환경 선택지 Local / Remote(Anthropic 클라우드) / SSH. 첫 접속 시 원격에 Claude Code 자동 설치 — [3P 요약](https://dev.to/raxxostudios/claude-code-desktop-is-now-a-full-coding-ide-2jop), [공식 desktop docs](https://code.claude.com/docs/en/desktop)
- 기기의 OpenSSH 클라이언트(7.6+) 사용, `~/.ssh/config` 적용, 비밀번호/OTP는 앱 내 프롬프트. 원격 서버+엔진을 `~/.claude/remote/`(srv/<version>, ccd-cli 최근 3개, run/<id>에 소켓·토큰·로그)에 sudo 없이 설치 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- 엔진은 SSH 끊김·기기 슬립·앱 종료 중에도 계속 실행, 현재 턴을 끝내거나 권한 프롬프트에서 멈춤. 원격 서버가 엔진당 최근 16 MiB 출력 버퍼. 호환 버전이면 재부착, 아니면 호스트 transcript로 엔진 교체. systemd-logind `KillUserProcesses=yes`면 SSH 종료와 함께 엔진 사망 → `KillExcludeUsers` 필요. 30일 미접속 시 정리 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- 원격 요구사항: SFTP 서브시스템(없으면 Changes 패인·미리보기·첨부 비활성), `MaxSessions 1`이면 내장 클라이언트 불가, 포워딩 불필요(ProxyJump 호스트는 TCP 포워딩 허용 필요), POSIX 셸, `git`, noexec 아닌 홈 + 약 1GB. Windows 클라이언트에서 OpenSSH 사용 시 연결당 여러 `ssh` 프로세스 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- 사용자 불만: "Starting session..." 무한 대기, 앱 재시작 후 원격 세션이 복원 안 됨(transcript는 디스크에 있음), 앱 업데이트 후 SSH 연결 깨짐, SSH 세션에 Terminal/Preview 패인 없음(기능 격차) — [이슈 73304](https://claudeissues.com/issue/73304-bug-remote-ssh-desktop-sessions-not-restored-after-app-restart-transcripts-exist), [이슈 61498](https://claudeissues.com/issue/61498-bug-ssh-remote-connection-broken-after-desktop-app-update-to-1-8555-0-worked-in), [이슈 51028](https://claudeissues.com/issue/51028-feature-ssh-sessions-should-have-feature-parity-with-local-sessions-terminal-pre)

**Claude Code Remote Control / 클라우드**

- Remote Control은 로컬에서 도는 세션을 claude.ai/모바일에서 조작. 아웃바운드 HTTPS만 사용, 인바운드 포트 없음. 노트북 슬립·네트워크 끊김 후 자동 재연결. 단 "원격 머신의 터미널에서 claude를 돌린다면 SSH 끊김 후 유지하려면 tmux/screen 안에서 시작하라"고 공식 문서가 명시 — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)
- 대안 표: Dispatch, Remote Control, Channels, Slack, Self-hosted environments(Team/Enterprise, 조직 인프라에서 클라우드 세션), Scheduled tasks — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)
- `/teleport`로 클라우드 세션을 터미널로 가져옴 — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)

**Codex 원격**

- 원격 호스트에서 `codex app-server`(스레드·턴·파일·셸·샌드박스·MCP), 로컬 TUI는 렌더링+JSON-RPC만. CLI: 원격 `codex app-server --listen ws://127.0.0.1:4500` + `ssh -L 4500:...` + 로컬 `codex --remote ws://127.0.0.1:4500 --cd <path>`. Codex App(alpha)은 Settings → Connections에서 `~/.ssh/config`의 구체적 Host 별칭 사용(패턴 Host 무시), 원격에 codex 설치·로그인 필요. 느린 링크에서 128개 아웃바운드 큐 포화로 끊김(이슈 #18203) — [3P 블로그](https://codex.danielvaughan.com/2026/04/17/codex-remote-ssh-app-server-architecture/) (공식: [remote connections](https://developers.openai.com/codex/remote-connections), [app-server](https://developers.openai.com/codex/app-server) — 직접 확인 못함)

**VS Code Remote-SSH (불만 사례)**

- 노트북 네트워크가 끊기면 터미널 내용이 사라짐; 메인테이너는 tmux를 권함 — [vscode-remote-release#1701](https://github.com/microsoft/vscode-remote-release/issues/1701)
- 원격 창이 닫혀도 제한 시간 동안 터미널 세션 유지 후 재부착(v1.51) — [release notes v1_51](https://source-hub.etos-pro.ru/microsoft/vscode-docs/src/commit/cfc56fe64a5a91504dfe99f824a42debaa721c1b/remote-release-notes/v1_51.md); 그래도 슬립 후 손실 보고 지속, 터미널 내용 보존 요청 열려 있음 — [vscode#95183](https://github.com/microsoft/vscode/issues/95183)
- tmux 자동 세션을 설정했는데 재접속 시 잃고, 결국 수동 `tmux attach` — [Julia discourse](https://discourse.julialang.org/t/how-to-enable-and-use-persistent-remote-connection-with-vscode-tmux/76926)
- Remote-SSH 재접속 후 Claude 패널이 빈 화면으로 복원 — [이슈 64756](https://claudeissues.com/issue/64756-vs-code-cursor-claude-panel-restores-blank-after-remote-ssh-reconnect-deserializ)

**Superset**: 로컬·원격·클라우드 워크스페이스 모두 git worktree로 통일한다고 홍보, SSH 세부는 확인 못함 — [Superset vs cmux (벤더)](https://superset.sh/compare/superset-vs-cmux)

### Inferences

- Aquila는 "원격 IDE"가 아니라 "원격 PTY + 상태"만 필요하므로 Zed/cmux/Claude Desktop 같은 무거운 원격 서버 바이너리 없이 **시스템 ssh + 원격 tmux**로 MVP가 가능하다. 헬퍼 바이너리는 나중 단계(알림/git/모니터 통합)로 미룬다.
- 경쟁자들이 공통으로 실패하는 지점(앱 재시작 후 원격 세션 복원, 업데이트 후 버전 불일치)이 Aquila의 차별화 기회다. 헬퍼를 쓰지 않으면 버전 불일치 문제 자체가 없다.

### Gaps

- Warp, JetBrains Gateway, Conductor, Coder/Codespaces/DevPod/Daytona, mosh/Eternal Terminal은 이번 세션 호출 예산 때문에 직접 조사하지 못함(일반 지식상 Coder/Codespaces/DevPod는 결국 SSH 호스트를 노출하므로 "SSH 대상"으로 흡수 가능 — 미검증).
- cmux의 사용자 평가(HN/Reddit)는 찾지 못함.

## 2. 끊김·노트북 슬립에도 세션 유지 (tmux/zellij/dtach, 자동 재접속, xterm.js)

### Takeaway

원격 프로세스를 SSH 연결 수명에서 분리하는 게 핵심이며, 가장 저렴하고 검증된 방법은 **원격 tmux 세션 안에서 claude/codex 실행 + 앱이 끊김 감지 시 백오프로 `tmux attach` 재실행**이다. tmux 컨트롤 모드(-CC)는 강력하지만 파서를 직접 구현해야 하므로 MVP에선 일반 attach가 맞다.

### Cited Findings

- Claude 공식 문서: 원격 머신 터미널에서 claude 실행 시 tmux/screen 안에서 시작해야 SSH 끊김 후 유지 — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)
- 사용자 레시피는 tmux + Tailscale(+ mosh)이 표준. "SSH + tmux는 로밍·네트워크 전환에 여전히 취약" — [3P 가이드 모음](https://agentsroom.dev/blog/keep-a-coding-agent-running-on-a-server-after-ssh-disconnects), [jacktan](https://jacktan.bearblog.dev/remote-claude-code/), [happier guide](https://guides.happier.dev/how-to-keep-claude-code-codex-and-opencode-running-when-your-laptop-sleeps)
- Claude Code 기능 요청 "Native Remote Session Management - Persistent SSH Connections via Tmux" 존재(=CLI 자체는 제공 안 함) — [이슈 13613](https://claudeissues.com/issue/13613-feature-request-native-remote-session-management-persistent-ssh-connections-via)
- 호스트 슬립/웨이크 후 세션이 복구되지 않고 프롬프트를 조용히 삼키는 버그 보고 — [이슈 77880](https://claudeissues.com/issue/77880-bug-session-doesnt-recover-after-host-sleep-wake-silently-swallows-prompts)
- cmux: 백오프 3/6/12/60s, ServerAlive 20s×2, 재부착 시 PTY는 가장 작은 화면 크기 — [cmux SSH docs](https://cmux.com/docs/ssh.md)
- Wave: 원격 job manager가 출력 버퍼링 → 재부착 시 스크롤백 동기화 — [Wave durable sessions](https://docs.waveterm.dev/durable-sessions)
- Claude Desktop: 원격 서버가 엔진당 16 MiB 출력 링버퍼 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- tmux 컨트롤 모드: par-term은 iTerm2 방식대로 기존 PTY에 `tmux -CC`를 써넣고 `%output` 알림 파싱, 입력은 `send-keys`. Termy는 컨트롤 프로토콜 파서+백그라운드 워커+이벤트 배칭, 그리고 "컨트롤 모드 소켓에 수동 attach하지 말라" — [par-term tmux_handler](https://docs.rs/par-term/0.19.0/src/par_term/app/tmux_handler.rs.html), [Termy tmux integration](https://www.mintlify.com/lassejlv/termy/features/tmux-integration). xterm.js 자체에는 tmux 컨트롤 모드 지원이 없음(검색에서 사례 미발견).
- Mosh는 알림(OSC) 미지원으로 보고됨 — [blink discussion (검색 스니펫)](https://github.imc.re/blinksh/blink/discussions/1525)

### Inferences

- 권장 실행 형태(원격 rc 파일 미수정): `ssh -t <host> -- tmux -L aquila new-session -A -s aq-<sessionId> -c <path> '<cmd>'`. `-L aquila`로 **별도 tmux 서버 소켓**을 써서 사용자의 tmux 서버/설정과 격리하고, 필요한 옵션은 사용자 `~/.tmux.conf`를 건드리지 않고 명령줄 `\; set -g ...` 또는 `-f <aquila가 만든 임시 conf>`로 전달한다(원격 `~/.aquila/` 아래 파일 작성은 rc가 아니므로 규칙 위반 아님 — 단 첫 생성 시 고지 권장).
- `new-session -A`는 "있으면 attach, 없으면 생성"이라 재접속 로직이 단일 명령으로 끝난다. 재접속 시 tmux가 화면을 다시 그려 주므로 xterm.js 쪽 스크롤백 손실은 tmux history로 대체(`copy-mode` 의존). tmux의 스크롤백과 xterm.js 스크롤백이 이중화되는 UX 문제(마우스 휠)는 `set -g mouse on` 같은 aquila 전용 서버 옵션으로 완화.
- tmux 미설치 호스트: zellij/screen/dtach/abduco 순으로 탐지, 없으면 "끊기면 세션 종료" 경고 배지와 함께 일반 ssh로 실행(Wave의 Standard vs Durable 구분과 동일한 UX).
- 끊김 감지: ssh 프로세스 종료 코드 255 = 연결 오류(일반 ssh 동작). macOS `powerMonitor` resume 이벤트(Electron)에서 즉시 재접속 시도 + 백오프. 원격 프로세스가 진짜 끝났는지(=tmux 세션 없음)와 연결만 끊겼는지를 `tmux has-session`으로 구분.
- 앱 재시작 후 복원: 세션 레코드에 (host, tmux 소켓명, 세션명)을 저장하면 재시작 후에도 `attach`로 즉시 복원 — Claude Desktop의 "재시작 후 원격 세션 미복원" 불만을 피할 수 있다. tmux가 죽었다면 기존 계획대로 `claude --resume <id>`(원격에서) 폴백.
- 컨트롤 모드(-CC)는 2단계 이후 선택지: 탭/분할을 tmux 윈도우와 1:1 매핑해 네이티브 스크롤백을 얻는 대신 프로토콜 파서·리사이즈·입력 경로를 직접 구현해야 함.

### Gaps

- Eternal Terminal과 mosh의 실제 신뢰도 비교, zellij의 detach/attach CLI 세부는 확인 못함.
- `systemd-logind KillUserProcesses=yes` 환경에서 tmux도 죽는지(Claude Desktop 문서는 엔진에 대해서만 언급) — 아마 동일하나 미검증.

## 3. SSH 너머 상태 전달: 인밴드 OSC vs 역방향 포트 포워딩 훅

### Takeaway

**인밴드(PTY 안의 OSC 시퀀스)가 1순위**다. Claude Code 훅은 `terminalSequence` 필드로 OSC 9/99/777을 Claude가 대신 출력하게 할 수 있고, Codex는 OSC 9(+ 사용자 정보로는 OSC 7501)을 내므로 ssh를 그대로 통과한다. tmux 안에서는 `allow-passthrough on`이 필수. `ssh -R` + HTTP/curl 훅은 더 풍부한 페이로드를 주지만 포트 충돌·보안·연결 관리 비용이 크다.

### Cited Findings

- Claude Code 훅 출력 `terminalSequence`: 훅은 제어 터미널이 없어 `/dev/tty`에 쓸 수 없으므로 시퀀스를 반환하면 Claude Code가 출력. 허용: OSC 0/1/2, OSC 9, OSC 99, OSC 777, BEL. 그 외(OSC 52, OSC 8 등)는 무시. 대화형 세션에서만, async 훅 불가. **tmux는 `set -g allow-passthrough on`(3.3+) 필요** — [공식 hooks docs](https://code.claude.com/docs/en/hooks)
- Claude Code 훅 타입 `http`: 이벤트 JSON을 POST, `headers`에 `allowedEnvVars`로 허용된 변수만 보간, 기본 timeout 600s(UserPromptSubmit 등 30s), 연결 실패는 비차단 오류(`onFailure: "block"` 아니면 진행). 관리자 `allowedHttpHookUrls` 허용목록이 있으면 매칭 URL만 실행 — [공식 hooks docs](https://code.claude.com/docs/en/hooks)
- Notification 매처 값: `permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`, `elicitation_dialog` 등 — [공식 hooks docs](https://code.claude.com/docs/en/hooks)
- tmux 3.3+는 `allow-passthrough` 기본 off, 꺼져 있으면 DCS를 조용히 버림. 패스스루 래핑은 `ESC Ptmux; ESC ESC ]9;msg BEL ESC \` — [3P 정리](https://agentpatterns.ai/tool-engineering/terminal-sequence-hook-notifications/), [이슈 19976](https://claudeissues.com/issue/19976-feature-support-terminal-notifications-when-running-inside-tmux)
- Claude Code v2.1.78부터 tmux 안에서도 알림/프로그레스바가 외부 터미널에 도달(단 allow-passthrough on 필요) — [이슈 35623 (docs)](https://claudeissues.com/issue/35623-docs-missing-tmux-configuration-for-terminal-notifications-iterm2-kitty-ghostty); OSC 9;4 프로그레스는 tmux에서 동작 안 한다는 버그도 있음 — [이슈 57366](https://claudeissues.com/issue/57366-bug-terminalprogressbarenabled-osc-9-4-doesnt-work-inside-tmux)
- Codex: `tui.notifications_method` = auto|osc9|bel, auto는 OSC 9 지원을 감지 못하면 BEL로 폴백. 백그라운드 tmux 창이면 `notification_condition = "always"` 권장 — [Codex commit #10043](https://forge.lthn.ai/core/core-agent-ide/commit/147e7118e0612830e5df6c40c6ad0efd6f85dc67), [3P 블로그](https://codex.danielvaughan.com/2026/04/13/codex-cli-notification-pipeline-osc9-hooks-alerts/)
- cmux는 reverse TCP 터널(HMAC 인증) + 호스트별 cooldown으로 원격 알림 수신 — [cmux SSH docs](https://cmux.com/docs/ssh.md)
- Claude Desktop 문서도 앱 연결이 끊긴 동안의 알림은 원격 `~/.claude/settings.json`의 Notification/Stop/StopFailure 훅으로 하라고 안내(Stop 훅은 출력 없이 exit 0 해야 턴이 계속되지 않음) — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- 사용자 제공 정보(외부 미검증): Codex 0.169가 OSC 7501 상태 시퀀스를 내고, Claude Code 2.1.328이 OSC 7501 지원을 probe함.

### Inferences

- 권장 설계: **상태 파서를 "PTY 출력 스트림 위의 OSC 리스너"로 통일**(xterm.js `parser.registerOscHandler(7501|9|777|99, …)`)하면 로컬·원격 동일 경로. 로컬의 curl→127.0.0.1 훅은 유지하되 원격에서는 쓰지 않는다.
- 원격 Claude 훅 주입: 로컬과 같은 `--settings <json>`을 쓰되, 원격에는 파일이 없으므로 (a) `--settings`가 JSON 문자열을 받는지 확인 후 인라인 전달, 또는 (b) 원격 `~/.aquila/claude-hooks.json`에 기록(사용자 `~/.claude*` 아님 → 규칙 준수). 훅 명령은 `jq` 의존 없이 `printf`로 `{"terminalSequence":"\u001b]777;notify;aquila;<event>\u0007"}`를 출력하는 POSIX sh 한 줄로(원격에 jq/node 보장 없음). 이벤트 종류를 본문에 인코딩해 Aquila가 OSC 777을 가로채 상태(working/needs-input/done)로 매핑하고, 실제 데스크톱 알림은 Aquila가 생성.
- OSC 7501을 Claude가 네이티브로 내기 시작하면 훅 자체가 불필요해질 수 있으므로, Aquila는 7501 probe에 응답(지원 광고)하는 코드를 xterm.js 쪽에 넣는 것이 장기적으로 가장 싸다 — 프로토콜 세부는 이 노트 범위 밖(미검증).
- tmux 경유 시: aquila 전용 tmux 서버(`-L aquila`)에 `set -g allow-passthrough on`을 명령줄로 설정 → 사용자 tmux.conf 무수정. Claude 2.1.78+는 tmux 안에서 자체 DCS 래핑을 하므로 passthrough만 켜면 됨. Codex의 OSC 9/7501을 tmux가 래핑 없이 통과시키는지는 불확실 → 테스트 필요. 대안: tmux `set -g allow-passthrough all` 및 `monitor-bell`/`visual-bell`로 BEL 폴백.
- `ssh -R` 방식의 비용: 원격 포트 충돌(공유 서버에서 다른 사용자도 그 포트에 접근 가능 → 토큰/HMAC 필수), sshd `AllowTcpForwarding no`인 회사 서버에서 실패, 연결 재수립마다 포워딩 재설정, 끊긴 동안의 이벤트 유실. 장점: 페이로드 풍부(session_id, transcript_path, 도구명). → 2단계에서 "있으면 쓰는" 보강 채널로만 고려, `ssh -R /remote/unix.sock:...`(Unix 소켓 포워딩, 파일 권한으로 보호)이 TCP보다 안전.
- mosh를 택하면 OSC가 막히므로(위 blink 보고) 상태는 별도 SSH 채널(폴링 or -R) 필요 → mosh는 후순위.

### Gaps

- OSC 7501의 공식 스펙/문서를 찾지 못함(사용자 관찰에만 의존).
- `claude --settings`가 파일 경로 외 JSON 문자열을 받는지 이번에 확인 못함.

## 4. 원격 git 변경 패널·히스토리 패널·시스템 모니터

### Takeaway

같은 호스트에 대해 **ControlMaster 하나를 띄우고 git/ps/ls를 그 위의 짧은 `ssh host cmd` 호출로 실행**하는 게 가장 단순하다(Zed가 같은 방식). 단 Windows 네이티브 OpenSSH는 ControlMaster 미지원이라 별도 경로가 필요.

### Cited Findings

- Zed: 프로젝트당 control master 하나에 프로토콜·터미널·태스크를 멀티플렉싱. Git auto-fetch는 서버에서 실행 — [Zed docs](https://zed.dev/docs/remote-development)
- Claude Desktop: Changes 패인·미리보기·첨부는 원격 SFTP 서브시스템에 의존, 원격에 `git` 필요, `MaxSessions 1`이면 다중 채널 불가 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- Windows 네이티브 OpenSSH는 ControlMaster/ControlPath 미지원(Win32-OpenSSH 백로그), MSYS2는 원격 명령만 가능, WSL 안의 OpenSSH는 정상 동작, Emacs TRAMP는 Windows에서 연결 공유 기본 off — [Zed ssh.rs](https://git.secluded.site/zed/blob/v0.217.5/crates/remote/src/transport/ssh.rs), [TRAMP 매뉴얼](https://www.gnu.org/software/emacs/manual/html%5Fnode/tramp/Ssh-setup.html), [SO 미러](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/75263443/how-can-i-use-ssh-multiplexing-on-windows)
- Claude Desktop은 transcripts를 원격 `~/.claude/`, `.claude.json`에 둔다(=원격 히스토리는 원격 디스크에 있음) — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)

### Inferences

- 구현: Aquila가 `-o ControlMaster=auto -o ControlPath=~/.aquila/cm/%C -o ControlPersist=10m`를 **명령줄로만** 지정(사용자 ssh config 무수정). git 패널은 기존 로컬 명령을 `ssh host -- git -C <path> status --porcelain=v2 -z` 등으로 감싸는 "executor 추상화"(local | ssh)로 처리. 멀티플렉싱 시 명령당 지연은 RTT 1회 수준, 미사용 시 매번 핸드셰이크(수백 ms~수 초) — 수치는 일반론, 미측정.
- 폴링 주기: 원격은 포커스된 프로젝트만, 2~5초 이상 + 상태 OSC(턴 종료) 이벤트 시 즉시 갱신. 파일 감시(inotify)는 헬퍼 없이는 불가 → 2단계 헬퍼 후보.
- 히스토리 패널: `ssh host -- sh -c 'ls -t ~/.claude/projects/<slug>/*.jsonl | head'` + 필요한 파일만 `tail`/`head`로 읽기(읽기 전용, 규칙 준수). CLAUDE_CONFIG_DIR을 쓴 계정이면 그 경로.
- 시스템 모니터: `cat /proc/loadavg /proc/meminfo` 한 번 호출(Linux), macOS 원격은 `vm_stat; sysctl -n vm.loadavg`. 원격 OS를 `uname`으로 판별해 파서 선택.
- Windows 클라이언트: 멀티플렉싱 불가 → (a) 세션 PTY와 별개로 상시 `ssh host sh` 제어 채널 하나를 열어 stdin으로 명령을 보내고 구분자로 결과를 읽는 "명령 셸 채널", 또는 (b) ssh2(Node 순수 JS SSH 라이브러리)로 한 연결에 여러 채널. (b)는 `~/.ssh/config`·agent·ProxyJump 호환을 직접 구현해야 하는 비용(Claude Desktop도 builtin/system-openssh 둘 다 유지하는 이유로 보임).

### Gaps

- 원격 git 명령 지연의 실측치(RTT별)는 찾지 못함.

## 5. 인증·설정: ~/.ssh/config, agent, 점프 호스트, 원격 CLI 탐지, 계정 분리

### Takeaway

**시스템 `ssh` 바이너리를 쓰고 `~/.ssh/config`의 Host 별칭을 그대로 고르게 하라**(Zed, cmux, Claude Desktop, Codex App 공통). 비밀번호·키는 저장하지 않는다. CLAUDE_CONFIG_DIR 같은 env는 SendEnv/AcceptEnv에 기대지 말고 원격 명령 앞에 `env VAR=… cmd`로 붙인다.

### Cited Findings

- Zed: 시스템 ssh → `~/.ssh/config` 상속, 저장 전 연결 검증, 비밀번호 비저장 — [Zed docs](https://zed.dev/docs/remote-development)
- cmux: `~/.ssh/config`의 별칭·identity·proxy를 읽고, 딥링크는 그런 옵션을 못 넘김 — [cmux SSH docs](https://cmux.com/docs/ssh.md)
- Codex App: `~/.ssh/config`의 **구체적** Host 별칭만, 패턴 Host 무시; 원격에 codex 설치·로그인 필요, 로그인 셸 PATH에 있어야 함 — [3P 블로그](https://codex.danielvaughan.com/2026/04/17/codex-remote-ssh-app-server-architecture/)
- Claude Desktop: 점프 호스트도 허용목록에 있어야 하며 ProxyJump 호스트는 TCP 포워딩 허용 필요; csh/tcsh 로그인 셸 지원 추가(=원격 셸 다양성 문제가 실제로 존재) — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md), [3P 요약](https://dev.to/raxxostudios/claude-code-desktop-is-now-a-full-coding-ide-2jop)
- Claude Desktop SSH: 앱 시작 시 저장된 SSH 설정을 미리 연결(preconnect)해 시작 속도 개선 — [3P 요약](https://dev.to/raxxostudios/claude-code-desktop-is-now-a-full-coding-ide-2jop)
- Remote Control 미로그인 시 `claude remote-control`은 오류로 종료 — 로그인 상태 탐지 단서 — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)

### Inferences

- Host 선택 UI: `~/.ssh/config`(+ Include)를 파싱해 구체적 Host만 나열, 수동 입력(`user@host`)도 허용. 연결 테스트는 `ssh -o BatchMode=yes -o ConnectTimeout=8 host true`; BatchMode 실패면 "대화형 인증 필요" → 해당 세션의 xterm 탭에서 그냥 ssh를 대화형으로 띄워 비밀번호/OTP/호스트키 프롬프트를 사용자가 직접 처리(별도 askpass UI 불필요 — PTY라 공짜).
- 탐지 프로브(한 번의 ssh 호출): `sh -lc 'uname -sm; command -v claude codex tmux zellij git; claude --version; codex --version; echo $SHELL'`. `-l` 로그인 셸이어야 nvm/brew PATH가 잡힌다(원격 rc를 읽기만 하고 수정 안 함). csh 계열 로그인 셸 대비로 명시적으로 `sh -c` 래핑.
- 로그인 여부: Claude는 원격 `~/.claude/.credentials.json`(Linux) 또는 `$CLAUDE_CONFIG_DIR` 존재로 추정, Codex는 `~/.codex/auth.json` 존재로 추정 — 파일명은 일반 지식, 이번에 출처 확인 못함. 미로그인이면 원격 탭에서 `claude`를 실행해 `/login`을 사용자가 수행하도록 안내(설치·로그인 자동화는 하지 않음).
- 계정 분리: `ssh -t host -- env CLAUDE_CONFIG_DIR=~/.claude-work tmux ... claude`. SendEnv/AcceptEnv는 서버 `AcceptEnv` 화이트리스트(배포판 기본은 대개 `LANG LC_*`)에 막히므로 쓰지 않는다(일반 OpenSSH 동작, 이번 세션에 man 페이지 직접 확인은 안 함). tmux 서버가 이미 떠 있으면 새 세션 env가 서버 env를 상속하므로 `new-session -e CLAUDE_CONFIG_DIR=...`(tmux 3.2+)로 세션별 지정이 안전.
- 원격에 설치되어 있지 않을 때: Claude Desktop처럼 자동 설치하지 말고 공식 설치 명령을 보여주고 "원격 탭에서 실행" 버튼만 제공(사용자 확인 원칙).

### Gaps

- 원격 로그인 상태를 비침습적으로 확인하는 공식 명령(`claude auth status` 류)이 있는지 확인 못함.

## 6. 보안

### Takeaway

신뢰 경계는 "사용자가 이미 SSH로 들어갈 수 있는 호스트"이므로 Aquila가 새 비밀을 만들거나 저장하지 않는 한 위험은 작다. 위험 지점은 (1) 역방향 포워딩 리스너, (2) 원격에 자격증명 전달, (3) 호스트 키 자동 수락.

### Cited Findings

- Claude Desktop 3P: 원격 엔진은 조직 추론 자격증명을 프로세스 env에 보유 → 같은 사용자/root가 읽을 수 있음, 짧은 수명 자격증명 권장. 그래서 기본 off + `sshHostAllowlist` — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- 원격 `~`를 작업 폴더로 허용하면 SSH 키·셸 시작 파일이 노출 → 좁은 폴더 권장. 엔진과 셸 명령은 SSH 사용자 권한(sudo 규칙 포함)으로 실행 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- 권한 프롬프트는 원격 엔진이 기다리고 앱에 표시; 앱 연결 끊긴 동안 ask 도구는 최대 10분 대기 후 실패 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- cmux: reverse 터널에 HMAC-SHA256 인증, 딥링크 SSH 대상은 사용자 확인 필수 — [cmux SSH docs](https://cmux.com/docs/ssh.md)
- Codex app-server: 인증 없는 모드는 loopback 전용, 그 외 capability token 또는 HMAC 서명 bearer — [3P 블로그](https://codex.danielvaughan.com/2026/04/17/codex-remote-ssh-app-server-architecture/)
- Remote Control은 아웃바운드 HTTPS만, 인바운드 포트 없음; 연결 중 transcript가 Anthropic 서버에 저장 — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)

### Inferences

- Aquila 원칙: 비밀번호·패스프레이즈·토큰 미저장(키체인도 X), ssh-agent에 위임. `StrictHostKeyChecking`을 절대 끄지 말고, 첫 접속 호스트 키 확인은 PTY 안의 ssh 프롬프트로 사용자가 직접 수락.
- Aquila는 자체 자격증명을 원격에 보내지 않는다(Claude/Codex 로그인은 원격 자체 것) → Claude Desktop 3P의 가장 큰 위험이 구조적으로 없음. 이것을 문서에 명시.
- 권한 프롬프트는 원격 CLI의 TUI가 그대로 PTY로 보여주므로 추가 작업 없음(=“CLI를 임베드한다” 철학의 이점). 단 끊긴 동안 needs-input이 누락되지 않게 재접속 시 화면 재렌더 후 상태 재평가.
- 원격 파일 작성은 `~/.aquila/`(훅 json, tmux conf, ControlPath는 로컬) 한정, 첫 작성 시 1회 고지. `~/.claude*`, `~/.codex`, rc 파일은 읽기만.
- deep link / 프로젝트 import로 SSH 대상을 받을 때는 cmux처럼 확인 대화상자 필수, raw ssh 옵션은 받지 않음(명령 주입 방지). host 문자열은 `-`로 시작 금지·`--` 구분자 사용(ssh 옵션 주입 방지 — 일반 보안 상식).

### Gaps

- 공유 서버에서 `-R` TCP 리스너의 실제 공격 사례 자료는 찾지 않음.

## 7. UX: 사이드바 표시, "실행 위치" 선택, 재연결 상태, 에디터 열기

### Takeaway

경쟁 제품은 **호스트별 그룹/워크스페이스 + 연결 상태 아이콘 + durable 여부 표시**로 수렴한다. Aquila는 기존 상태 점(에이전트 상태)과 **별도의 연결 상태 표시**를 분리해야 혼동이 없다.

### Cited Findings

- cmux: 원격 호스트별 전용 워크스페이스, 사이드바에 연결 상태와 감지된 포트 — [cmux 블로그](https://cmux.com/blog/cmux-ssh.md)
- Wave: 헤더 방패 아이콘으로 Standard/Durable Attached/Detached/Awaiting, 호버 시 "Restart as Durable/Standard" 액션 — [Wave durable sessions](https://docs.waveterm.dev/durable-sessions)
- Claude Desktop: 환경 선택 Local / Remote / SSH (세션 생성 시 선택) — [3P 요약](https://dev.to/raxxostudios/claude-code-desktop-is-now-a-full-coding-ide-2jop); 사용자들은 SSH 연결·원격 세션을 agent view에서 관리하고 싶어함 — [이슈 92637](https://claudeissues.com/issue/92637-feature-manage-ssh-connections-and-remote-sessions-from-agent-view)
- Zed: `zed ssh://host/path` CLI, 원격 터미널에서 `zed` 명령으로 파일 열기는 불가 — [Zed docs](https://zed.dev/docs/remote-development)
- Remote Control 세션 이름 기본값이 호스트명 접두사(`myhost-graceful-unicorn`) — 호스트명이 1차 식별자라는 관례 — [공식 Remote Control docs](https://code.claude.com/docs/en/remote-control)

### Inferences

- 프로젝트 모델: `project.location = { kind: 'local' } | { kind: 'ssh', host: '<ssh-config alias>', path: '/home/u/repo', persist: 'tmux'|'none', claudeConfigDir?: string }`. 프로젝트 생성 시 "실행 위치: 이 Mac / <host>" 세그먼트 컨트롤. 같은 저장소를 로컬과 원격 둘 다 가질 수 있도록 위치는 프로젝트 속성(세션 속성 X).
- 사이드바: 원격 프로젝트 이름 옆 `host` 배지(모노 폰트, 작게) + 호스트 연결 점(연결됨 / 재연결 중(펄스) / 오프라인(회색) / 인증 필요(경고)). 에이전트 상태 점은 그대로 두되 연결이 끊기면 "마지막 알려진 상태 + 흐림" 처리. 호스트 그룹 헤더(같은 호스트의 프로젝트 묶기)는 2단계.
- 세션 탭/패널: 끊김 시 xterm 위에 얇은 배너 "연결 끊김 · 3초 후 재연결 · 지금 재연결", durable(tmux)이면 "세션은 서버에서 계속 실행 중" 문구로 안심시키기(Wave의 Detached 개념). tmux 없으면 "끊기면 종료됨" 경고 배지.
- 지연 표시: ControlMaster 위 `ssh host true` 왕복 시간을 30초마다 측정해 호버 툴팁에 ms 표시(상시 숫자 노출은 노이즈).
- 에디터 열기: VS Code `code --remote ssh-remote+<host> <path>`, Cursor 동일 형식(`cursor --remote ...`), Zed `zed ssh://<host>/<path>`, 그 외는 경로 복사. (VS Code/Cursor 플래그는 일반 지식, 이번 세션에서 공식 문서 재확인 못함.)
- i18n 예시: "이 Mac" / "This Mac", "재연결 중…" / "Reconnecting…", "서버에서 계속 실행 중" / "Still running on server".

### Gaps

- Warp/JetBrains의 원격 UX 비교는 조사 못함.

## 8. Windows 참고

### Takeaway

Windows 10/11 기본 OpenSSH 클라이언트로 PTY는 문제없지만 **ControlMaster가 안 되므로** 보조 명령(git/ps) 경로를 따로 설계해야 하고, WSL은 "원격 같은 로컬 대상"(`wsl.exe -d <distro> --cd <path> -- cmd`)으로 같은 executor 추상화에 넣으면 된다.

### Cited Findings

- 네이티브 Win32-OpenSSH는 ControlMaster/ControlPath 미지원(백로그), WSL 내부 OpenSSH는 멀티플렉싱 정상 — [Zed ssh.rs](https://git.secluded.site/zed/blob/v0.218.x/crates/remote/src/transport/ssh.rs), [SO 미러](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/75263443/how-can-i-use-ssh-multiplexing-on-windows)
- Zed는 Windows에서 그래픽 askpass, ssh-agent·`ssh.exe` PATH 필요, WSL 배포판을 원격 프로젝트처럼 목록화; JumpHost on Windows 버그 수정 이력 — [Zed docs](https://zed.dev/docs/remote-development), [Zed commit #40713](https://git.secluded.site/zed/commit/14b41b122f38c76374b5285ea2bd4c649544642b)
- Claude Desktop: Windows 클라이언트는 OpenSSH 사용 시 연결당 여러 ssh 프로세스 → 원격 per-user 로그인 제한 주의; Store 설치는 내장 클라이언트 기본 — [공식 3P SSH docs](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md)
- Wave durable sessions는 WSL 미적용(원격 SSH 전용) — [Wave durable sessions](https://docs.waveterm.dev/durable-sessions)
- Codex: WSL2 토스트 수정 커밋 존재(WSL 사용이 흔함) — [Codex commit #7137](https://forge.lthn.ai/core/core-agent-ide/commit/36610d975a3e92252178f5e1cb3adab60c593d4e)

### Inferences

- WSL 대상은 연결 끊김 개념이 없으므로 tmux 불필요, 훅은 WSL→Windows localhost 포워딩(WSL2 mirrored networking)으로 기존 curl 방식도 가능하지만 OSC 경로로 통일이 간단.
- Windows에서 node-pty(ConPTY) 위 `ssh.exe`는 OSC를 그대로 전달하는 것으로 기대되나 ConPTY의 시퀀스 필터링 여부는 테스트 필요(미검증).

### Gaps

- Win32-OpenSSH ControlMaster 백로그 이슈의 2026년 현재 상태 미확인.

---

## 권장안 (중요도 × 노력 순위) — 위 Cited Findings 기반 종합

| 순위 | 항목                                                                                                | 중요도              | 노력  | 근거                                                         |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------- | ----- | ------------------------------------------------------------ |
| 1    | `project.location` 모델(local / ssh alias+path) + 시스템 `ssh -t` PTY 실행                          | 최상                | 소    | Zed/cmux/Claude Desktop 모두 시스템 ssh + ~/.ssh/config      |
| 2    | 원격 tmux(`-L aquila`, `new-session -A`)로 세션 유지 + 끊김 감지·백오프 재부착 + 앱 재시작 후 복원  | 최상                | 소~중 | 공식 문서의 tmux 권고, cmux 백오프, Claude Desktop 복원 불만 |
| 3    | 인밴드 상태: xterm.js OSC 핸들러(7501/9/777/99) 통일 + 원격 Claude 훅을 `terminalSequence` 출력으로 | 최상                | 중    | Claude hooks `terminalSequence`, Codex OSC 9                 |
| 4    | 연결 프로브(uname, claude/codex/tmux/git 존재·버전) + 미설치·미로그인 안내(자동 설치 X)             | 상                  | 소    | Codex App 요구사항, Claude Desktop 요구사항                  |
| 5    | 사이드바 호스트 배지 + 연결 상태 점 + 끊김 배너                                                     | 상                  | 소    | Wave/cmux UI                                                 |
| 6    | ControlMaster(명령줄 옵션) 기반 원격 git 패널/히스토리/모니터                                       | 중                  | 중    | Zed 멀티플렉싱, Claude Desktop Changes 패인                  |
| 7    | CLAUDE_CONFIG_DIR를 `env`/`tmux -e`로 원격 전달                                                     | 중                  | 소    | AcceptEnv 제약(일반 지식)                                    |
| 8    | "에디터에서 열기" 원격 경로 지원(VS Code/Cursor/Zed)                                                | 중                  | 소    | Zed `ssh://`                                                 |
| 9    | 원격 `claude --resume`/히스토리 기반 복원(tmux 죽은 경우)                                           | 중                  | 중    | Claude Desktop transcript 기반 교체                          |
| 10   | Windows: 멀티플렉싱 대체 제어 채널, WSL 대상                                                        | 중(Windows 출시 시) | 중    | Win32-OpenSSH 제약                                           |
| 11   | 보강 채널 `ssh -R`(Unix 소켓, 토큰) 리치 이벤트 / 원격 헬퍼 바이너리(inotify, 포트 감지)            | 하                  | 대    | cmux relay, Zed server                                       |
| 12   | mosh 전송, tmux 컨트롤 모드(-CC), 컨테이너(devcontainer exec) 대상                                  | 하                  | 대    | cmux mosh(알림은 SSH), par-term -CC                          |

### MVP (v1)

1. 프로젝트 추가 시 "실행 위치: 이 Mac / SSH 호스트"(`~/.ssh/config` 구체적 Host 목록 + 수동 입력) + 원격 경로.
2. 연결 테스트·프로브 1회(BatchMode → 실패 시 대화형은 PTY에서 사용자 처리). claude/codex/tmux/git 유무 표시.
3. 세션 실행: `ssh -t -o ServerAliveInterval=20 -o ServerAliveCountMax=2 -o ControlMaster=auto -o ControlPath=<로컬 ~/.aquila/cm/%C> -o ControlPersist=10m <host> -- tmux -L aquila new-session -A -s aq-<id> -c <path> -e CLAUDE_CONFIG_DIR=… '<cmd>'` (tmux 없으면 경고 후 plain).
4. 상태: Claude는 원격 `~/.aquila/claude-hooks.json`(또는 인라인 `--settings`)의 sh 훅이 `terminalSequence`로 OSC 777 출력; Codex는 OSC 9/7501; aquila tmux 서버에 `allow-passthrough on`. 실패 시 기존 출력-활동 휴리스틱.
5. 재접속: ssh 종료코드 255 / `powerMonitor` resume → 백오프 3·6·12·…60s로 같은 명령 재실행(=attach). 앱 재시작 시 저장된 원격 세션 자동 attach.
6. UI: 원격 배지·연결 점·끊김 배너. git 패널/히스토리/모니터는 원격 프로젝트에서 "곧 지원" 비활성(혹은 6번을 v1.1로).

### 이후 단계

- v1.1: executor 추상화로 git 패널·히스토리·모니터 원격화(ControlMaster), 원격 "에디터에서 열기", 지연 툴팁.
- v1.2: 호스트 그룹 사이드바, 원격 worktree 생성, `claude --resume` 폴백 복원, Windows(제어 채널 + WSL 대상).
- v2: 선택적 헬퍼 바이너리(버전 고정·SHA-256 검증, `~/.aquila/bin/`) — 파일 감시·포트 감지·풍부한 이벤트; `ssh -R` Unix 소켓 보강 채널; mosh; devcontainer/Coder/Codespaces를 "SSH 호스트"로 흡수.
