# Claude Code / Codex CLI 일상 사용자의 불편·요구, 온보딩, macOS 완성도 (Aquila Agents 개선용)

> 조사일: 2026-11-19. 출처는 주로 GitHub 이슈, HN, 제품 README와 블로그입니다. claudeissues.com은 anthropics/claude-code GitHub 이슈를 미러링하는 사이트로 보이며, 이번에는 직접 접속에 실패해 검색 스니펫만 확인했습니다. 블로그 상당수는 경쟁 제품(Nimbalyst, crystl 등)이 쓴 글이므로 주의가 필요합니다.

## 1. Claude Code / Codex CLI 터미널 작업의 반복적 불편 — 호스트 앱이 해결 가능한 것 vs 불가능한 것

### Takeaway

가장 자주 반복되는 불만은 다음과 같습니다.

- 스트리밍 중 깜빡임과 스크롤 점프(Claude Code, Ink 기반)
- 붙여넣기·이미지 붙여넣기·복사·스크롤백 문제(Codex TUI)
- 한글 IME 조합 깨짐
- 컨텍스트 없는 알림("Claude is waiting for your input")
- 자리를 비웠을 때 승인 대기로 멈춰 있는 세션

이 중 알림·상태 표시·이미지 붙여넣기 보조·IME 처리·자리 비움 중 확인은 호스트 앱이 크게 개선할 수 있습니다. 반면 TUI 자체의 렌더링 방식이나 출력 내용은 CLI 쪽 문제라 일부만 완화할 수 있습니다.

### Cited Findings

**깜빡임·스크롤**

- 깜빡임 문제는 2025~2026년 내내 여러 이슈로 반복 보고됐습니다(#769, #3648, #13950, #16939, #18299). 내용은 다음과 같습니다. — [#18299](https://github.com/anthropics/claude-code/issues/18299), [#769](https://github.com/anthropics/claude-code/issues/769), [#13950](https://github.com/anthropics/claude-code/issues/13950), [#16939](https://github.com/anthropics/claude-code/issues/16939)
  - 긴 세션에서 스크롤 위치를 잃고 맨 아래로 튑니다.
  - "thinking" 표시가 깜빡입니다. 섬광에 민감한 사용자에게는 접근성 문제입니다.
  - 컨텍스트가 커질수록 악화되고, VS Code 터미널에서는 크래시까지 납니다.
- #18299(v2.1.7 시점): 깜빡임을 고친 업데이트 이후 위로 스크롤해 대화 일부를 복사하기가 어려워졌다는 보고입니다. — [#18299](https://github.com/anthropics/claude-code/issues/18299)
- macOS VS Code에서는 10~20분 뒤 깜빡임 때문에 VS Code가 크래시한다는 보고가 있습니다. v2.1.90에서도 글자 깨짐이 남아 있었습니다. — [#10794](https://github.com/anthropics/claude-code/issues/10794)
- 근본 원인에 대한 HN 의견: Claude Code는 alternate screen 대신 일반 스크롤백을 쓰기 때문에 변경될 때마다 지우고 다시 그립니다(Ink). Rust/ratatui 기반인 Codex에는 이 문제가 없다고 합니다. 이를 우회하는 서드파티 도구 "Claude Chill"도 등장했습니다. — [HN: Claude Chill](https://news.ycombinator.com/item?id=46699072)
- 큰 클립보드 내용을 빠르게 붙여넣으면 화면이 몇 초간 위아래로 튑니다(v2.0.31, 종료된 이슈). — [#10886](https://github.com/anthropics/claude-code/issues/10886)

**Codex의 붙여넣기·복사·스크롤백**

- Codex의 가장 흔한 불만은 텍스트를 Ctrl+V로 붙여넣으면 "no image on clipboard" 오류가 나는 것입니다. 키 입력을 이미지 붙여넣기로 해석하기 때문입니다. — [#44323](https://github.com/openai/codex/issues/44323), [#17103](https://github.com/openai/codex/issues/17103), [#53220](https://github.com/openai/codex/issues/53220)
  - 우회책: `/tui`로 Scrollback 모드 전환, 또는 `codex --no-alt-screen`.
  - 0.163.0에서 수정됐다는 언급이 있지만 VS 2026 환경 보고(#48676)는 여전히 실패합니다.
- 클립보드 이미지를 바로 붙여넣는 기능은 반복적으로 요청됩니다(#6080, #19143, #31685). 지금은 스크린샷을 파일로 저장한 뒤 경로를 넘겨야 한다는 불만입니다. — [#6080](https://github.com/openai/codex/issues/6080), [#19143](https://github.com/openai/codex/issues/19143), [#31685](https://github.com/openai/codex/issues/31685), [#17050](https://github.com/openai/codex/issues/17050)
  - 메인테이너는 "터미널에 맞는 단축키로 구현됐다"고 답했습니다.
  - 그러나 macOS에서 이미지가 첨부되지 않는다는 보고(#17050)가 이어집니다.
- Codex #53380(2026-10-12, open, 메인테이너 응답 없음): "Codex CLI terminal UX has regressed badly". — [#53380](https://github.com/openai/codex/issues/53380)
  - 스크롤백이 불편하고, 선택·복사가 어색하며, 계속 다시 그려집니다.
  - 출력과 diff가 접혀서 보이지 않고, 저가치 진행 문구가 너무 많습니다.
  - 요청: "Restore a simple, terminal-native, scrollback-friendly interface as the default."
  - 핵심 문장: "the fact that users have to opt out of the new default to regain basic terminal usability is itself a design problem."
- 마우스 캡처가 우클릭 붙여넣기를 막는다는 중복 이슈도 있습니다. — [#53380 (중복 링크 #52463)](https://github.com/openai/codex/issues/53380)
- 비동기 질문 편집기에서는 텍스트 복사와 스크린샷 붙여넣기가 안 됩니다. — [#51306](https://github.com/openai/codex/issues/51306)

**한글 IME (한국어 사용자 대상인 Aquila Agents에 특히 중요)**

- Claude Code에서 한글 IME 이슈가 다수 보고됐습니다. 보고자들은 Claude Code의 raw-mode TUI가 IME 조합이 끝나기 전에 키를 가로채는 것을 원인으로 지목합니다. 같은 터미널의 일반 셸에서는 정상이라고 합니다. 2026년 8~9월 macOS 보고 "macOS Korean Hangul IME composition is a daily usability blocker"도 있습니다. 증상은 다음과 같습니다. — [#40809](https://claudeissues.com/issue/40809-korean-ime-input-broken-hangul-characters-not-composing-in-terminal), [#87869](https://claudeissues.com/issue/87869-macos-korean-hangul-ime-composition-is-a-daily-usability-blocker-for-cli-real-ti), [#62969](https://claudeissues.com/issue/62969-bug-korean-hangul-ime-last-syllable-dropped-on-space-punctuation-in-input), [#40291](https://claudeissues.com/issue/40291-korean-ime-all-ctrl-key-shortcuts-silently-ignored-when-hangul-input-is-active), [#43720](https://claudeissues.com/issue/43720-korean-ime-pre-edit-composition-not-visible-in-idle-state-raw-mode-issue), [#35857](https://claudeissues.com/issue/35857-korean-ime-composition-renders-incorrectly-characters-jump-during-composition)
  - 자모가 분리됩니다(ㄱ ㅏ ㄴ ㅏ).
  - 스페이스나 문장부호를 누르면 마지막 음절이 사라집니다.
  - 한글 입력 상태에서는 모든 Ctrl 단축키가 무시됩니다.
  - 대기 상태에서 조합 중인 글자(pre-edit)가 보이지 않습니다.
  - 조합 중 글자가 튑니다.
- cmux(libghostty 기반)에서도 Fn 키를 누른 뒤 한글 조합이 깨진다는 보고가 있습니다. 즉 호스트 터미널도 IME 버그의 원인이 될 수 있습니다. — [#37419 cmux](https://claudeissues.com/issue/37419-cmux-korean-ime-composition-broken-jamo-separated-after-fn-key-press)
- ghostty-web(xterm.js 계열 웹 터미널)에 IME 관련 PR이 있습니다(세부 내용 미확인). — [coder/ghostty-web PR 120](https://gh.r-mj.com/coder/ghostty-web/pull/120)
- 커뮤니티 우회 도구 "claude-ime"는 pty로 감싸고 UTF-8 경계를 버퍼링하는 방식이라고 합니다(검증 안 됨). — [claude-ime](https://docs.rs/crate/claude-ime/0.2.0)

**알림·자리 비움·원격 확인**

- cmux 저자가 밝힌 개발 동기: Claude Code 알림 본문이 항상 "Claude is waiting for your input"이라 맥락이 없고, 탭이 많으면 제목도 읽을 수 없었습니다. — [cmux README](https://github.com/manaflow-ai/cmux)
- HN의 freedomben: "it's very easy to forget about one and have it paused waiting for confirmation." — [HN Conductor](https://news.ycombinator.com/item?id=44594584)
- Claude Code에는 `/remote-control`(`/rc`) 기능이 있습니다. 실행 중인 로컬 세션을 claude.ai/code나 모바일 앱에 QR로 연결해 권한 승인과 완료 알림을 받을 수 있습니다. — [pasqualepillitteri](https://pasqualepillitteri.it/en/news/316/claude-code-remote-control-mobile), [inventivehq](https://inventivehq.com/blog/claude-code-from-your-phone-remote)
- 하지만 2026년 4~6월에는 폰에서 승인해도 호스트 TUI가 계속 대기한다는 버그가 여러 건 보고됐습니다(현재 상태 미확인). — [#52084](https://claudeissues.com/issue/52084-remote-control-approving-permission-from-phone-hangs-claude-code-on-host), [#61177](https://claudeissues.com/issue/61177-remotecontrol-permission-approval-from-mobile-app-hangs-session-indefinitely), [#59855](https://claudeissues.com/issue/59855-remote-control-android-approvals-do-not-unblock-local-claude-code-tui-host-stays)
- 푸시 알림에서 바로 Approve/Deny를 누르게 해달라는 요청과 모바일 동반 앱 요청이 있습니다. ntfy/Pushover 훅 방식은 알림만 되고 승인은 안 된다는 지적도 있습니다. — [#62458](https://claudeissues.com/issue/62458-feature-request-actionable-approve-deny-on-mobile-push-for-permission-prompts), [#60433](https://claudeissues.com/issue/60433-feature-mobile-notification-and-remote-approval-for-permission-prompts), [#58029](https://claudeissues.com/issue/58029-feature-mobile-companion-app-to-control-claude-code-sessions-remotely)

### Inferences

- **호스트 앱이 해결할 수 있는 것(우선순위 높음)**
  - **맥락 있는 알림**: 프로젝트 이름, 세션 이름, 마지막 출력이나 훅 메시지 요약을 넣고, 클릭하면 해당 탭으로 이동합니다.
  - **"승인 대기" 상태 강조**: 사이드바 링이나 배지, 읽지 않은 항목으로 바로 가는 단축키(cmux의 ⌘⇧U에 해당).
  - **이미지 붙여넣기 보조**: ⌘V 시 클립보드가 이미지이면 임시 파일로 저장하고 경로를 입력에 넣습니다. 드래그앤드롭도 같은 방식으로 처리합니다.
  - **긴 출력 복사**: xterm 버퍼에서 "마지막 응답 복사"나 "선택 영역을 Markdown으로 복사"를 제공합니다.
  - **스크롤 고정 / "맨 아래로" 버튼**: 사용자가 위로 스크롤하면 자동 스크롤을 멈춥니다.
- **IME**: xterm.js에서 한글 조합을 직접 검증해야 합니다. 조합 중 Enter·Space·Ctrl 처리와 pre-edit 표시 위치가 대상입니다. 조합 중에는 입력을 pty에 보내지 않고 확정된 뒤에 보내는 방식이 원인 일부를 완화할 수 있습니다. 다만 CLI의 raw-mode 문제는 남습니다(추정).
- **멀티라인 입력 박스**: 호스트 쪽 별도 입력창에서 IME를 안정적으로 처리한 뒤 확정된 텍스트를 한 번에 붙여넣는 선택 기능은 IME 문제와 멀티라인 문제를 함께 해결할 수 있는 후보입니다(추정, 검증 필요).
- **해결 불가 또는 부분 완화만 가능한 것**
  - Ink 리렌더링으로 인한 깜빡임 자체.
  - Codex 출력이 장황한 것.
  - CLI 내부의 붙여넣기 키 해석.
  - Remote Control 버그.
  - 단, GPU 렌더러(xterm WebGL addon), 동기화 출력(DEC 2026) 지원, 리사이즈 디바운스로 체감을 줄일 수는 있습니다.

### Gaps

- GitHub 반응(👍) 수 기준 정확한 순위는 얻지 못했습니다. 검색 도구가 반응 수를 노출하지 않았고 claudeissues.com에는 접속하지 못했습니다.
- 리사이즈 시 화면 깨짐과 장시간 세션의 메모리 사용에 대한 구체적 이슈는 이번에 수집하지 못했습니다.
- 권한 프롬프트 피로("너무 자주 묻는다")에 대한 대표 이슈를 확보하지 못했습니다.

## 2. 래퍼/GUI(Conductor, Claude Squad, Crystal/Nimbalyst, opcode/Claudia, Claude Code 데스크톱, Warp, cmux)를 고르거나 떠난 이유

### Takeaway

사용자가 래퍼를 떠나는 이유는 다섯 가지로 모입니다.

1. 진짜 CLI의 느낌과 키바인딩을 잃는다.
2. 워크트리를 강제하면 .env 같은 gitignored 파일이 빠지고 PATH가 달라진다.
3. GitHub 권한을 요구하고 다시 클론해야 한다.
4. Electron/Tauri 앱이 느리다.
5. 유지보수가 멈추거나 서비스가 종료된다.

선택하는 이유는 여러 세션을 한 화면에서 보는 것, 맥락 있는 알림, 리뷰·diff, 설정이 필요 없다는 점입니다. Aquila Agents의 "진짜 CLI를 pty에 임베드"하는 방향은 사용자들이 가장 원하는 지점과 정확히 맞습니다.

### Cited Findings

**Conductor**

- HN Show HN 반응. — [HN Conductor](https://news.ycombinator.com/item?id=44594584)
  - aantix: "I don't think I'm looking for an interface to replace CC - it's a great interactive terminal app." / "The key bindings should be exactly the same." / "Sadly, this is lost with conductor."
  - _1tem: "it requests Github permissions and clones the repo from Github" / "I wanted a simple git worktree manager for my existing, already-checked-out repository."
  - itsalotoffun: "Full read-write access required to all your Github account's repos."
  - gleenn: "every time I have to re-download the universe."
  - cahaya: "If Conductor would work with local branches I would switch from Crystal."
  - jerezzprime: "all the tools for background/multiplexing are always built around a single repo."
- 같은 스레드에서 워크트리 회의론과 긍정론이 섞여 있습니다. — [HN Conductor](https://news.ycombinator.com/item?id=44594584)
  - oc1: "overcomplicating most workflows"
  - zachrip: "I really didn't like them as much as I thought I would."
  - pjm331: "they don't include things that are not tracked by git" (.env)
  - 반면 redhale: "Worktrees completely solve that problem."
- 가격 수용성: csomar는 "People on 100-200/month claude code subscription wouldn't mind paying 10-30 bucks for this."라고 했습니다. — [HN Conductor](https://news.ycombinator.com/item?id=44594584)
- Conductor는 Meta 합류로 신규 가입을 닫았고 2027년 초까지만 기존 사용자를 지원한다고 경쟁사 블로그들이 보도했습니다(1차 출처 미확인). — [agentastic](https://www.agentastic.dev/alternatives/conductor), [paradev](https://paradev.com/compare/conductor-alternative), [nimbalyst](https://nimbalyst.com/blog/best-conductor-alternatives-2026/)

**Crystal / Claude Squad**

- Crystal을 쓰는 이유: SOLAR_FIELDS는 "no custom config files I have to think about and manage"라고 했습니다. — [HN Conductor](https://news.ycombinator.com/item?id=44594584)
- Crystal은 Nimbalyst로 이어졌고, Claude Squad는 tmux와 워크트리 기반 TUI(AGPL)입니다. — [augmentcode](https://www.augmentcode.com/tools/open-source-agent-orchestrators), [nimbalyst](https://nimbalyst.com/blog/best-conductor-alternatives-2026/)

**cmux**

- 28.8k stars를 받았습니다. 저자의 말: "most of them were Electron/Tauri apps and the performance bugged me" / "GUI orchestrators lock you into their workflow". 구현은 Swift/AppKit과 libghostty입니다. — [cmux README](https://github.com/manaflow-ai/cmux)
- 주요 기능은 다음과 같습니다. 대부분 Aquila Agents 로드맵과 직접 겹치는 경쟁 기준선입니다. — [cmux README](https://github.com/manaflow-ai/cmux)
  - 사이드바에 git 브랜치, PR 상태, cwd, 리스닝 포트, 최신 알림 텍스트 표시
  - 알림 링과 배지, 알림 패널
  - `cmux.json` 커스텀 명령을 command palette에서 실행
  - 세션 복원(레이아웃, cwd, 스크롤백)
  - Ghostty 설정 호환
  - 소켓 API
- macOS 14 이상만 지원합니다. — [vibecoding cmux review](https://vibecoding.app/blog/cmux-review)

**opcode/Claudia**

- 이름이 opcode로 바뀌었고 22k stars 수준이지만 "not being actively maintained"라는 이유로 이탈한다고 합니다. 이 평가는 Nimbalyst 쪽 글입니다. — [dev.to (Nimbalyst 작성)](https://dev.to/stravukarl/best-opcode-alternatives-in-2026-23oa)
- 초기 평가는 "suffers from bugs and performance issues"였습니다. — [itsfoss](https://itsfoss.com/claudia/)
- opcode에도 PATH 관련 이슈가 있었습니다. — [opcode #58](https://github.com/winfunc/opcode/issues/58)

**Claude Code 데스크톱 앱 (공식)**

- 2026-04-14 리디자인으로 멀티 세션 사이드바, 드래그 가능한 패널, 통합 터미널·diff가 들어갔고 세션별 워크트리가 기본값입니다. — [Anthropic 블로그](https://claude.com/blog/claude-code-desktop-redesign?via=toools), [devtoolpicks](https://devtoolpicks.com/blog/claude-code-desktop-redesign-parallel-sessions-2026)
- vanja.io(2026년 하반기 추정)는 데스크톱 프리뷰를 써본 뒤 터미널로 돌아갔습니다. — [vanja.io](https://vanja.io/claude-code-gui-vs-terminal-a-tale-of-two-workflows/)
  - "The Worktree From Hell": gitignored 파일이 없어 DB에 연결되지 않습니다("nothing works").
  - 셸과 PATH가 달라집니다.
  - 워크트리와 브랜치 정리를 사용자가 직접 해야 해서 "graveyard of abandoned Claude sessions"가 생깁니다.
  - 결론: "Terminal + Opus. Not even close."
- 데스크톱 앱에도 PATH를 툴 환경에 적용하지 않는 이슈가 있었습니다. — [claudeissues #42248](https://claudeissues.com/issue/42248-desktop-app-macos-ignores-path-from-all-sources-read-tool-cannot-find-poppler-pd)

**Warp**

- 로그인 필수 정책은 2024년 11월에 해제됐습니다(AI 기능만 로그인 필요). 당시 반응: "why do I need an account to use a terminal app?", "For something so fundamental as a terminal app, that was a hard no." — [Warp 블로그](https://www.warp.dev/blog/lifting-login-requirement), [itsfoss](https://itsfoss.com/news/warp-terminal-no-login/)
- 메모리는 200~400MB로 Ghostty·Alacritty(50~100MB)보다 많다는 리뷰가 있습니다(측정 방법 불명). 온보딩 설문 마찰에 대한 불만도 있습니다. — [aicoolies](https://aicoolies.com/reviews/warp-review), [Product Hunt](https://www.producthunt.com/products/warp?page=2)

### Inferences

- Aquila Agents가 지켜야 할 차별점은 네 가지입니다.
  - 진짜 CLI와 동일한 키바인딩을 유지합니다(앱 단축키가 ⌃ 계열 CLI 키와 충돌하지 않도록).
  - 사용자의 기존 체크아웃을 그대로 씁니다(GitHub 권한·재클론 없음, 워크트리는 선택 사항).
  - 사용자 셸 환경(PATH, .env)을 그대로 유지합니다.
  - 계정이나 로그인 없이 동작합니다.
- 워크트리를 도입한다면 다음 세 가지를 갖춰야 합니다.
  - .env 같은 gitignored 파일 복사 옵션
  - 정리(삭제) UI
  - "로컬 브랜치 사용" 기본값
- Electron이라는 점 자체가 cmux 지지층에게는 감점 요인입니다. 메모리와 시작 속도를 측정하고 공개하거나 체감을 최적화해야 합니다. 예: 숨겨진 탭의 렌더러 일시정지, WebGL 렌더러.

### Gaps

- Reddit(r/ClaudeAI, r/ClaudeCode, r/macapps) 원문 스레드는 검색 도구에서 나오지 않아 인용하지 못했습니다.
- Nimbalyst·Crystal에 대한 실사용자 이탈 사유와 Conductor 종료의 1차 발표문은 확보하지 못했습니다.

## 3. 온보딩과 발견성 (빈 상태, 첫 실행, CLI 감지, Finder 실행 시 PATH, 로그인, 단축키 안내, 커맨드 팔레트, 설정 UI vs JSON)

### Takeaway

Electron이나 데스크톱 앱이 Finder·Dock에서 실행되면 로그인 셸의 PATH를 상속받지 못해 `claude`/`codex`를 찾지 못합니다. 첫 실행에서 가장 확실하게 실패하는 지점입니다. Claude 공식 데스크톱 앱, opcode, 다른 래퍼에서도 반복 보고됐습니다. 팔레트·커스텀 명령·설정 파일 없이 동작하는 것은 경쟁 제품(cmux, Crystal)이 기본으로 내세우는 요소입니다.

### Cited Findings

- macOS GUI 앱은 launchd의 최소 PATH만 받습니다. 표준 해결책은 시작할 때 로그인 셸에서 PATH를 읽어오는 `fix-path`(sindresorhus) 또는 비동기 initializeShellPath입니다. — [fix-path](https://openapps.pro/packages/fix-path), [flaviocopes](https://flaviocopes.com/macos-app-command-line-tools-path.md), [Auto-Claude PR #399](https://github.qingwei-s.workers.dev/AndyMik90/Auto-Claude/pull/399)
- 주의점: fix-path가 패키지 빌드에서 통하지 않았다는 보고와 Dock에서 종료가 안 된다는 이슈가 있습니다. — [fix-path #11](https://github.com/sindresorhus/fix-path/issues/11)
- 다른 프로젝트는 설정에서 `claude` 바이너리 절대경로를 지정하는 우회책을 씁니다. — [paseo troubleshooting](https://paseo.sh/docs/troubleshooting.md), [opcode #58](https://github.com/winfunc/opcode/issues/58)
- Claude 공식 데스크톱 앱도 셸 PATH를 툴 환경에 적용하지 않는다는 이슈가 있습니다. VS Code 확장에서는 됐습니다. — [#42248](https://claudeissues.com/issue/42248-desktop-app-macos-ignores-path-from-all-sources-read-tool-cannot-find-poppler-pd)
- vanja.io도 데스크톱에서 띄운 프로세스의 셸 설정이 달라 명령이 실패했다고 지적합니다. — [vanja.io](https://vanja.io/claude-code-gui-vs-terminal-a-tale-of-two-workflows/)
- 설정이 필요 없는 것이 선택 이유로 꼽힙니다. Crystal은 "no custom config files I have to think about"이라는 평을 받았습니다. — [HN](https://news.ycombinator.com/item?id=44594584)
- cmux는 JSON(`cmux.json`) 커스텀 명령을 command palette에서 실행하고, 단축키를 많이 제공하며, 세션을 복원합니다. — [cmux README](https://github.com/manaflow-ai/cmux)
- 첫 실행 시 강제 로그인이나 설문은 반발을 부릅니다(Warp 사례). — [itsfoss](https://itsfoss.com/news/warp-terminal-no-login/), [Product Hunt Warp](https://www.producthunt.com/products/warp?page=2)
- Conductor는 GitHub 권한을 요구하는 온보딩 때문에 이탈이 생겼습니다(2번 항목 참조). — [HN](https://news.ycombinator.com/item?id=44594584)

### Inferences

- **첫 실행 체크리스트(Aquila Agents용)**
  1. 로그인 셸(`$SHELL -ilc 'echo $PATH'`)로 PATH를 복원합니다.
  2. `claude`, `codex`, `git`의 존재와 버전을 감지해 초록 체크로 보여줍니다.
  3. 없으면 설치 명령(npm/brew)을 복사할 수 있는 버튼과 "경로 직접 지정"을 제공합니다.
  4. 로그인 상태(`claude` 첫 실행 시 /login)는 CLI 안에서 진행하도록 안내만 합니다. 래퍼가 인증을 대신하지 않습니다.
  5. "폴더 추가"(드래그앤드롭, 최근 git 저장소 제안)로 첫 프로젝트를 만듭니다. ~/.aquila/config.json을 직접 편집하게 하지 않습니다.
- **빈 상태**: 프로젝트가 없을 때와 세션이 없을 때를 따로 설계하고, 주요 동작 2~3개와 단축키 힌트를 함께 보여줍니다.
- **⌘K 팔레트**: 모든 동작, 프로젝트·세션 점프, 설정 검색을 한곳에서 하고 각 항목 옆에 단축키를 표시해 학습을 돕습니다. ⌘/로 단축키 시트를 엽니다.
- **설정**: UI를 기본으로 하되 "JSON 열기" 탈출구를 남깁니다. 파워 유저는 파일을 선호하고(cmux.json, Ghostty 설정), 일반 사용자는 UI를 선호합니다.

### Gaps

- 개발자 데스크톱 앱 온보딩에 대한 정량 연구(이탈률 등)는 찾지 못했습니다.
- 커맨드 팔레트 사용률 데이터도 찾지 못했습니다.

## 4. 사용자가 알아차리는 macOS 완성도

### Takeaway

네이티브 앱을 고르는 사용자는 다섯 가지를 직접 언급합니다: 빠른 시작, 낮은 메모리, 전역 핫키·퀘이크 창, 자동 업데이트, 접근성(깜빡임). Electron 앱은 이 부분에서 의심받는 출발점에 있습니다. 한국어 사용자에게는 IME 안정성이 가장 체감되는 품질 요소입니다.

### Cited Findings

- cmux는 "Built with Swift and AppKit, not Electron", "Fast startup, low memory"를 마케팅 포인트로 씁니다(벤치마크 없음). — [cmux README](https://github.com/manaflow-ai/cmux)
- Ghostty의 Quick Terminal은 화면 위에서 내려오는 전역 핫키 창입니다. 예: `keybind = global:ctrl+\`=toggle_quick_terminal`. — [Ghostty features](https://ghostty.org/docs/features), [azerkoculu](https://azerkoculu.com/posts/ghostty-quick-terminal)
  - macOS에서는 손쉬운 사용(Accessibility) 권한이 필요합니다.
  - 일부 사용자는 Hammerspoon으로 우회했습니다.
  - 공식 문서에는 auto-update가 기본 기능으로 나와 있습니다.
- 메모리를 비교한 리뷰: Warp 200~400MB, Ghostty·Alacritty 50~100MB(측정 조건 불명). — [aicoolies](https://aicoolies.com/reviews/warp-review)
- 접근성: Claude Code의 깜빡이는 thinking 표시가 섬광 민감 사용자에게 문제라는 보고가 있습니다. — [#769](https://github.com/anthropics/claude-code/issues/769)
- cmux의 알림 UX: pane 링, 탭 점등, 데스크톱 알림, 읽지 않은 알림으로 점프. OSC 9/99/777 표준 시퀀스와 훅을 통합합니다. — [cmux README](https://github.com/manaflow-ai/cmux)
- 한글 IME는 macOS에서도 "daily usability blocker"로 보고됩니다. 호스트 터미널(cmux)에도 버그가 있습니다. — [#87869](https://claudeissues.com/issue/87869-macos-korean-hangul-ime-composition-is-a-daily-usability-blocker-for-cli-real-ti), [#37419](https://claudeissues.com/issue/37419-cmux-korean-ime-composition-broken-jamo-separated-after-fn-key-press)

### Inferences

- **Aquila Agents 우선순위(추정)**
  1. 한글 IME를 xterm.js에서 철저히 검증합니다. 대상은 조합 표시, Enter·Space 확정, Ctrl 단축키, ⌘ 단축키와 조합 상태가 섞이는 경우입니다.
  2. **Dock 배지**: 승인 대기 세션 수를 `app.dock.setBadge`로 표시하고, 승인 대기가 생기면 `app.dock.bounce('informational')`를 선택적으로 호출합니다.
  3. **알림**: OSC 9/777을 지원하고 Claude 훅을 연결합니다. 알림 본문에 프로젝트와 세션 이름을 넣고, 클릭하면 포커스를 옮깁니다.
  4. **네이티브 메뉴 바**: File/Edit/View/Window/Help, 표준 ⌘ 단축키, Window 메뉴의 세션 목록.
  5. **창**: `titleBarStyle: 'hiddenInset'` 신호등과 사이드바 상단 밴드를 정렬하고(이미 `--size-titlebar` 규칙이 있음), 전체 화면과 창 위치·크기를 복원합니다.
  6. **시스템 테마**: `nativeTheme`로 라이트·다크를 따르고 터미널 팔레트도 함께 전환합니다.
  7. **자동 업데이트**: electron-updater나 Sparkle 계열. 서명·공증이 없으면 Gatekeeper 경고 때문에 첫 실행부터 실패합니다.
  8. **선택적 전역 핫키·퀘이크 창**: Accessibility 권한 안내 포함.
  9. **성능**: 백그라운드 탭의 렌더 일시정지, 유휴 CPU 0%에 가깝게, 메모리 표시.
  10. **접근성**: reduce-motion 존중(이미 전역 규칙 있음), 상태 점을 색만으로 구분하지 않기, VoiceOver 레이블.

### Gaps

- macOS 사용자가 Dock 배지, 메뉴 바, 신호등 위치 같은 세부 요소를 평가한 출처(r/macapps 등)는 이번 검색에서 얻지 못했습니다. 위 체크리스트는 업계 관례에 기반한 추론입니다.
- Electron 터미널 앱(Hyper, Wave 등)의 메모리·배터리 실측 비교 데이터는 찾지 못했습니다.
- Sparkle과 electron-updater에 대한 사용자 선호 근거는 없습니다.
