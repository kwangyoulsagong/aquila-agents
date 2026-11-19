# 여러 AI 코딩 에이전트의 상태 표시와 알림: 사용자는 어떻게 주의를 관리하나 (Aquila Agents용)

조사 기준일: 2026-11-19. 출처는 공식 문서, GitHub 이슈(claudeissues.com 미러 포함), 제품 문서, 사용자 커뮤니티 글이다. claudeissues.com은 anthropics/claude-code 이슈를 옮겨 둔 미러다. 이번 조사에서 이 사이트는 직접 열리지 않았고(DNS 실패), 이슈 내용은 검색 결과 스니펫으로만 확인했다.

## Q1. 각 도구는 "사용자가 필요함"과 "끝남"을 어떻게 알리고, 사용자 반응은 어떤가

### Takeaway

도구들은 비슷한 모델로 모이고 있다. 상태는 working / needs-input(blocked) / done / failed / idle, 여기에 stopped까지 둔다. 알림은 "창이 안 보일 때만" 보낸다. 받은 알림은 한 곳(받은편지함, 탭 배지, 독 배지)에 모으고, 그 세션으로 이동하면 읽음 처리한다. Claude Code는 hook 이벤트가 매우 풍부하지만 Notification hook의 타이밍과 신뢰성 문제가 많다. Codex는 2026년에 hook 시스템(PermissionRequest/Stop 등)이 GA되어, 이제 휴리스틱 없이도 상태를 판정할 수 있다.

### Cited Findings

**Claude Code (CLI 내장)**

- `claude agents`(agent view)의 상태 6종: Working(애니메이션), Needs input(노랑: 답변, 권한 결정, 샌드박스 프롬프트), Idle(흐림), Completed(초록), Failed(빨강), Stopped(회색). 목록 그룹은 `Pinned`, `Ready for review`, `Needs input`, `Working`, `Completed` 순이다. JSON `state`는 `working|blocked|done|failed|stopped`. — [Claude Code docs: agent view](https://code.claude.com/docs/en/agent-view)
- agent view가 열려 있으면 백그라운드 세션이 입력을 기다리기 시작하거나, 끝나거나, 실패할 때 터미널 알림 채널로 알린다. `/loop` 세션은 입력이 필요할 때만 알린다. 이때 Notification hook이 `agent_needs_input` / `agent_completed` 타입으로 발화한다. — [agent view](https://code.claude.com/docs/en/agent-view)
- 주의를 끄는 보조 장치: 탭 제목을 `2 awaiting input · claude agents`로 바꾸고, 일반 세션 하단에 대기 수(`← 2 agents`)를 약 10초마다 갱신해 보여 준다. 성공으로 끝난 경우에는 `← 2 done`이 잠깐 뜬다. `prefersReducedMotion`이 켜져 있으면 숨긴다. — [agent view](https://code.claude.com/docs/en/agent-view)
- 대기 세션으로 가는 방법: `Alt+↑/↓`로 그룹 헤더 이동, `s:blocked` 필터("everything waiting on you"), `Space`로 peek 패널을 열어 대기 중인 질문을 보고 숫자키+Enter로 바로 답하기, `Alt+1..9`로 세션 attach. "다음 대기 세션으로 점프" 전용 단축키는 문서에 없다. — [agent view](https://code.claude.com/docs/en/agent-view)
- Hook 이벤트 전체 목록에는 `PermissionRequest`, `PermissionDenied`, `PostToolUseFailure`, `Notification`, `Stop`, `StopFailure`, `SubagentStop`, `TeammateIdle`, `Elicitation`, `SessionEnd` 등이 있다. — [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- Notification matcher 값: `permission_prompt, idle_prompt, auth_success, auth_storage_failure, elicitation_dialog, elicitation_url_dialog, elicitation_complete, elicitation_response, agent_needs_input, agent_completed, quota_auto_resume_*, plugin_notification`. Notification hook은 아무것도 막을 수 없다(exit code 무시). — [hooks](https://code.claude.com/docs/en/hooks)
- `StopFailure`는 API 오류로 턴이 끝날 때 발화한다. matcher는 `rate_limit, authentication_failed, billing_error, server_error, max_output_tokens, ...`. `Stop`/`SubagentStop`은 `last_assistant_message`를 받는다. — [hooks](https://code.claude.com/docs/en/hooks)
- `PermissionRequest` hook은 tool 이름으로 매칭하고, `decision.behavior`로 `allow|deny`를 돌려줄 수 있다. — [hooks](https://code.claude.com/docs/en/hooks)
- `permission_prompt` Notification은 "사용자가 약 6초간 타이핑하지 않았을 때" 발화한다. 터미널에서는 프롬프트가 뜰 때 타이머가 시작되고, 키를 누를 때마다 연기된다. `preferredNotifChannel`(`notifications_disabled` 포함)은 알림 방식만 바꾸며 hook 실행 여부와는 무관하다. — [hooks](https://code.claude.com/docs/en/hooks)

**Codex CLI**

- 내장 TUI 알림은 `[tui] notifications = ["agent-turn-complete","approval-requested"]`(또는 `true`)로 켠다. `notification_method`는 `auto`(OSC 9 우선, 안 되면 BEL), `osc9`, `bel`. 터미널에 포커스가 있으면 기본으로 억제되고, v0.119.0부터 끌 수 있다(정정 2026-11-19: 실제 키는 `notification_condition = "always"`이고, `focused_notifications`는 codex 0.169.1 바이너리에 없다). — [Daniel Vaughan: Codex notification pipeline](https://codex.danielvaughan.com/2026/04/13/codex-cli-notification-pipeline-osc9-hooks-alerts/)
- 외부 `notify` 명령은 `agent-turn-complete`에만 발화한다. JSON 인자에 `type`, `turn-id`, `input-messages`, `last-assistant-message`가 들어 있다. approval-requested에는 발화하지 않는다(이슈 #11808, #14813). 속도 제한이나 중복 제거가 없어서 서브에이전트 완료가 몰리면 알림이 쏟아질 수 있다. — [같은 글](https://codex.danielvaughan.com/2026/04/13/codex-cli-notification-pipeline-osc9-hooks-alerts/); WSL2 approval 알림 실패: [openai/codex#8189](https://github.com/openai/codex/issues/8189)
- Codex hooks 이벤트 14종: `SessionStart, SessionEnd, SubagentStart, SubagentStop, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PreModelRequest, PostModelRequest, PreCompact, PostCompact, Stop, Interrupt`. 설정 위치는 `$CODEX_HOME/hooks.json`, `.codex/hooks.json` 또는 `config.toml`의 `[hooks]`. 기본으로 켜져 있지만, 관리되지 않는 hook은 `/hooks`에서 검토하고 신뢰해야 실행된다. — [OpenAI Codex hooks docs](https://learn.chatgpt.com/docs/hooks)
- Codex `PermissionRequest`는 "Codex가 승인을 요청하려는 시점"(셸 권한 상승, 네트워크 승인)에 실행된다. 결정을 돌려주지 않으면 원래 프롬프트가 그대로 진행된다. Notification이나 idle 이벤트는 없고, `Interrupt`는 사용자가 턴을 중단할 때 발화한다. `SessionEnd`는 정상 종료 때와 30분 idle 후에도 발화한다. — [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- PermissionRequest hook 지원은 2026-04-17 커밋으로 추가됐다(#17563). — [Codex hooks 검색 결과 요약 / git mirror](https://git.halfakop.ru/mirrors/codex/commits/commit/6e9e2c2eef2f4a1d282bb024323633a138a17aa8/codex-rs/hooks/schema)

**cmux (macOS 네이티브 에이전트 터미널)**

- 에이전트가 OSC 9 / OSC 99 / OSC 777 시퀀스를 보내거나 hook에서 `cmux notify`를 부르면 해당 pane에 파란 링이 그려진다. 터미널이 포커스 밖이면 데스크톱 알림을 보내고 탭에 unread 배지를 단다. 예: `cmux notify --title "Claude Code" --subtitle "Waiting" --body "Agent needs input"`. — [cmux docs: notifications](https://cmux.com/docs/notifications)
- 2026-02-19 Show HN에서 2위까지 올랐다. HN 댓글의 핵심 페인 포인트는 "pane을 오가지 않고 어떤 병렬 에이전트가 주의가 필요한지 아는 것"이었다. — [cmux blog](https://cmux.com/blog/show-hn-launch); [HN mirror](https://frontpage-app.vercel.app/show/47079718). 댓글은 잘린 미러로만 확인했다.

**Warp**

- 다른 탭의 에이전트가 주의가 필요하면 창 모서리에 토스트(몇 초 후 자동 사라짐)가 뜨고, 그 탭에 attention 배지가 붙는다. 우상단 종 아이콘으로 여는 "mailbox" 사이드바는 All tabs / Unread / Errors 필터를 제공한다. 에이전트 탭으로 이동하면 자동으로 읽음 처리된다. 카테고리는 Request(blocked), Error, Complete. — [Warp docs: agent notifications](https://docs.warp.dev/agents/capabilities/agent-notifications/)
- Claude Code 2.1.139 이후 Warp에서 완료, 입력 필요, 오류 알림이 끊겼다는 이슈가 있다(#10715). 메인테이너는 구조화된 CLI 상태 이벤트를 받지 못하는 것으로 추정했다. 외부 CLI의 출력이나 이벤트에 기대는 통합은 CLI 업데이트에 취약하다는 사례다. — [warp#10715](https://upd.dev/warpdotdev/warp/issues/10715)

**Superset/Paradev (워크스페이스형 에이전트 앱)**

- 사이드바 워크스페이스 항목에 실행 중 상태를 인라인으로 표시한다. 질문, 도구 승인, 플랜 리뷰 요청이 오면 워크스페이스에 "needs attention" 플래그를 단다. macOS 독 아이콘 배지는 unread 활동이나 주의가 필요한 워크스페이스 수를 보여 준다. 사운드는 설정에서 고른다. 강제 종료 등으로 상태가 남으면 "Clear Status"로 수동 초기화한다. — [Paradev docs: agent status](https://docs.paradev.com/agent-status)
- 상태 감지는 자체 env 변수가 있을 때만 동작하는 lifecycle hook을 에이전트 설정에 설치하는 방식이다. 에이전트마다 지원 범위가 달라서, Claude Code는 완료와 대기를 모두 보고하지만 일부 에이전트는 완료만 보고한다. — [Paradev docs](https://docs.paradev.com/agent-status)

**crystl (Claude Code용 터미널)**

- 승인 요청을 가로채 화면에 떠 있는 승인 카드로 보여 준다. 카드에는 tool, 파일·명령, Allow/Deny가 있고 프로젝트 색으로 빛나며, 포커스를 빼앗지 않는다. 여러 건이 쌓이면 "Allow All" 바가 생긴다. 세션 레일은 active / idle / waiting을 실시간으로 표시한다. — [crystl blog: tab-hunting](https://crystl.dev/blog/tab-hunting-approval/)
- 이 글이 거부하는 우회책: 전부 자동 승인(파괴적 명령을 놓친다), 분할 pane(너무 작다), 탭 이름 붙이기(대기 여부는 안 보인다). — [같은 글](https://crystl.dev/blog/tab-hunting-approval/)

**기타 (Conductor, Claude Squad, vibe-kanban 등)**

- Vibe Kanban은 사이트에서 서비스 종료(sunsetting)를 공지했고, 커뮤니티 오픈소스로 계속된다. — [vibekanban.com](https://vibekanban.com/)
- Band는 "needs attention"(작업이 끝났거나 사람 입력이 필요함)을 정적 점으로 표시한다. tmux-overmind는 주의가 필요할 때 노란 기호를 쓰고, 실행 중인 에이전트가 없으면 표시를 숨긴다. — [Band docs](https://band-docs.pages.dev/docs/agent-status); [tmux-overmind](https://awesome.ecosyste.ms/projects/github.com%2Foksure%2Ftmux-overmind)

### Inferences

- 업계 표준 상태 집합은 Claude agent view와 거의 같다(working / blocked / done / failed / stopped / idle). Aquila Agents의 waiting > error > working > done > idle 우선순위는 이와 맞는다. 다만 "stopped(사용자가 중단하거나 외부에서 종료)"와 "error(실패)"는 구분하는 편이 좋다. Ctrl+C로 끝낸 세션을 빨강으로 보이면 오탐이 된다.
- 알림을 한 곳에 모으는 방식(Warp mailbox, 탭 배지, Paradev 독 배지, cmux unread 배지)은 이제 기본 기대치다. Aquila Agents의 점 표시만으로는 "지금 몇 개가 나를 기다리나"를 한눈에 알 수 없다.

### Gaps

- Conductor, Claude Squad, Crystal(stravu), Cursor background agents, GitHub Copilot coding agent, Devin의 구체적인 상태와 알림 UX는 이번 조사 예산 안에서 1차 출처를 확보하지 못했다.
- HN과 Reddit 원문 스레드는 직접 열람하지 못했다(미러와 2차 요약만 확인).

## Q2. 흔한 고통: 놓친 권한 프롬프트, 알림 스팸, 어느 세션인지 모름, 몇 시간 방치, 거짓 'done'

### Takeaway

가장 큰 비용은 "어느 탭이 나를 기다리는지 찾는 시간"과 "다시 맥락을 잡는 시간"이다. Claude의 Notification hook은 지연(약 6~8초, idle은 60초), 표면별 미발화, 회귀, 정보 부족, 스팸 문제를 반복해서 보고받고 있다. Notification 하나에 의존하면 안 되고, 여러 hook을 조합해 상태를 판정해야 한다.

### Cited Findings

- 사용자 체감 손실은 하루 15~20분이다. "맞는 pane을 찾고 나면 20분이 지나 있다." 더 큰 비용은 전환 후 재진입(5~10분)이라는 의견이 있다. 소리 알림은 헤드폰이나 깊은 집중 상태에서 묻히고, 에이전트별로 다른 차임을 쓰는 방식은 4개를 넘으면 한계가 온다. — [Product Hunt 토론: "Your AI agent is waiting for you"](https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this)
- 도구들이 "생각 중"과 "막힘"을 거의 구분하지 못한다는 불만이 있다. 승인 대기 세션이 생각 중인 세션과 똑같이 보여서 탭을 돌며 확인하게 되고, 멈춘 세션이 몇 분씩 방치된다. — [Product Hunt 토론](https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this); [crystl](https://crystl.dev/blog/tab-hunting-approval/)
- Notification hook 지연: permission 프롬프트가 뜬 뒤 약 8초 후에 발화한다는 보고(#43530), Stop보다 눈에 띄게 늦다는 보고(#23383), 호출 지연이 크다는 보고(#19627)가 있다. 공식 문서는 "약 6초 무입력 후, 키 입력 시 연기"라고 설명한다. — [#43530](https://claudeissues.com/issue/43530-notification-hook-fires-8-seconds-after-permission-prompt-appears); [#23383](https://claudeissues.com/issue/23383-notification-hook-has-noticeable-delay-compared-to-stop-hook); [hooks docs](https://code.claude.com/docs/en/hooks)
- 회귀: 2.1.141에서 thinking 도중 뜬 permission_prompt에 Notification이 발화하지 않는다(2.1.139에서는 정상, #58909). — [#58909](https://claudeissues.com/issue/58909-2-1-141-notification-permission-prompt-hook-event-stops-firing-during-active-thi)
- 표면별 미발화: VS Code 확장(#79881, #80530, #28774, #31285; 하나는 2026-08-20에 fixed로 닫힘)과 Desktop 앱(#81788, #84006)에서 permission_prompt/idle_prompt가 발화하지 않는다. 터미널 CLI에서는 동작한다. — [#79881](https://claudeissues.com/issue/79881-notification-hook-does-not-fire-in-vs-code-extension-permission-prompt-idle-prom); [#81788](https://claudeissues.com/issue/81788-notification-hooks-permission-prompt-idle-prompt-never-fire-in-desktop-app)
- idle_prompt 문제:
  - 60초 하드코딩으로 타임아웃 설정 요청이 있다(#13922).
  - idle 알림만 따로 끌 수 없다(#62538).
  - 백그라운드 서브에이전트가 아직 도는데도 idle이 발화한다(#93672).
  - 타이머 휴리스틱을 상태 기반 판정으로 바꾸자는 요청이 있다(#32634).
  - 반대로 "60초 idle이 전혀 안 뜬다"며 NOT_PLANNED로 닫힌 보고도 있다(#8320). 버전과 표면에 따라 동작이 다르다.
  - 출처: [#13922](https://claudeissues.com/issue/13922-feature-configurable-timeout-for-idle-prompt-notification-hook); [#62538](https://claudeissues.com/issue/62538-add-config-to-disable-idle-awaiting-input-reminder-notification-separately-from); [#93672](https://claudeissues.com/issue/93672-bug-notification-idle-prompt-fires-while-background-subagents-are-still-running); [#32634](https://claudeissues.com/issue/32634-feature-replace-idle-prompt-timer-heuristic-with-deterministic-state-aware-idle); [#8320](https://claudeissues.com/issue/8320-60-second-idle-notifications-not-triggering-in-notification-hook)
- 스팸과 불필요한 알림:
  - Opus 4.5 / v2.0.53에서 턴 진행 중에 iTerm2 알림이 과다하게 왔다(#12415).
  - auto-accept/yolo 모드 세션은 알림을 보내지 말라는 요청이 있다(#30233).
  - 세션이 이미 화면에 보이면 시스템 알림을 띄우지 말라는 요청이 있다(#53194).
  - 사용자가 일정 시간 비활성일 때만 알리는 지연 설정 요청이 있다(#25802).
  - 출처: [#12415](https://claudeissues.com/issue/12415-excessive-iterm2-notifications-during-active-turns-on-opus-4-5-v2-0-53); [#30233](https://claudeissues.com/issue/30233-bug-notifications-should-not-fire-in-auto-accept-yolo-mode-sessions); [#53194](https://claudeissues.com/issue/53194-feature-dont-trigger-system-notifications-when-the-claude-code-session-is-alread); [#25802](https://claudeissues.com/issue/25802-add-configurable-notification-delay-notify-only-after-user-inactivity)
- 정보 부족:
  - permission 이벤트에 `notification_type`이 빠져 있다(#11964).
  - 어떤 tool이나 명령이 대기 중인지 페이로드에 없어서, 더 풍부한 권한 알림을 요청하는 이슈가 있다(#84801, #32952, #29827 참조).
  - AskUserQuestion용 알림 요청이 있다(#13830).
  - 출처: [#11964](https://claudeissues.com/issue/11964-bug-notification-hook-events-missing-notification-type-field); [#84801](https://claudeissues.com/issue/84801-feature-richer-permission-prompt-notifications-sharing-a-workaround-ref-32952-29); [#13830](https://claudeissues.com/issue/13830-feature-request-add-notification-hook-support-for-askuserquestion-events)
- 일반 hook은 어느 세션이 보낸 것인지 알려 주지 않는다는 불만이 있다. 해법으로 클릭하면 해당 tmux pane으로 점프하는 도구(ccn), 대기 세션 수를 메뉴바에 보여 주는 도구(Claude Code Notifier)가 나왔다. 여러 프로젝트를 한 대시보드로 보자는 요청(#26394)과 멀티탭 알림 팔레트 요청(#38143)도 있다. — [bupd/ccn](https://github.com/bupd/ccn); [dev.to ccnotifier](https://dev.to/ccnotifier/how-i-stopped-losing-time-to-stalled-claude-code-sessions-28ji); [#26394](https://claudeissues.com/issue/26394-feature-request-central-dashboard-to-monitor-multiple-claude-code-instances-acro); [#38143](https://claudeissues.com/issue/38143-notification-palette-for-multi-tab-attention-management)
- 제목과 진행률 신호도 불안정하다.
  - 상태 감지 도구(herdr)는 OSC 제목의 idle 마커로 상태를 봤는데, 2026-06 업데이트 후 Claude가 턴 종료 때 그 마커를 내보내지 않아 감지가 깨졌다(#68643).
  - OSC 9;4 진행 바는 도구 실행 중에 지워진다(#55111).
  - iTerm2에서는 idle인데도 탭 스피너가 계속 돈다(#62081).
  - 출처: [#68643](https://claudeissues.com/issue/68643-osc-title-not-emitting-idle-marker-after-turn-ends-breaks-herdr-status-detection); [#55111](https://claudeissues.com/issue/55111-bug-osc-9-4-progress-bar-clears-during-tool-execution-instead-of-staying-visible); [#62081](https://claudeissues.com/issue/62081-idle-session-still-triggers-iterm2-tab-activity-indicator-spinner)

### Inferences (Aquila Agents 현재 설계와 대조)

- **waiting 판정이 늦다.** Aquila Agents는 Notification hook으로 waiting을 잡으므로 permission 프롬프트를 최소 6~8초 늦게 감지한다. 사용자가 다른 세션에서 타이핑 중이면 더 늦어질 수 있다. 문서상 "키 입력 시 연기"는 그 세션 터미널 기준으로 보이지만 확인이 필요하다. **`PermissionRequest` hook(decision 없이 exit 0)을 waiting 트리거로 추가**하면 다이얼로그가 뜨는 시점에 바로 잡을 수 있다. 질문형은 `Notification` matcher `elicitation_dialog`와 `Elicitation`으로 보완한다.
- **waiting 해제 조건이 필요하다.** `PostToolUse`(승인 후 실행), `PermissionDenied`, `UserPromptSubmit`이 오면 waiting을 working으로 되돌려야 "이미 승인했는데 노란 점이 남는" 문제가 없다. 사용자가 프롬프트에서 Esc로 취소하면 hook이 없을 수 있으므로, 그 세션에 입력(키 입력)이 들어오면 waiting을 해제하는 보조 규칙도 필요하다.
- **`idle_prompt`는 waiting으로 쓰지 말 것.** done과 중복되고, 60초 지연에 스팸·오발화 보고가 많다. Stop을 받으면 이미 done이다.
- **error 판정이 비어 있다.** `StopFailure`(rate_limit, billing_error, server_error 등)를 error로 매핑해야 한다. 지금은 프로세스 비정상 종료만 error라서, API 오류로 멈춘 세션이 'done'으로 보이는 거짓 완료가 생긴다.
- **서브에이전트 오탐.** 백그라운드 서브에이전트나 `/loop` 사용 시 Stop 이후에도 실제로는 일이 남아 있을 수 있다(#93672 맥락). SubagentStart/SubagentStop 카운트로 "Stop인데 서브에이전트가 돌고 있음"을 working으로 유지하는 방안을 검토할 만하다.
- **yolo 세션.** `--dangerously-skip-permissions` 같은 자동 승인 세션은 waiting 알림 자체가 드물다. hook 공통 필드의 `permission_mode`를 보면 알림 정책을 다르게 가져갈 수 있다.

### Gaps

- `permission_prompt`의 "키 입력 시 연기"가 해당 세션 pty 입력 기준인지 전역인지 문서에서 확인하지 못했다.
- 이슈들의 현재 상태(2026-11 기준 fixed 여부)는 미러 스니펫이라 확정할 수 없다.

## Q3. 따라 할 만한 패턴: 받은편지함, 다음 대기 세션 점프, 독 배지, 메뉴바, 사운드, 요약, 경과 시간, 알림에서 승인

### Takeaway

검증된 패턴은 일곱 가지다. (1) 대기 수를 독 배지·제목·푸터로 상시 노출, (2) 받은편지함(Unread / Errors 필터, 탭 진입 시 자동 읽음), (3) 대기 세션 단축 이동과 peek에서 바로 답하기, (4) 알림 클릭 시 정확한 세션으로 점프, (5) 이벤트별로 구분되는 사운드, (6) 마지막 응답 요약을 담은 알림, (7) 포커스를 뺏지 않는 승인 카드나 원격 승인. 알림은 "세션이 화면에 보이면 억제"가 사용자 요구 1순위다.

### Cited Findings

- 대기 수 상시 노출: Claude 탭 제목 `2 awaiting input`과 푸터 `← 2 agents`([agent view](https://code.claude.com/docs/en/agent-view)), Paradev 독 배지([Paradev](https://docs.paradev.com/agent-status)), 대기 세션 수를 보여 주는 메뉴바 앱([dev.to ccnotifier](https://dev.to/ccnotifier/how-i-stopped-losing-time-to-stalled-claude-code-sessions-28ji)).
- 받은편지함: Warp mailbox(All / Unread / Errors, 탭 진입 시 자동 읽음)와 토스트([Warp](https://docs.warp.dev/agents/capabilities/agent-notifications/)). Claude agent view의 "Ready for review" 그룹은 끝났지만 아직 안 본 항목을 뜻한다([agent view](https://code.claude.com/docs/en/agent-view)).
- 바로 답하기: agent view peek 패널에서 대기 중인 질문을 보고 숫자키로 답한다([agent view](https://code.claude.com/docs/en/agent-view)). tmux TUI 한 줄당 에이전트 하나, 목록에서 막힌 에이전트에 바로 답하는 방식도 있다([Product Hunt](https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this)).
- 알림 클릭 → 해당 pane 점프: [ccn](https://github.com/bupd/ccn), PokePoke 메뉴바 앱([Product Hunt](https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this)).
- 시각적 위치 표시: cmux pane 파란 링과 탭 unread 배지([cmux](https://cmux.com/docs/notifications)), crystl의 프로젝트 색 승인 카드([crystl](https://crystl.dev/blog/tab-hunting-approval/)).
- 사운드: "결정 필요 / 완료 / 승인" 이벤트마다 다른 차임을 쓰는 사용자 사례가 있다(4개 초과 시 한계, 헤드폰 착용 시 놓침). — [Product Hunt](https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this)
- 요약: 완료 시 "무엇을 왜 했는지" 노트를 남기게 하면 재진입 비용이 준다. — [Product Hunt](https://www.producthunt.com/p/vibecoding/your-ai-agent-is-waiting-for-you-your-attention-isn-t-how-much-time-do-you-lose-to-this). Claude `Stop`과 Codex `Stop`/`notify` 모두 `last_assistant_message`(`last-assistant-message`)를 제공하므로 알림 본문에 쓸 수 있다. — [Claude hooks](https://code.claude.com/docs/en/hooks); [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- 원격·알림 승인: PermissionRequest hook이 ntfy로 Approve/Deny 버튼이 달린 푸시를 보내고, 응답을 `{"behavior":"allow"}`로 돌려주는 오픈소스가 여럿 있다(claude-remote-approver, claude-push, claude-ntfy-hook). 시간이 지나면 터미널 프롬프트로 폴백한다. — [claude-remote-approver](https://github.com/yuuichieguchi/claude-remote-approver); [claude-ntfy-hook](https://adrian-gomez.github.io/claude-ntfy-hook/). PermissionRequest가 VS Code와 Desktop 내장 CLI에서 발화하지 않는다는 이슈(#13203)도 있다. — [동일 검색 결과](https://dev.to/yuu1ch13/approve-claude-code-permission-requests-from-your-phone-47nd)
- 일괄 승인: crystl "Allow All" 바. 다만 자동 승인이 파괴적 명령을 놓치게 한다는 같은 글의 경고도 있다. — [crystl](https://crystl.dev/blog/tab-hunting-approval/)
- 상태가 남는 문제: Paradev "Clear Status"로 강제 종료 후 남은 running 표시를 수동 초기화한다. — [Paradev](https://docs.paradev.com/agent-status)

### Inferences (Aquila Agents에 바로 적용할 후보, 우선순위 순)

1. **"다음 대기 세션으로" 단축키**(예: ⌘⇧J 또는 ⌘]): waiting을 먼저, 그다음 error, 그다음 안 본 done 순으로 순환한다. Claude agent view에도 없는 기능이라 차별점이 된다.
2. **독 배지 = waiting 수(+ error 수)**: Electron `app.dock.setBadge`로 구현한다. 제목 표시줄과 사이드바 상단에도 "2개 대기"를 노출한다.
3. **알림 클릭 → 해당 세션 활성화 + 창 포커스**, 알림 본문에 프로젝트명, 세션명, `last_assistant_message` 첫 줄을 넣는다. waiting이면 PermissionRequest의 `tool_name`/`tool_input` 요약(예: "Bash: npm install")을 넣는다. Notification 페이로드에는 이 정보가 없다(#84801).
4. **경과 시간**: "12분째 대기"를 사이드바 행이나 툴팁에 표시해 방치를 드러낸다. 일정 시간(예: 10분) 이상 대기하면 한 번 더 리마인드하되, 1회만 하고 끌 수 있게 한다. 사용자 비활성 기준 지연(#25802)도 고려한다.
5. **억제 규칙**: 세션이 활성이고 창이 포커스되어 있으면 알림하지 않는다(#53194, 현재 Aquila Agents 동작과 일치). 같은 세션의 같은 상태는 디바운스해 중복을 제거한다(Codex 서브에이전트 폭주 대비). yolo 모드 세션은 done만 알린다.
6. **받은편지함 / 최근 이벤트 목록**: 세션 전환 시 자동 읽음 처리, Errors 필터를 둔다. 'done → 본 뒤 idle'과 같은 모델이다.
7. **사운드**: waiting과 done을 서로 다른 짧은 소리로 구분하고, 끄기 옵션을 둔다.
8. **알림에서 승인**은 신중하게: 제품 원칙("CLI를 재구현하지 않는다")과 안전성 경고를 고려하면, macOS 알림 액션 버튼으로 pty에 키 입력을 보내는 방식은 오승인 위험이 크다. 대신 "알림 클릭 → 해당 세션으로 바로 이동"을 우선한다.

### Gaps

- 알림 액션에서 승인하는 기능에 대한 사용자 만족이나 사고 데이터는 찾지 못했다.
- 어떤 패턴이 정량적으로 효과가 있었는지 보여 주는 연구는 없다(일화 수준).

## Q4. codex와 기타 CLI 상태를 출력 휴리스틱보다 잘 감지하는 방법

### Takeaway

Codex는 이제 hook(UserPromptSubmit / PermissionRequest / PostToolUse / Stop / Interrupt / SessionEnd)만으로 Claude와 같은 수준의 결정적 상태 판정이 가능하다. 다만 사용자 `~/.codex`를 건드리지 않고 주입하는 방법이 관건이다. hook 외 대안으로는 TUI 알림을 OSC 9로 받아 xterm.js에서 가로채는 방식(approval-requested까지 포함)과 `notify` 명령이 있다. 셸은 OSC 133 같은 셸 통합 신호가 대안이다(아래 Gaps 참고).

### Cited Findings

- Codex hooks 14종과 설정 위치는 `$CODEX_HOME/hooks.json`, `.codex/hooks.json`, `config.toml [hooks]`. 비관리 hook은 `/hooks`에서 신뢰 승인이 필요하다. — [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- Codex PermissionRequest는 승인을 요청하기 직전에 발화하고, decision을 주지 않으면 정상 프롬프트가 이어진다. — [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- Codex TUI 알림은 approval-requested를 포함할 수 있고 OSC 9 또는 BEL로 내보낸다. 포커스된 터미널에서는 기본으로 억제되며, `notification_condition = "always"`로 해제한다(정정 2026-11-19: `focused_notifications`라는 키는 없다). 외부 `notify`는 turn-complete만 받는다. 루트 키는 TOML에서 테이블 헤더보다 앞에 와야 한다. — [Vaughan](https://codex.danielvaughan.com/2026/04/13/codex-cli-notification-pipeline-osc9-hooks-alerts/)
- cmux는 OSC 9/99/777을 범용 알림 채널로 받아 pane 링과 알림으로 바꾼다. — [cmux](https://cmux.com/docs/notifications)
- Claude는 제목(OSC 0/2)과 진행률(OSC 9;4)을 내보내지만 형식이 자주 바뀌고 버그가 있어서, 이를 감지 근거로 쓰던 도구들이 깨졌다. — [#68643](https://claudeissues.com/issue/68643-osc-title-not-emitting-idle-marker-after-turn-ends-breaks-herdr-status-detection); [#55111](https://claudeissues.com/issue/55111-bug-osc-9-4-progress-bar-clears-during-tool-execution-instead-of-staying-visible); [warp#10715](https://upd.dev/warpdotdev/warp/issues/10715)

### Inferences

- **Codex 1순위: OSC 9 가로채기(설정 파일 무수정).** 세션을 띄울 때 `codex -c tui.notifications=true -c tui.notification_method="osc9" -c tui.notification_condition="always"`처럼 (정정 2026-11-19: `focused_notifications`는 없는 키) CLI 오버라이드를 넘긴다. `-c key=value` 오버라이드 플래그의 정확한 동작은 검증이 필요하다. 그다음 xterm.js `parser.registerOscHandler(9, ...)`로 OSC 9 본문을 받아, 승인 요청이면 waiting, 턴 완료면 done으로 매핑한다. 규칙 6(사용자 `~/.codex` 미수정)을 지키면서 approval까지 잡을 수 있다. OSC 9 본문 문구로 이벤트 종류를 구분해야 하므로 문구 변경에는 취약하다.
- **Codex 2순위: hooks.** `CODEX_HOME`을 바꾸면 사용자 인증과 설정이 분리되므로 부적합하다. `-c`로 `[hooks]` 인라인 주입이 가능한지, 신뢰 승인(`/hooks`) 절차를 우회하지 않고 사용할 수 있는지 확인이 필요하다. 가능하다면 UserPromptSubmit → working, PermissionRequest → waiting, PostToolUse → working, Stop → done, Interrupt → idle/stopped로 매핑해 Claude와 같은 판정 엔진을 쓸 수 있다.
- **`notify` 오버라이드**(`-c notify=[...]`)는 turn-complete와 `last-assistant-message`를 얻는 보조 수단이다. 알림 본문 요약용으로 쓴다.
- **범용 대체**: 어떤 CLI든 OSC 9/777(알림)과 BEL을 "주의 필요" 신호로 취급하면, 휴리스틱보다 신뢰도 높은 범용 계층이 된다(cmux 방식). 출력 3초 휴리스틱은 마지막 수단으로만 남기고, 휴리스틱으로 얻은 done은 "추정"으로 표시(예: 흐린 초록)해 거짓 완료의 비용을 낮춘다.
- **셸 세션**: zsh/bash 셸 통합의 OSC 133(프롬프트 시작, 명령 시작·종료와 exit code)을 쓰면 "명령 실행 중 / 끝남(성공·실패)"을 정확히 알 수 있다. 다만 사용자 rc를 수정하지 않고 주입하는 방법(예: `ZDOTDIR` 래핑)은 규칙 6과 충돌하지 않는지 따져 봐야 한다.

### Gaps

- Codex OSC 9 알림 본문의 정확한 문자열 형식은 확인하지 못했다(소스 확인 필요).
- `codex -c`로 `[hooks]`나 `notify` 같은 배열·테이블 값을 넘길 수 있는지 공식 확인을 하지 못했다.
- OSC 133 관련 내용은 이번 조사에서 출처를 확보하지 못한 일반 지식이라, 구현 전에 확인이 필요하다.
