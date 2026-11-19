# AI 코딩 에이전트 트렌드 (2025 – 2026년 11월): 하네스, 서브에이전트, 멀티에이전트, ADE, 그리고 Aquila Agents "새 소식" 버튼

> 조사 시점: 2026-11-19. 출처의 상당수는 서드파티 블로그이며, 공식 출처(Claude Code CHANGELOG, GitHub Releases API, 공식 블로그/RSS)는 직접 curl로 확인함. 추측은 **[추측]**으로 표시.

## 1. 하네스(harness) 개념 — 무엇이고 어디로 가는가

### Takeaway

"에이전트 하네스" = 모델을 감싸 에이전트로 만드는 런타임 계층(에이전트 루프 + 도구 인터페이스 + 컨텍스트 관리 + 제어/권한). 2026년에는 hooks, skills/plugins, MCP, 백그라운드/클라우드 실행, 샌드박스가 표준 구성요소가 되었고, Claude Code·Codex 모두 이 축으로 매주 여러 번 릴리스함. Aquila Agents처럼 "진짜 CLI를 임베드"하는 앱은 하네스를 재구현하지 않고 하네스가 내보내는 신호(hooks, 터미널 시퀀스)를 소비하는 위치에 있음.

### Cited Findings

- 학술적 정의: 하네스는 하나 이상의 LLM을 감싸 에이전트로 만드는 런타임 계층이며 4요소(에이전트 루프, 도구 인터페이스, 컨텍스트 관리, 제어 메커니즘)로 구성; 평가 하네스(evaluation harness)와는 다름 — [arXiv 2606.10106](https://arxiv.org/pdf/2606.10106), [arXiv 2605.13357](https://arxiv.org/pdf/2605.13357)
- 업계 정의: "모델을 제외한 모든 것"(도구 실행, 메모리, 상태). 프레임워크(LangGraph, CrewAI)는 하네스를 만드는 툴킷이고 하네스는 조립된 런타임 — [Firecrawl](https://www.firecrawl.dev/blog/what-is-an-agent-harness), [Thoughtworks](https://www.thoughtworks.com/en-us/insights/blog/machine-learning-and-ai/ai-agent-harness), [Parallel](https://parallel.ai/articles/what-is-an-agent-harness)
- 컨텍스트 엔지니어링은 하네스의 한 구성요소(무엇을 언제 컨텍스트 창에 넣을지); "harness engineering"은 접근 권한, 검증, 재시도 강제까지 포함하는 더 넓은 개념 — [Addy Osmani, Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/), [Fiddler](https://www.fiddler.ai/blog/what-is-an-agent-harness)
- Claude Code hooks 이벤트는 2026-11 기준 30개 이상: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse(+Failure, PostToolBatch), Notification, MessageDisplay, SubagentStart/SubagentStop, TaskCreated/TaskCompleted, Stop/StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, FileChanged, WorktreeCreate/Remove, PreCompact/PostCompact, Pre/PostModelSwitch, Elicitation, SessionEnd 등 — [Claude Code Hooks docs](https://code.claude.com/docs/en/hooks)
- 훅 핸들러 타입 5종: `command`, `http`(이벤트 JSON을 URL로 POST), `mcp_tool`, `prompt`, `agent`(실험적). `command`에 `"async": true` 가능, `asyncRewake` 존재. HTTP 훅 `onFailure: "block"`은 v2.1.295+ — [Claude Code Hooks docs](https://code.claude.com/docs/en/hooks)
- Codex CLI도 훅 체계 보유: `~/.codex/hooks.json`/`<repo>/.codex/hooks.json`, v0.124(2026-04)에 stable 및 config.toml 인라인 설정, 2026-05-14 GA 주장, v0.148(2026-08)에 async 훅·MCP tool 훅. 이벤트: PreToolUse, PostToolUse, PermissionRequest, UserPromptSubmit, Stop, SubagentStart, SubagentStop, PreCompact, PostCompact, SessionStart, SessionEnd — [OpenAI Codex hooks docs](https://developers.openai.com/codex/hooks), [Daniel Vaughan v0.124](https://codex.danielvaughan.com/2026/04/23/codex-cli-hooks-graduate-stable-v0124-mcp-observation-inline-config/), [v0.148](https://codex.danielvaughan.com/2026/08/25/codex-cli-v0148-async-hooks-mcp-tool-hooks-background-execution-mcp-integration/) (서드파티 블로그; 버전별 세부는 공식 문서 대조 필요)
- 클라우드/샌드박스 하네스: OpenAI가 2026-11-18 "Inside the Codex sandbox" 게시 — [OpenAI News RSS](https://openai.com/news/rss.xml). Warp Oz(2026-02)는 재현 가능한 Docker 환경에서 자율 실행되는 클라우드 에이전트 — [Warp newsroom](https://www.warp.dev/newsroom/2026/4/28/warp-open-sources-its-agentic-development-environment)
- Claude Code 2.1.328(2026-11-19) 변경 중 "Claude Code를 임베드하는 앱(apps that embed Claude Code)"용 옵션 추가(`allowManagedModsOnly`), `CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME`(호스트가 훅으로 지연된 도구 호출 재실행을 막음) — 임베드 호스트가 공식적으로 고려되는 사용 형태가 됨 — [Claude Code CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), [GitHub Releases API](https://api.github.com/repos/anthropics/claude-code/releases)
- Cursor도 2026-10-20 "Agent SDK" 출시(하네스를 SDK로 노출하는 흐름이 Anthropic·OpenAI·Google·Cursor로 확산) — [Cursor changelog RSS](https://cursor.com/changelog/rss.xml); Antigravity 2.0도 CLI·SDK 동반 출시(2026-05-19) — [Antigravity blog](https://antigravity.google/blog/introducing-google-antigravity-2/)

### Inferences

- 하네스 경쟁의 축은 "모델"보다 "제어면(control plane)": hooks, 권한 모드(auto mode), 백그라운드 슈퍼바이저, 원격 제어. Aquila Agents의 차별점은 여러 하네스(Claude/Codex)를 **같은 화면에서 같은 신호 체계로** 보여주는 것.
- Claude Code와 Codex의 훅 이벤트 이름이 거의 수렴(SessionStart/Stop/SubagentStart/SubagentStop/PreCompact)했으므로, Aquila Agents 상태 모델을 두 CLI 공통 이벤트로 추상화할 수 있음.

### Gaps

- OpenHands, Goose, opencode, Aider, Cline/Roo, Amp의 2026년 최신 상태는 이번 조사(툴 호출 한도)에서 직접 확인하지 못함.
- Codex에 Claude의 `--settings`처럼 세션 단위로 훅을 주입하는 방법(`-c` 오버라이드로 인라인 hooks 지정 가능 여부)은 공식 문서로 확인 못함 — Aquila Agents 규칙 6(사용자 `~/.codex` 미변경)과 직결되므로 구현 전 확인 필요.

## 2. 서브에이전트 & 멀티에이전트 — 무엇이 작동하고, 호스트 앱이 관찰할 수 있는 신호

### Takeaway

Claude Code: 서브에이전트(세션 내부, 결과를 부모에 보고, 저비용) → 에이전트 팀(2026-02-05 v2.1.32 research preview, 독립 세션들이 작업 목록·메시지 공유, 고비용) → agent view(`claude agents`, 2026-05-11 v2.1.139, 백그라운드 세션 대시보드). Codex: 서브에이전트 GA 2026-03-16, multi-agent v2(서브에이전트별 모델/프로바이더) 2026-06. 호스트 앱은 `SubagentStart`/`SubagentStop`(agent_id, agent_type, last_assistant_message), `TeammateIdle`, `TaskCreated/Completed`, `Notification(agent_completed)` 훅과 OSC 7501/OSC 9;4 터미널 시퀀스로 "서브에이전트 생성/종료"를 UI에 표시할 수 있음.

### Cited Findings

**Claude Code 타임라인 (CHANGELOG + GitHub Releases 날짜로 확인)**

- v2.1.32 (2026-02-05): "research preview agent teams feature … (token-intensive feature, requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)" — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), [release v2.1.32](https://api.github.com/repos/anthropics/claude-code/releases/tags/v2.1.32)
- v2.1.139 (2026-05-11): agent view(Research Preview) 추가 — "running, blocked on you, or done" 세션 단일 목록, `claude agents` — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), [agent view docs](https://code.claude.com/docs/en/agent-view)
- v2.1.178 (2026-06-15): TeamCreate/TeamDelete 도구 제거, 실험 플래그 시 세션마다 암묵적 팀 1개, Agent 도구의 `name` 파라미터로 팀원 스폰 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- 2026-11 기준 공식 문서도 agent teams를 여전히 실험적/기본 비활성으로 기술 — [Run agents in parallel docs](https://code.claude.com/docs/en/agents), [Substack 분석](https://joseparreogarcia.substack.com/p/claude-code-agent-teams)
- v2.1.326~328 (2026-11-16~19): 서브에이전트 관련 수정이 릴리스당 10개 이상 — 20개 이상 서브에이전트 동시 실행 시 CPU 개선, 서브에이전트 진행 요약을 소형 모델로 작성해 토큰 절감, 원격 제어(휴대폰)에서 백그라운드 서브에이전트 실행 중 상태 표시 수정, 워크트리 격리 서브에이전트의 위험 git 명령 차단 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- 서드파티 주장: 서브에이전트 최대 5단계 중첩 — 공식 확인 불가 — [cooconsbit](https://tools.cooconsbit.com/en/articles/claude-code-2026-new-features-en)

**Codex**

- 2026-03-16 OpenAI Devs: "Subagents are now available in Codex" (앱+CLI), 수 주간 feature flag 프리뷰 후 GA — [X/OpenAIDevs](https://x.com/OpenAIDevs/status/2033636701848174967), [Simon Willison](https://simonwillison.net/2026/Mar/16/codex-subagents/)
- CLI 0.137.0(2026-06-04 주장) "multi-agent v2": 서브에이전트별 모델/프로바이더 — [TheRouter.ai](https://therouter.ai/news/openai-codex-multi-agent-v2-per-thread-runtime-routing/) (벤더 블로그)
- 2026-07-09 Codex가 ChatGPT 데스크톱 앱(macOS/Windows)에 통합, 서브에이전트 기본 활성 — [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents) (서드파티)
- Codex 릴리스 현황: 2026-11-18 rust-v0.170.0, 같은 날 0.172.0-alpha — [GitHub Releases API](https://api.github.com/repos/openai/codex/releases)

**토큰/비용 — 사용자 보고**

- 백그라운드 세션도 구독 쿼터를 동일하게 소모 → 병렬 10개면 약 10배 빠르게 소진; Pro 5시간 창은 병렬 5개로 1시간 내 소진 가능; Anthropic 평균 약 $13/개발자/활성일; Opus 오케스트레이터+Sonnet 워커 4개가 Opus 5개보다 약 40% 저렴; 유휴 세션도 쿼터 소모하므로 끝나면 정지 권장 (2026-05-18 기사) — [CloudZero](https://www.cloudzero.com/blog/claude-code-agents/)
- 권장 패턴: 집중적·순차적·비용 민감 작업은 서브에이전트, 진짜 독립적이면서 조율이 필요한 작업만 에이전트 팀 — [Hatchworks](https://hatchworks.com/blog/claude/claude-sub-agents-and-agent-teams/), [Munder Difflin](https://munderdiffl.in/blog/claude-code-subagents-vs-multi-agent-harness/)
- Cursor 3 병렬 에이전트도 "3개 병렬 = 토큰 3배" 지적 — [the-decoder](https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/)
- 병목은 코드 리뷰로 이동(하버드 연구, HN 319pts, 2026-11-17) — [ComplexDiscovery via HN](https://complexdiscovery.com/harvard-researchers-find-ai-coding-agents-shifted-the-bottleneck-to-code-review/)

**호스트 앱이 관찰 가능한 신호 (Aquila Agents 구현 관련)**

- `SubagentStart`/`SubagentStop`: matcher = agent type(`Explore`, `Plan`, `general-purpose`, 커스텀, `plugin:name`). 입력에 `agent_id`, `agent_type` 포함; `SubagentStop`은 `last_assistant_message`(서브에이전트 최종 텍스트) 포함. 서브에이전트 내부 도구 이벤트에도 이 필드가 붙음 → 어떤 도구 호출이 어느 서브에이전트 것인지 구분 가능 — [Hooks docs](https://code.claude.com/docs/en/hooks)
- `TeammateIdle`, `TaskCreated`, `TaskCompleted`: 에이전트 팀/작업 목록 상태 — [Hooks docs](https://code.claude.com/docs/en/hooks)
- `Notification` matcher: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `agent_completed` — [Hooks docs](https://code.claude.com/docs/en/hooks)
- `http` 훅 타입: 이벤트 JSON을 로컬 URL로 POST 가능(예: `http://localhost:8080/...`) → Aquila Agents 메인 프로세스가 로컬 HTTP 서버로 직접 수신 가능(현재 command 훅 방식의 대안) — [Hooks docs](https://code.claude.com/docs/en/hooks)
- **OSC 7501 Program Status Protocol**: 프로그램이 터미널에 idle/working/waiting-on-user/done/failed 상태와 사유를 key=value 이스케이프 시퀀스로 보고. Ghostty의 Mitchell Hashimoto가 제안(2026-10, rev 0.4 2026-10-10 — 날짜 출처 간 불일치). 미지원 터미널은 무시 — [control-codes spec](https://control-codes.page/proposals/osc-7501/), [DEV](https://dev.to/roidayan/osc-7501-your-coding-agent-can-now-tell-your-terminal-it-needs-you-29a), [areweosc7501yet](https://areweosc7501yet.com/)
- Claude Code v2.1.295(2026-10-08)에 OSC 7501 지원 추가: "terminals that implement it can show whether Claude Code is working, waiting on you, or done"; v2.1.326에서 백그라운드 명령/모니터/MCP 작업 목록 포함, 폴더 신뢰 프롬프트 시 waiting 표시 수정 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), [release v2.1.295](https://api.github.com/repos/anthropics/claude-code/releases/tags/v2.1.295)
- OSC 9;4 터미널 진행 표시(v2.0.56 설정 추가, v2.1.128 깜빡임 수정)와 터미널 타이틀 스피너도 존재 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- Notification 훅은 `terminalSequence`로 OSC 777 데스크톱 알림을 내보낼 수 있음 — [Hooks docs](https://code.claude.com/docs/en/hooks)

### Inferences

- **Aquila Agents 최우선 기회**: xterm.js 파서에 OSC 7501 핸들러(`parser.registerOscHandler(7501, ...)`)를 달면 훅 주입 없이 Claude Code 상태(working/waiting/done)를 얻을 수 있음 — 사용자의 CLI 설정을 건드리지 않는다는 규칙 6과 잘 맞음. 기존 hooks 방식은 서브에이전트 세부(agent_type, last message)용으로 병행. **[추측]** Codex도 OSC 7501을 채택할지는 미확인.
- UI 아이디어: 세션 탭 상태 점 옆에 "서브에이전트 n개 실행 중" 배지(SubagentStart/Stop 카운트), 서브에이전트 종료 시 `last_assistant_message` 첫 줄을 토스트로. 에이전트 팀은 실험 기능이라 2순위.
- 비용 신호(병렬 = 쿼터 n배)는 Aquila Agents가 "동시 실행 세션 수"를 상단에 보여주는 근거가 됨.

### Gaps

- SubagentStart의 전체 페이로드 스키마(부모 session_id 외 필드)는 문서 일부만 읽어 확인 못함(문서 294k자 중 100k자만 읽음).
- Codex SubagentStart/Stop 페이로드 필드는 공식 문서로 미확인.

## 3. ADE 및 신제품 — 각자 무엇을 혁신했나 (날짜 포함)

### Takeaway

2026년은 "에이전트 우선 창(agent-first window)"이 모든 진영의 기본 UX가 된 해: Claude Code 데스크톱 재설계(2026-04-14), Cursor 3 Agents Window(2026-04-02), Warp ADE 오픈소스(2026-04-28), Antigravity 2.0 독립 앱(2026-05-19), JetBrains Air(2026-03 프리뷰). 공통 패턴은 세션 사이드바 + 상태 필터 + 워크트리 격리 + diff 리뷰 + 로컬/클라우드/원격 실행. Aquila Agents가 하는 일(여러 세션·프로젝트 한 창, 상태 점)이 이제 1st-party 제품의 핵심 기능과 정면으로 겹침.

### Cited Findings

| 제품                         | 날짜                                                                 | UX 혁신                                                                                                                                                                                                  | 출처                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warp (ADE 포지셔닝)          | 2025-06 "첫 ADE" 표방; Oz 2026-02; 오픈소스 2026-04-28               | 터미널→ADE, Oz 클라우드 에이전트가 이슈 triage→계획→코드→PR, 모드: 순수 터미널 / 최소 에이전트(diff+파일트리) / 풀 ADE; OpenAI 스폰서; 약 100만 개발자 주장                                              | [Warp newsroom](https://www.warp.dev/newsroom/2026/4/28/warp-open-sources-its-agentic-development-environment), [OpenChamber](https://openchamber.dev/blog/agentic-development-environment/)                                                                   |
| Cursor 3                     | 2026-04-02                                                           | Composer 대신 전체화면 Agents Window, 로컬/워크트리/클라우드/원격 SSH에서 병렬 에이전트, 데스크톱·모바일·웹·Slack·GitHub·Linear에서 시작; 이후 Agent SDK(2026-10-20), Voice Chat with Agents(2026-11-06) | [Cursor changelog 3.0](https://cursor.com/changelog/3-0), [the-decoder](https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/), [Cursor RSS](https://cursor.com/changelog/rss.xml) |
| Claude Code 데스크톱 재설계  | 2026-04-14 (Routines와 함께)                                         | 모든 활성/최근 세션 사이드바, 상태·프로젝트·환경별 필터, 프로젝트별 그룹, 터미널·에디터·diff·프리뷰 드래그 배치, CLI 플러그인 동등성, Mac SSH                                                            | [MacRumors](https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/), [Thurrott](https://www.thurrott.com/a-i/anthropic/334911/anthropic-redesigns-claude-app-on-desktop-for-parallel-agents)                                         |
| Claude Code agent view (CLI) | 2026-05-11                                                           | 터미널 대시보드, 슈퍼바이저 프로세스로 터미널 닫아도 계속 실행                                                                                                                                           | [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), [CloudZero](https://www.cloudzero.com/blog/claude-code-agents/)                                                                                                       |
| Codex app                    | macOS 출시(날짜 미확인) → Windows → 2026-07-09 ChatGPT 데스크톱 통합 | 여러 에이전트 동시 관리, 장시간 작업 협업                                                                                                                                                                | [OpenAI](https://openai.com/index/introducing-the-codex-app/), [IntuitionLabs](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)                                                                                                            |
| Google Antigravity 2.0       | 2026-05-19 (I/O)                                                     | Agent Manager를 에디터 없는 독립 데스크톱 앱으로 분리, CLI+SDK, mac/Linux/Win; IDE 내 Agent Manager는 추후 제거 예정. 2026-11: "/swarm"(11-10), "Orchestrator"(11-12), Voice mode                        | [Antigravity blog](https://antigravity.google/blog/introducing-google-antigravity-2/), [Antigravity RSS](https://antigravity.google/blog/rss.xml), [Wikipedia](https://en.wikipedia.org/wiki/Google_Antigravity)                                               |
| JetBrains Air                | 2026-03 macOS 무료 프리뷰, 2026-06 Windows, 2026-10-01 IDE 내 EAP    | 멀티에이전트 실행기(Codex, Claude Agent, Gemini CLI, Junie 등 지원)                                                                                                                                      | [InfoWorld](https://www.infoworld.com/article/4206868/a-brief-guide-to-ai-powered-software-development-environments.html), [Medium](https://medium.com/vibecodingpub/jetbrains-air-the-future-of-multi-agent-coding-or-just-more-ai-noise-5450e648a962)        |
| Amazon Kiro                  | GA 2026-04(단일 2차 출처)                                            | spec-driven 개발                                                                                                                                                                                         | [agentastic](https://www.agentastic.dev/compare/best-agentic-ide)                                                                                                                                                                                              |
| Conductor (Melty Labs)       | —                                                                    | Mac 앱, Claude Code·Codex, 워크스페이스별 워크트리 자동, diff 리뷰 UI, 비공개 소스·무료                                                                                                                  | [dev.to 비교](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8), [ai-deck](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)                                                                                    |
| Superset                     | —                                                                    | 기존 repo 그대로 쓰는 IDE형 오케스트레이터, Free/Pro $20/Team $60; "Paradev"로 개명 가능성                                                                                                               | [ai-deck](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/), [superset.sh](https://superset.sh/compare/manage-multiple-coding-agent-sessions)                                                                                                           |
| cmux                         | —                                                                    | macOS 터미널, 워크트리 자동화 없음("직접 구성파")                                                                                                                                                        | [ai-deck](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)                                                                                                                                                                                             |
| Vibe Kanban                  | —                                                                    | 칸반 보드형, Apache-2.0, 기본적으로 `--dangerously-skip-permissions`/`--yolo`로 실행(주의)                                                                                                               | [dev.to 비교](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8)                                                                                                                                                        |
| ADE (ade-app.dev)            | 2026 출시                                                            | AGPL 오픈소스, 코딩 에이전트 동기화                                                                                                                                                                      | [Product Hunt](https://www.producthunt.com/products/ade-agentic-development-environment)                                                                                                                                                                       |

- 2026년 ADE는 주로 "Claude Code나 Codex 같은 에이전트 함대를 실행하는 곳"이라는 의미로 쓰임; 범주 기원은 출처마다 2025/2026로 엇갈림 — [OpenChamber](https://openchamber.dev/blog/agentic-development-environment/), [Augment](https://www.augmentcode.com/guides/what-is-an-agentic-development-environment)

### Inferences

- Aquila Agents는 Conductor/cmux/Superset과 같은 "서드파티 멀티-CLI 셸" 범주. 1st-party(Claude Desktop, Codex app)가 단일 벤더인 반면, Aquila Agents의 방어선은 (1) Claude+Codex+shell을 한 창에서, (2) 진짜 CLI 그대로(설정·플러그인·슬래시 명령 100% 호환), (3) 가벼움.
- 1st-party 앱이 갖췄지만 Aquila Agents에 없는 것으로 보이는 것: 상태별 필터, 워크트리 격리, diff 리뷰 패널, 원격/모바일 확인. 이 중 상태별 필터와 "나를 기다리는 세션" 인박스가 가장 싸게 구현 가능 **[추측: 우선순위 판단]**.

### Gaps

- Windsurf, Zed, Devin, Factory, Sculptor의 2026년 신규 UX/날짜는 이번 조사에서 확인 못함.
- Codex app macOS 최초 출시일, Conductor/Superset/cmux 출시일은 미확인.

## 4. 2026년 방향 — 비동기/백그라운드, 모바일, 리뷰 우선, 에이전트 인박스, spec-driven

### Takeaway

확인된 흐름: (a) 백그라운드 슈퍼바이저 세션(Claude agent view, Warp Oz, Cursor 클라우드 에이전트), (b) 휴대폰/웹에서 원격 제어(Claude Remote Control, Cursor 모바일), (c) "running / blocked on you / done" 3상태 인박스, (d) 병목이 리뷰로 이동, (e) 음성·스웜·오케스트레이터 모드(2026-11 Cursor·Antigravity). spec-driven은 Kiro가 대표.

### Cited Findings

- agent view는 세션을 "running, blocked on you, or done"으로 묶은 단일 목록 — 사실상 에이전트 인박스 — [CHANGELOG v2.1.139](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- Claude Code Remote Control: 휴대폰/웹에서 터미널 세션 상태 확인·정지(2.1.326에서 백그라운드 서브에이전트 상태 동기화 수정) — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- Cursor 3: 모바일·웹·Slack·GitHub·Linear에서 에이전트 시작 — [the-decoder](https://the-decoder.com/new-cursor-3-ditches-the-classic-ide-layout-for-an-agent-first-interface-built-around-parallel-ai-fleets/)
- 리뷰 병목: 하버드 연구(HN 2026-11-17, 319pts); Anthropic "How the Claude Code team thinks about verification"(HN 2026-11-17, 291pts) — [HN Algolia 결과](https://hn.algolia.com/api/v1/search_by_date?query=claude%20code&tags=story), [claude.dev blog](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/)
- Antigravity 2026-11: "/swarm"(11-10), "Orchestrator"(11-12), Voice mode; Cursor "Voice Chat with Agents"(11-06) — [Antigravity RSS](https://antigravity.google/blog/rss.xml), [Cursor RSS](https://cursor.com/changelog/rss.xml)
- 보안 이슈: Claude Code "Don't Ask Again"이 공개 GitHub 1,122개 파일에 비밀번호 노출(HN 628pts, 2026-11-07); Windows 11이 사용 중인 코딩 에이전트 텔레메트리 수집(HN 728pts, 2026-11-16) — [Apiiro](https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again), [xusheng.dev](https://xusheng.dev/posts/windows-coding-agent-telemetry/)
- 모델 이벤트(새 소식 피드 대상 예): GPT-6.2 Astra/Sol(2026-11-17), Gemini 4 Neon/Hydrogen/Carbon(2026-11) — [OpenAI RSS](https://openai.com/news/rss.xml), [Antigravity RSS](https://antigravity.google/blog/rss.xml)

### Inferences

- **[추측]** 2027년 방향: "세션 = 탭"에서 "작업 = 인박스 항목"으로. Aquila Agents 사이드바에 "나를 기다림" 필터를 두는 것이 트렌드 정합적.
- **[추측]** 터미널 표준(OSC 7501)이 훅을 일부 대체해 터미널 기반 멀티-에이전트 셸(Aquila Agents 같은)이 1st-party 기능 없이 상태를 얻는 길이 열림.

### Gaps

- spec-driven 개발의 2026년 채택 데이터, 에이전트 인박스의 정량적 사용자 반응은 찾지 못함.

## 5. "새 소식(트렌드) 버튼" — 기계가 읽을 수 있는 소스, 빈도, 제약

### Takeaway

2026-11-19 직접 확인 결과, 신뢰도 높고 무인증으로 쓸 수 있는 소스: GitHub Releases API/Atom(claude-code, codex), Claude Code CHANGELOG.md(raw), OpenAI News RSS, Cursor changelog RSS, Antigravity blog RSS, Simon Willison Atom, Latent Space RSS, HN Algolia API. **Anthropic 뉴스 RSS는 없음(404)**, Warp 블로그 RSS도 404, Codex changelog "rss.xml" 경로는 HTML(약 4.8MB)을 반환해 실제 피드가 아님.

### Cited Findings (모두 2026-11-19 curl로 확인)

| 소스                  | 엔드포인트                                                                                      | 결과 / 빈도                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code releases  | `https://api.github.com/repos/anthropics/claude-code/releases`                                  | 200 JSON; 최신 v2.1.328(2026-11-19), 최근 30개 릴리스가 2026-10-07~11-19 → **거의 매일 릴리스**; 릴리스 본문 19–48KB(길다) — [API](https://api.github.com/repos/anthropics/claude-code/releases) |
| Claude Code Atom      | `https://github.com/anthropics/claude-code/releases.atom`                                       | 200 application/atom+xml(약 286KB) — [Atom](https://github.com/anthropics/claude-code/releases.atom)                                                                                             |
| Claude Code CHANGELOG | `raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`                            | 200, 약 1.3MB, 444개 버전 섹션 — 파싱 쉬움, 크기는 큼 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)                                                  |
| Codex releases        | `https://api.github.com/repos/openai/codex/releases`                                            | 200 JSON; rust-v0.170.0(2026-11-18) + 같은 날 다수 alpha(본문 ~25B) → **prerelease 필터 필수** — [API](https://api.github.com/repos/openai/codex/releases)                                       |
| GitHub API 제한       | 무인증 60 req/h/IP (`x-ratelimit-limit: 60` 헤더 확인)                                          | ETag/If-None-Match 조건부 요청으로 절약 가능                                                                                                                                                     |
| OpenAI News           | `https://openai.com/news/rss.xml`                                                               | 200 RSS(약 860KB), 하루 수 건, Codex 외 기업/정책 기사 다수 → 키워드 필터 필요 — [RSS](https://openai.com/news/rss.xml)                                                                          |
| Cursor changelog      | `https://cursor.com/changelog/rss.xml`                                                          | 200 RSS, 주 1–2회 — [RSS](https://cursor.com/changelog/rss.xml)                                                                                                                                  |
| Antigravity blog      | `https://antigravity.google/blog/rss.xml`                                                       | 200 RSS, 2026-11에 주 2–3회 — [RSS](https://antigravity.google/blog/rss.xml)                                                                                                                     |
| Simon Willison        | `https://simonwillison.net/atom/everything/`                                                    | 200 Atom — [Atom](https://simonwillison.net/atom/everything/)                                                                                                                                    |
| Latent Space          | `https://www.latent.space/feed`                                                                 | 200 RSS(약 885KB) — [RSS](https://www.latent.space/feed)                                                                                                                                         |
| HN                    | `https://hn.algolia.com/api/v1/search_by_date?query=...&tags=story&numericFilters=points%3E100` | 200 JSON, 무인증; `>`는 반드시 `%3E`로 인코딩(미인코딩 시 400 확인) — [HN Algolia](https://hn.algolia.com/api/v1/search_by_date?query=claude%20code&tags=story&numericFilters=points%3E100)      |
| Anthropic news        | `anthropic.com/rss.xml`, `anthropic.com/news/rss.xml`                                           | **404** — 공식 RSS 없음                                                                                                                                                                          |
| claude.com/blog       | `/blog/rss.xml`                                                                                 | 200이지만 "Redirecting..." 페이지 — 사용 불가                                                                                                                                                    |
| Warp blog             | `/blog/rss.xml`                                                                                 | 404                                                                                                                                                                                              |
| Codex changelog       | `developers.openai.com/codex/changelog/rss.xml`                                                 | HTML 반환(피드 아님) → GitHub Releases로 대체                                                                                                                                                    |

- Claude Code hooks에서 서브에이전트/팀 관련 변경이 릴리스마다 다수 → 키워드("subagent", "agent team", "agent view", "hook", "Added")로 CHANGELOG 라인을 분류하면 "새 서브에이전트 기능 출시" 같은 항목 자동 추출 가능 — [CHANGELOG](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)

### Inferences (구현 제안 — 출처 없는 판단 포함)

- **설계안 [추측/권장]**: 메인 프로세스(electron)에서 fetch → `~/.aquila/news-cache.json` 캐시 → IPC(`IPC.newsList`)로 렌더러에 전달(규칙 2). 갱신은 앱 시작 시 + 6시간마다, GitHub는 ETag 조건부 요청(60 req/h 한도 안에서 여유).
- 우선순위 소스 3단: ① **설치된 CLI 버전과 연결된 변경**(사용자의 `claude --version`/`codex --version`보다 새 릴리스의 "Added" 라인만) — 가장 실용적, ② 1st-party 블로그/RSS(OpenAI, Cursor, Antigravity) 키워드 필터, ③ HN points>100 + 키워드("agent", "Claude Code", "Codex", "subagent", "ADE").
- Codex는 `prerelease: true`·`-alpha` 태그 제외. Claude Code 릴리스 본문은 길어 "Added" 줄만 추출해 3–5개 하이라이트로 축약.
- 라이선스: RSS/릴리스 노트는 제목+링크+짧은 발췌만 표시하고 원문으로 링크(전문 재게시 금지)하는 것이 일반적 안전선 **[추측: 법률 검토 아님]**. HN Algolia는 공개 API지만 과도 호출 자제.
- LLM 요약: Aquila Agents는 이미 `claude`를 임베드하므로 **[추측]** "요약 보기"를 누르면 `claude -p "다음 변경 사항을 한국어 3줄로 요약"`을 사용자 계정으로 실행하는 옵트인 방식이 가능(추가 API 키 불필요, 단 사용자 쿼터 소모 → 기본값은 비요약 원문 목록). 처음엔 키워드 규칙 기반 분류(서브에이전트/훅/모델/ADE)로 충분.
- UI: 사이드바 상단 띠에 버튼 1개 + 미확인 개수 배지(마지막 확인 시각 이후), 클릭 시 패널에 "내 CLI 업데이트 / 업계 소식" 2개 탭. 모든 문구는 `dictionary.ts` ko/en.

### Gaps

- 인앱 "What's new" 피드를 잘 구현한 앱 사례(예: VS Code 릴리스 노트, Raycast, Linear, Warp 등)와 인앱 LLM 요약이 흔한지에 대한 출처는 이번 조사(툴 호출 한도)에서 확보하지 못함 — 위 UI 제안은 추론.
- Product Hunt API(GraphQL, 토큰 필요) 및 Reddit API(2023년 이후 유료화/제한) 조건은 이번에 직접 확인하지 않음.
- 각 RSS의 이용약관(재배포 조건)은 확인하지 않음.
