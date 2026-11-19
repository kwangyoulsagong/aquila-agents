# 세션·탭·분할 관리, 키보드 내비게이션, 세션 복원: 최종 사용자 관점 사용성 (Aquila Agents 개선용)

> 조사일: 2026-11-19. 출처는 주로 GitHub 이슈/디스커션, Hacker News 코멘트, 제품 문서/블로그다. 검색 도구가 Reddit 스레드를 직접 반환하지 않아 Reddit 원문 인용은 없다(아래 Gaps 참고). 비교 글 중 상당수는 경쟁사(Paradev/Superset, agentsroom, crystl 등)가 쓴 것이라 편향 가능성이 있으므로 그렇게 표시했다.

## 1. 터미널 앱과 에이전트 매니저는 탭·분할·리사이즈·포커스·이름·재정렬·복원을 어떻게 처리하고, 사용자는 무엇을 좋아하고 싫어하나?

### Takeaway

사용자가 일관되게 원하는 것은 두 가지다. (a) 재시작 후 레이아웃과 작업 디렉터리만이 아니라 **내용(스크롤백)과 살아 있는 세션**까지 돌아오는 것, (b) 탭이 많을 때 쓸 수 있는 **세로 탭/사이드바와 "주의 필요" 상태 표시**. 에이전트 전용 앱(cmux, Claude Code 데스크톱, Paradev)은 이 둘을 핵심 차별점으로 내세운다. 분할 쪽에서 반복해서 칭찬받는 패턴은 pane zoom 토글, 키보드 리사이즈, 탭을 다른 창으로 끌어 합치기다.

### Cited Findings

**Ghostty**

- macOS에서 창, 탭, 분할 *구조*는 복원하지만 터미널 *내용*은 복원하지 않는다. 사용자는 재시작 뒤 홈 디렉터리가 아닌 탭 2개를 잃었다고 보고했다. 메인테이너(jcollie)는 세션 복원이 터미널의 "norm"이 아니며, 나중에 opt-in으로 들어올 수도 있지만 일정은 없다고 답하고 스레드를 잠갔다. 다른 사용자는 "iTerm2와 Apple Terminal은 수년간 제공해 왔고, 많은 사용자가 기본 기능으로 여긴다"고 반박했다 — [Ghostty Discussion #12912](https://github.com/ghostty-org/ghostty/discussions/12912)
- HN(Ghostty 1.4): "재시작 시 터미널 히스토리 다시 불러오기 계획 있나?"라는 질문에 tmux/zmx를 쓰라는 답이 달리자, 질문자는 "멀티플렉서 기능이 아니라 터미널 자체의 기능"이라고 반박했다. 또 "Apple Terminal과 iTerm2는 OS 재부팅 후에도 스크롤백을 복원한다", "Konsole처럼 스크롤백을 디스크로 덤프해 달라(RAM 15G 대신)"는 코멘트가 있었다 — [HN 50261998](https://news.ycombinator.com/item?id=50261998)
- 같은 스레드에서 Kitty의 hints 모드(키보드로 화면의 URL/경로 선택)가 "Kitty에서 Ghostty로 옮기지 못하게 막는 유일한 기능"이라는 의견, WezTerm QuickSelect가 "키보드 중심 워크플로우에 game-changing"이라는 의견, iTerm2 검색창에 붙여넣기가 되는 점이 "집에서 iTerm2를 계속 쓰는 이유"라는 의견이 나왔다. Ghostty quick terminal이 iTerm2 hotkey window만 못하다는 의견도 있었다 — [HN 50261998](https://news.ycombinator.com/item?id=50261998)
- 세로 탭은 반복되는 요청이다. iTerm2에서 넘어오지 못하는 "major sticking point"라는 글이 있다(2025-08) — [Ghostty Discussion #2549](https://github.com/ghostty-org/ghostty/discussions/2549)
- 복원 버그: 한 창 안의 네이티브 탭이 재시작 후 각각 별도 창으로 복원됐다(분할은 정상) — [Ghostty #7664](https://github.com/ghostty-org/ghostty/discussions/7664). 탭과 분할이 여럿인 창을 복원할 때 깜빡임이 생기는데, iTerm은 그렇지 않다는 비교가 있었다 — [Ghostty #4181](https://github.com/ghostty-org/ghostty/discussions/4181)
- HN(Ghostty 1.0): Ghostty는 탭을 끌어 다른 창에 합칠 수 있는데 WezTerm은 못 한다는 점이 칭찬받았다. WezTerm 탭은 macOS 네이티브가 아닌 에뮬레이션이라는 불만도 있었다 — [HN 42517447](https://news.ycombinator.com/item?id=42517447)

**WezTerm / Kitty / tmux / zellij**

- WezTerm `TogglePaneZoomState`는 한 pane을 탭 전체로 키우고, 끄면 원래 분할 배치로 돌아간다. CLI `wezterm cli zoom-pane --toggle`도 있다. `AdjustPaneSize`로 키보드 리사이즈를 셀 단위로 한다 — [WezTerm docs](https://wezterm.org/config/lua/keyassignment/TogglePaneZoomState.html), [AdjustPaneSize](https://wezfurlong.org/wezterm/config/lua/keyassignment/AdjustPaneSize.html). 사용 예: 긴 traceback을 읽으려고 실행 pane을 최대화했다가 다시 토글하기 — [Intro to wezterm](https://wga-learning.pages.dev/posts/128_intro-to-wezterm/)
- WezTerm은 내장 멀티플렉싱과 복원 가능한 세션이 있지만, Ghostty 사용자 대부분은 tmux와 함께 쓴다 — [Taverne Tech](https://taverne-tech.com/en/blog/install-configure-ghostty-terminal-macos/)
- zellij: 상태바에 가능한 키가 표시돼 "암기 부담을 없앴다"는 평가를 받는다. 세션 resurrection이 내장돼 있어 재부팅 후에도 pane 레이아웃을 복원하고 명령을 다시 실행할 수 있는데, 재실행 전에 기본적으로 사용자 확인을 기다린다. tmux는 tmux-resurrect 플러그인이 필요하다 — [Zellij 리뷰](https://jpk-io.pages.dev/dev-tools/zellij-terminal-multiplexer-review/), [tmux vs zellij 2025](https://gigasblade.blogspot.com/2025/10/tmux-vs-zellij-october-2025.html), [odd.blog](https://odd.blog/2026/02/18/from-screen-to-tmux-to-zellij/)
- tmux/zellij의 한계: 이름 붙인 세션은 유지되지만, pane만 보고는 에이전트가 입력을 기다리는지 알 수 없다 — [Paradev 비교(경쟁사 작성)](https://paradev.com/compare/manage-multiple-coding-agent-sessions)

**Warp / iTerm2 / VS Code**

- Warp는 창, 탭, pane을 로컬 SQLite에 저장해 재실행 시 복원하고, 종료할 때마다 덮어쓴다. 설정에서 끌 수 있다. Launch Configurations는 legacy가 됐고 Tab Configs로 대체됐다 — [Warp docs: session restoration](https://docs.warp.dev/features/sessions/session-restoration), [Tab configs](https://docs.warp.dev/terminal/sessions/tab-configs). "restore on startup 옵션을 더 세분화해 달라"는 이슈(#5220)가 있고, 설정에는 `restore_session` 값 panes/tabs가 있다 — [Warp issues](https://Www.GitHub.com/warpdotdev/Warp/issues)
- iTerm2 broadcast input: 현재 탭의 모든 pane이나 모든 탭에 같은 입력을 보내며, 대상 pane에 빨간 줄무늬 배경으로 표시한다. 클러스터 작업이나 여러 pane에 같은 비밀번호를 칠 때 쓴다는 사용자 후기가 있다. hotkey window는 시스템 전역 키로 띄우는 전용 창이다 — [iTerm2 docs](https://iterm2.com/documentation-menu-items.html), [Top 5 iTerm2 Features](https://medium.com/@jonackerland/top-5-iterm-features-i-rely-on-51be03e25d9)
- iTerm2는 pane이 많을 때 버그와 성능 문제가 있고, 업데이트 알림이 잦고, "AI 기능으로 bloated"됐다는 불만이 HN에 있다 — [HN 50261998](https://news.ycombinator.com/item?id=50261998)
- VS Code 터미널: `terminal.integrated.enablePersistentSessions`와 `persistentSessionScrollback`으로 스크롤백 복원량을 조절한다 — [VS Code Terminal Advanced](https://code.visualstudio.com/docs/terminal/advanced). 재시작 후 터미널이 중복되거나 엉뚱하게 남으면 이 설정을 끄라는 조언이 포럼에 반복된다 — [Julia Discourse](https://discourse.julialang.org/t/vs-code-keeps-older-julia-sessions-but-produces-errors/71111). 서드파티(dterm)는 VS Code 내장 persistence가 스크롤백만 되살리고 살아 있는 셸은 되살리지 못한다고 주장한다(작성자 주장) — [dterm](https://github.com/bendavid/dterm)

**에이전트 세션 매니저**

- **cmux**(libghostty 기반 네이티브 macOS): 세로 탭 사이드바에 git 브랜치, PR 상태, 작업 디렉터리, 리스닝 포트, 최신 알림 텍스트를 보여준다. 에이전트가 기다리는 pane에는 파란 링이 생기고 사이드바 탭이 켜진다. **⌘⇧U로 가장 최근 읽지 않은 알림으로 점프**한다. 제작 동기: Claude Code 알림은 "Claude is waiting for your input"뿐이라 맥락이 없고, 탭이 많아지면 제목을 읽을 수 없었다. 한계: 재시작 후 살아 있는 Claude Code/tmux/vim 세션은 아직 재개되지 않는다. hook 프로토콜을 제대로 구현하지 않은 에이전트는 링이 켜지지 않는다 — [YC launch](https://www.ycombinator.com/launches/PbB-cmux-the-open-source-terminal-built-for-coding-agents), [noqta 리뷰](https://noqta.tn/en/blog/cmux-macos-terminal-ai-coding-agents-parallel-sessions-2026), [lavx](https://news.lavx.hu/article/cmux-a-native-macos-terminal-built-for-ai-coding-agents)
- cmux Show HN(2026-02, 최고 #2): 일본·중국 사용자들이 대기 중인 pane의 파란 테두리, 내장 알림, 세로 탭을 칭찬했다. 요청: Ghostty식 **커맨드 팔레트(⌘⇧P)**, 단축키 재정의, **⌘Z pane zoom** — [cmux blog: Show HN](https://cmux.com/blog/show-hn-launch)
- **Claude Code 데스크톱**(2026-04 리디자인): 활성 세션과 최근 세션을 모두 보여주는 사이드바가 있고, 상태·프로젝트·환경으로 필터하거나 **프로젝트별로 그룹**할 수 있다. PR이 머지되거나 닫히면 세션이 **자동 보관**돼 "사이드바가 살아 있는 것에 집중"하게 한다. 터미널, diff, 프리뷰, 채팅 pane을 드래그 앤 드롭으로 그리드 배치한다. **⌘/로 단축키 전체 목록**을 띄운다 — [Anthropic: desktop redesign](https://claude.com/resources/articles/claude-code-desktop-redesign). 사이드바는 working/waiting을 구분해 보여준다 — [pasqualepillitteri](https://pasqualepillitteri.it/en/news/866/claude-code-desktop-redesign-parallel-sessions). 한계: CLI나 VS Code에서 시작한 세션은 데스크톱 앱에 보이지 않는다 — [developertoolkit.ai](https://developertoolkit.ai/en/claude-code/build/desktop-app/)
- **Paradev(구 Superset)**: 워크스페이스마다 activity strip이 있고 Board/List 뷰를 제공한다. lifecycle hook으로 Idle / Working / Needs attention / Needs review / Merged 상태를 표시하고, 알림과 dock 배지를 띄운다. 서브에이전트는 부모 밑에 중첩된다. 크래시나 재부팅 후에는 각 에이전트의 resume 명령으로 다시 띄운다. ⌘N 새 세션, ⌘O IDE로 열기 — [Paradev 비교(자사 글)](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- Paradev의 Electron+xterm.js 아키텍처 교훈: 처음에는 pty가 Electron main의 자식이라 앱 종료, 크래시, 업데이트 때 세션이 전부 죽었다. tmux도 시도했지만 설치 의존성과, 스크롤·선택·단축키가 xterm.js와 충돌하는 문제로 버렸다. 그래서 별도 **터미널 데몬**이 pty를 소유하게 하고 앱은 클라이언트로 재접속하게 했다. 데몬까지 죽으면(재부팅 등) 메타데이터에 `endedAt`이 없는 것으로 비정상 종료를 감지하고 **cold restore**를 제안한다: 이전 출력을 읽을 수 있게 보여주고 같은 디렉터리에서 새 셸을 연다. 10 pane 워크스페이스를 열 때 spawn storm이 생기지 않도록 **활성 터미널을 먼저 hydrate**하고 백그라운드는 점진적으로 붙인다. 출력 소켓과 RPC 소켓을 분리해 큰 출력이 새 터미널 생성을 막지 않게 했다 — [Paradev: terminal daemon deep dive](https://paradev.com/cs/blog/terminal-daemon-deep-dive)
- **Conductor**: worktree로 격리된 워크스페이스, 상태 보드, diff/PR 리뷰를 제공한다. Apple Silicon 전용이다. 비교 글에 따르면 신규 가입을 중단했고 클라우드 서비스는 2026-11 종료 예정이다(경쟁사 글, 독립 확인 안 됨) — [Paradev 비교](https://paradev.com/compare/manage-multiple-coding-agent-sessions), [agentsroom](https://agentsroom.dev/blog/best-multi-agent-coding-tools)
- **Claude Squad**: tmux 위의 TUI이고 상태 표시는 기본 수준이다. "생각보다 무겁다(의존성, 학습 곡선)"는 dev.to 후기가 있다 — [dev.to claunch](https://dev.to/kaz123/how-i-solved-claude-codes-context-loss-problem-with-a-lightweight-session-manager-265d). **Crystal**은 Nimbalyst로 이름을 바꾸며 레거시가 됐고, **Vibe Kanban**은 운영사(Bloop)가 문을 닫아 커뮤니티가 유지한다 — [augmentcode](https://www.augmentcode.com/tools/open-source-agent-orchestrators), [nimbalyst](https://nimbalyst-website.pages.dev/blog/best-agent-management-tools-2026/)

### Inferences

- Aquila Agents의 "고정 1/2 크기, 드래그 리사이즈 없음"은 WezTerm/iTerm2/Claude Code 데스크톱 사용자 기대에 못 미칠 가능성이 높다. 최소한 **pane zoom 토글**(예: ⌘⇧↩, WezTerm/iTerm2식)과 키보드 리사이즈를 넣는 것이 저비용 고효과로 보인다. 긴 Claude 출력을 읽는 상황에 특히 맞다.
- 복원 기대치는 **3단계**로 정리할 수 있다. ① 레이아웃+cwd(Ghostty 수준, "불충분"하다는 불만), ② 스크롤백 텍스트(iTerm2/Terminal/Warp 수준, "기본 기능"으로 여겨짐), ③ 살아 있는 세션 재개(Paradev 데몬, `claude --resume`). Aquila Agents 계획(`claude --resume`, `codex resume`)은 ③에 해당한다. 다만 resume이 실패할 때를 대비해 ②(마지막 스크롤백을 읽기 전용으로 보여주기, Paradev의 cold restore)를 fallback으로 두는 게 좋겠다.
- 프로젝트별 그룹 사이드바와 상태 점은 Aquila Agents에 이미 있으므로, Claude Code 데스크톱식 **필터(waiting만 보기)**와 **자동 보관/정리**가 다음 단계로 자연스럽다.

### Gaps

- Kitty의 탭/분할/zoom 동작과 사용자 평가는 공식 문서로 확인하지 못했다.
- iTerm2 탭 이름 변경, 배지, 세션 복원에 대한 2025–26년 사용자 평가는 찾지 못했다(문서 항목 존재만 확인).
- Warp 탭 복원에 대한 사용자 불만의 양적 근거는 없고, 이슈 제목만 확인했다.
- Codex CLI `codex resume`의 신뢰성 관련 사용자 보고는 이번 조사 범위에서 찾지 못했다.

## 2. 많은 터미널/에이전트 세션을 다룰 때 가장 큰 사용자 불만은?

### Takeaway

1위는 "어느 세션이 나를 기다리는지 모른다"(탭은 프로세스가 살아 있다는 것만 보여줄 뿐 에이전트 상태는 안 보여준다), 2위는 재시작·크래시 뒤 세션과 맥락을 잃는 것, 3위는 탭 난립이다. resume 자체도 Claude Code 쪽 버그(picker 누락, 잘못된 범위, 동명 세션 구분 불가)가 많아서, 래퍼 앱은 **ID로 직접 resume**해야 안전하다.

### Cited Findings

- 탭 하나는 "살아 있음"만 알려줄 뿐 에이전트가 입력을 기다리는지는 알려주지 않는다("dead-looking tabs"). 일부 에이전트는 완료 신호만 내보내 입력 대기 알림이 빠진다. 에이전트 터미널 사이를 오가다 각 작업의 맥락을 놓친다 — [Paradev 비교](https://paradev.com/compare/manage-multiple-coding-agent-sessions)
- "작업마다 새 탭을 열다 보니 금세 10개가 되고, 어느 게 뭘 하는지 모르게 됐다" — [Artem 'how i manage 10 claude code agents'](https://artemxtech.substack.com/p/how-i-manage-10-claude-code-agents)
- Claude Code 기본 알림은 "Claude is waiting for your input"뿐이라 맥락이 없고, 탭이 많으면 알림 제목을 읽을 수 없다(cmux 제작 동기) — [noqta 리뷰](https://noqta.tn/en/blog/cmux-macos-terminal-ai-coding-agents-parallel-sessions-2026)
- 전환하다 길을 잃는 문제를 풀려고 별도 모니터링 앱들이 생겼다: 바쁜 세션과 승인 대기 세션을 색 점으로 보여주는 Chive, 모든 Claude Code 세션을 한곳에 보여주는 Agent Sessions — [Chive](https://chivecc.gumroad.com/l/chive), [dev.to Agent Sessions](https://dev.to/ozan_kak_75bcbab7a8a1/macos-app-to-monitor-all-running-claude-code-sessions-at-once-1jm8)
- 터미널을 닫을 때마다 Claude Code가 맥락을 잃는 데 지쳐, 여러 프로젝트용 세션 매니저(claunch)를 만든 사례 — [dev.to](https://dev.to/kaz123/how-i-solved-claude-codes-context-loss-problem-with-a-lightweight-session-manager-265d)
- Claude Code resume 관련 버그 보고(2025–26):
  - `sessions-index.json`이 갱신을 멈춰 jsonl이 30개 넘게 있어도 picker가 비어 보인다 — [#25685](https://claudeissues.com/issue/25685-session-resume-picker-shows-no-sessions-sessions-index-json-stops-updating)
  - 2.1.104에서 picker가 현재 디렉터리로 한정되지 않고 전역 목록을 보여준다(회귀) — [#51658](https://claudeissues.com/issue/51658-bug-resume-picker-no-longer-scoped-to-current-directory-regression-in-2-1-104)
  - git worktree 안에서 picker가 0행으로 접힌다 — [#86633](https://claudeissues.com/issue/86633-bug-in-session-resume-picker-collapses-to-0-rows-inside-a-git-worktree-and-never)
  - 이름이 같은 항목을 구분할 수 없다 — [#59242](https://claudeissues.com/issue/59242-bug-resume-list-shows-wrong-session-names-duplicate-named-entries-are-indistingu)
  - 같은 slug의 continuation 파일 때문에 엉뚱한 세션이 로드된다 — [#30606](https://claudeissues.com/issue/30606-resume-loads-wrong-session-when-continuation-files-share-the-same-slug)
  - 공통 우회책: picker를 건너뛰고 `claude -r <uuid>`로 ID를 지정해 resume하면 jsonl을 직접 읽는다 — [cybersader: session recovery](https://cybersader.github.io/agentic-workflow-and-tech-stack/stack/patterns/claude-code-session-recovery/)
- 재부팅 뒤 Claude Code 세션을 자동으로 이어가는 방법을 다룬 블로그가 따로 있을 만큼 수요가 있다 — [Medium](https://medium.com/@artjoms.stukans/how-to-resume-your-claude-code-session-after-a-reboot-automatically-126f710e9c1d)
- VS Code에서 Claude 탭이 `isTransient` 플래그 때문에 재시작 후 되살아나지 않는다는 보고, 그리고 창을 다시 로드해도 Claude 세션을 자동 복원해 달라는 요청 — [#88078](https://claudeissues.com/issue/88078-bug), [#60937](https://claudeissues.com/issue/60937-feature-auto-restore-editor-area-claude-sessions-across-vs-code-window-reload)
- worktree는 파일만 분리하고 프로세스나 포트는 공유하므로 런어웨이 `npm install`이나 DB 마이그레이션이 실제 환경을 건드릴 수 있다는 공통 지적 — [agentsroom](https://agentsroom.dev/blog/best-multi-agent-coding-tools)

### Inferences

- Aquila Agents는 탭을 열 때 Claude 세션 ID를 **스폰 시점에 포착해 저장**하고(hook의 session_id 활용), 복원할 때 picker 없이 `claude --resume <id>`로 띄워야 위 picker 버그들을 피할 수 있다. ID가 없거나 resume이 실패하면 "새로 시작 / 목록에서 고르기" 선택지를 보여주는 것이 안전하다.
- 상태 점은 "working / waiting(입력·승인) / done / error"처럼 **입력 대기와 완료를 구분**해야 가치가 있다. 알림 문구에는 프로젝트명과 탭 이름을 넣어 "맥락 없는 알림" 불만을 피한다.

### Gaps

- r/ClaudeAI, r/ClaudeCode 원문 스레드를 검색으로 확보하지 못했다. 위 불만은 블로그, 이슈, HN 기반이다.
- 스크롤백 손실을 사용자가 얼마나 체감하는지에 대한 정량 데이터는 없다.

## 3. 사용자가 좋아하는 키보드 중심 패턴 (커맨드 팔레트, 퀵 스위처, broadcast, 마지막/다음 대기 세션 점프)

### Takeaway

에이전트 맥락에서 가장 구체적인 증거가 있는 패턴은 **"다음 미읽음/대기 세션으로 점프"(cmux ⌘⇧U)**와 **커맨드 팔레트**(cmux HN 요청, Ghostty ⌘⇧P)다. 범용 터미널 쪽에서는 pane zoom, 키보드로 텍스트 선택(Kitty hints, WezTerm QuickSelect), broadcast input(iTerm2), 단축키 목록 오버레이(Claude Code ⌘/, zellij 상태바)가 칭찬받는다.

### Cited Findings

- cmux: ⌘⇧U로 가장 최근 읽지 않은 알림의 pane으로 점프 — [YC launch](https://www.ycombinator.com/launches/PbB-cmux-the-open-source-terminal-built-for-coding-agents), [lavx](https://news.lavx.hu/article/cmux-a-native-macos-terminal-built-for-ai-coding-agents)
- cmux HN 사용자 요청: Ghostty식 커맨드 팔레트(⌘⇧P), hotkey 재정의, ⌘Z pane zoom — [cmux blog](https://cmux.com/blog/show-hn-launch)
- Claude Code 데스크톱: 세션 전환, 생성, 내비게이션 단축키를 제공하고 ⌘/로 전체 목록을 보여준다. ⌘;는 사이드 챗(메인 스레드 맥락을 읽기만 하고 다시 쓰지 않음) — [Anthropic](https://claude.com/resources/articles/claude-code-desktop-redesign)
- zellij 상태바가 가능한 키를 보여줘 "암기 부담 제거" — [jpk-io 리뷰](https://jpk-io.pages.dev/dev-tools/zellij-terminal-multiplexer-review/)
- Kitty hints와 WezTerm QuickSelect(키보드로 URL, 해시, 경로 선택)에 대한 강한 선호. Kitty hints는 Ghostty로 옮기지 못하는 유일한 이유로 꼽혔다 — [HN 50261998](https://news.ycombinator.com/item?id=50261998)
- iTerm2 broadcast input(현재 탭 전체/모든 탭, 대상 pane 시각 표시)과 hotkey window — [iTerm2 docs](https://iterm2.com/documentation-menu-items.html), [hotkey 문서](https://iterm2.com/documentation-hotkey.html)
- WezTerm pane zoom 토글과 키보드 리사이즈 — [WezTerm docs](https://wezterm.org/config/lua/keyassignment/TogglePaneZoomState.html)
- Paradev: ⌘N 새 세션, ⌘O 워크스페이스를 IDE로 열기 — [Paradev 비교](https://paradev.com/compare/manage-multiple-coding-agent-sessions)

### Inferences

- Aquila Agents 우선순위 제안:
  1. **"다음 대기 세션으로 점프"** 단축키(예: ⌘⇧U 또는 ⌘J). 프로젝트를 가로질러 waiting 상태인 세션을 차례로 돈다. 현재 ⌘1–9는 프로젝트 단위라 대기 세션을 찾는 데는 부족하다.
  2. **⌘K 팔레트**는 명령 실행뿐 아니라 **세션/탭 퍼지 검색 퀵 스위처**를 겸해야 한다(프로젝트명, 탭 이름, 상태로 검색). "마지막 활성 세션으로 토글"(⌃Tab/⌘` 계열)도 함께 넣는다.
  3. **pane zoom 토글**과 **⌘/ 단축키 오버레이**.
  4. broadcast input은 에이전트 맥락에서 쓰임새가 제한적이다(같은 프롬프트를 여러 에이전트에 보내기 정도). 증거가 약하므로 후순위로 둔다.

### Gaps

- 에이전트 매니저 사용자 중 "broadcast to agents"를 실제로 원하는 목소리는 찾지 못했다.
- "jump to last active" 기능에 대한 직접적인 사용자 칭찬 인용은 찾지 못했다(일반적 패턴으로 추론).

## 4. Electron/xterm.js 기반 앱에서 사용자가 체감하는 터미널 품질 이슈

### Takeaway

Aquila Agents에 가장 직접적인 위험은 **한국어 IME**(자모 분리, 중복 입력, 조합 중 글자가 안 보임)와 **다수 터미널의 메모리/WebGL 컨텍스트 한도**다. VS Code 터미널은 같은 Electron+xterm.js 조합인데 한국어가 정상이라는 보고가 있다. 따라서 문제는 대개 앱의 입력 처리 계층에 있고, 고칠 수 있다.

### Cited Findings

- Wave Terminal(Electron+xterm.js)에서 CJK 조합이 깨진다. 보고자는 원인이 xterm.js가 아니라 앱의 Electron↔xterm.js 입력 처리에 있다고 보며, VS Code 통합 터미널은 정상이라고 언급했다. 관련 Electron 버그(#32307 트레이 클릭 포커스, #29875 before-input-event preventDefault)도 참조된다 — [waveterm #2915](https://gh.r-mj.com/wavetermdev/waveterm/issues/2915)
- xterm.js #5778: 두 경로가 같은 조합 텍스트를 내보내 입력이 중복된다(Electron 34, @xterm/xterm 6.1.0-beta) — [xterm.js #5778](https://github.gg22.workers.dev/xtermjs/xterm.js/issues/5778)
- xterm.js PR #5704: WKWebView에서 한국어 조합 시 `insertReplacementText`가 발생해 자모가 새어 나온다. keyCode 229 차단과 onData 필터링으로 우회(미병합, Electron 해당 여부는 미확인) — [xterm.js PR #5704](https://github.ddaodan.workers.dev/xtermjs/xterm.js/pull/5704)
- 다른 프로젝트의 우회책: compositionstart/compositionend 리스너로 부분 자모를 억제하고 최종 문자열만 전송 — [gstack PR #1297](https://gh.r-mj.com/garrytan/gstack/pull/1297)
- Claude Code CLI 자체의 한국어 IME 버그 보고도 많다: 자모 분해 — [#70007](https://claudeissues.com/issue/70007-korean-ime-input-broken-in-cli-prompt-characters-decompose-into-individual-jamo), 조합 중 글자가 안 보임(macOS) — [#22732](https://claudeissues.com/issue/22732-bug-korean-ime-characters-completely-invisible-during-composition-in-input-field), 비라틴 문자 조합 렌더링 지연 — [#1553](https://claudeissues.com/issue/1553-ime-composition-input-rendering-lag-for-non-latin-scripts). Cursor 포럼에서는 한국어 IME가 터미널 커서를 망가뜨린다는 보고가 있다 — [Cursor forum](https://forum.cursor.com/t/plz-save-korean-ime-input-breaks-terminal-cursor-switching-language-spews-garbage-text/133157)
- 메모리: 160x24 터미널에 스크롤백 5,000줄이면 약 34MB이고, 스크롤백이 큰 터미널을 여럿 띄우는 앱에서는 부담이 커진다 — [xterm.js buffer perf issue](https://lightrun.com/answers/xtermjs-xterm-js-buffer-performance-improvements)
- Chrome의 WebGL 컨텍스트 한도는 약 16개다. 터미널 사이에서 WebGL addon을 같은 프레임에 교체하면 한도를 소진할 수 있고, dispose한 뒤 DOM fallback이 갱신 전까지 오래된 프레임을 보여주는 문제가 있다 — [kolu #1299](https://github.gg22.workers.dev/juspay/kolu/issues/1299)
- Paradev(Electron) 자체 측정: 숨겨진 터미널의 스크롤백과 GPU 컨텍스트를 정리하자 터미널 16개 기준 GPU 컨텍스트가 16→4, 렌더러 RSS가 1,127MB→838MB로 줄었다(자사 측정) — [Paradev changelog 2026-07-19](https://superset.sh/changelog/2026-07-19-performance-memory-and-load)
- 전체 화면 repaint가 VS Code 창 전체의 지연을 악화시킨다는 Claude Code 보고 — [#84712](https://claudeissues.com/issue/84712-bug-fullscreen-full-viewport-repaints-degrade-whole-window-latency-in-the-vs-cod)
- 링크 안전성: Ghostty는 OSC 8 하이퍼링크의 표시 대상에서 보이지 않는 문자와 줄바꿈 문자를 제거하는 보안 수정을 했다 — [HN 50261998](https://news.ycombinator.com/item?id=50261998)
- 스크롤백 검색창에 붙여넣기가 되는지 같은 세부 사항이 터미널 선택을 좌우한다(iTerm2) — [HN 50261998](https://news.ycombinator.com/item?id=50261998)
- 성능을 이유로 Electron/Tauri가 아닌 네이티브 앱으로 만들었다는 cmux 측 설명. Electron 앱에 대한 성능 인식 자체가 경쟁 요소다 — [cmux blog](https://cmux.com/blog/show-hn-launch)

### Inferences

- 한국어 UI를 지원하는 Aquila Agents에게 IME 품질은 필수 조건이다. VS Code의 xterm.js 통합 방식(textarea 포커스, composition 처리)을 기준으로 삼아 테스트 체크리스트를 만들자: 자모 분해, 중복, 조합 중 표시, 조합 중 Enter, 한/영 전환 직후 키 입력.
- 4 pane에 프로젝트 여러 개, 탭 수십 개라면 WebGL 컨텍스트 16개 한도에 걸린다. **보이는 pane에만 WebGL**을 붙이고 숨겨진 탭은 dispose하거나 DOM/canvas로 돌리는 정책이 필요하다. 탭을 다시 보일 때 refresh를 강제해야 오래된 프레임이 남지 않는다.
- 복원 시 탭 수십 개를 동시에 spawn하면 느려지므로, Paradev처럼 활성 탭을 먼저 띄우고 나머지는 지연 spawn(또는 클릭할 때 resume)하는 방식이 적합하다.
- 앱 업데이트나 재시작 때 세션이 죽는 문제는 Paradev가 데몬으로 해결했다. Aquila Agents가 pty를 main 프로세스에서 소유한다면 장기적으로 고려할 만하다(단기적으로는 resume으로 대체).

### Gaps

- xterm.js 기반 앱의 폰트 렌더링(리가처, 굵기, 서브픽셀)에 대한 2025–26 사용자 불만은 찾지 못했다.
- 복사/붙여넣기(브래킷 붙여넣기, 줄바꿈 처리)와 링크 클릭(⌘클릭 경로 열기)에 대한 Electron 터미널 사용자 보고는 이번 조사에서 확보하지 못했다.
- 위 Korean IME 수정책 중 Electron(Chromium)에서 검증된 것은 Wave 이슈의 "VS Code는 정상" 관찰뿐이다. 구체적인 수정 코드는 직접 확인이 필요하다.
