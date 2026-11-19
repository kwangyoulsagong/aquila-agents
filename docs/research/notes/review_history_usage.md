# AI 코딩 에이전트 결과물 검토·관리 UX (변경 검토, 커밋/PR, 세션 히스토리, 컨텍스트/메모리, 비용/사용량) — Aquila Agents 개선용

> 조사 기준일: 2026-11-19. 출처는 대부분 공식 문서, GitHub 이슈, 커뮤니티 포럼, 서드파티 블로그. 검색 결과 요약을 거쳐 확인한 내용이 많고, 이슈의 open/closed 상태는 인덱싱 시점 기준이라 바뀌었을 수 있음. 경쟁사 비교 블로그(runpane, agentastic, abralo 등)는 편향 가능성이 있음.

## 1. 에이전트 변경 검토 (diff, 파일·hunk 단위 수락/거절, 에이전트에게 코멘트 보내기, 커밋/PR, 체크포인트)

### Takeaway

2026년 기준 표준 루프는 **diff 보기 → 줄에 코멘트 달기 → 코멘트를 묶어 에이전트에게 보내기 → 새 diff 다시 검토 → hunk/파일 단위로 stage 또는 revert → 커밋/푸시/PR 생성(설명은 에이전트가 작성)**. Conductor, Claude Code Desktop, Codex app 모두 이 루프를 기본 제공함. 사용자 불만은 주로 리뷰 UI가 실제 git 상태와 어긋날 때 생김(stale 목록, 셸로 쓴 변경이 빠짐, 자동 수락). Aquila Agents처럼 git 상태를 직접 읽는 읽기 전용 패널은 이 점에서 오히려 유리함.

### Cited Findings

**Conductor (macOS, Claude Code/Codex 병렬 워크스페이스)**

- Diff Viewer는 ⌘⇧D로 열림. 변경된 줄에 코멘트를 달고 에이전트에게 보낼 수 있고, 더는 해당 없는 GitHub 리뷰 스레드는 resolve 가능. 파일 단위 revert 지원 — [Conductor docs: Review and merge](https://www.conductor.build/docs/guides/review-and-merge)
- `Review` 액션은 에이전트가 현재 diff를 검사하게 함. Repository Settings의 "Code review preferences"에 저장소별 리뷰 기준(정확성, 마이그레이션 안전성, UI 회귀, 테스트, 보안)을 적어 둘 수 있음 — [Conductor docs](https://www.conductor.build/docs/guides/review-and-merge)
- Checks 탭에서 git 상태, PR 메타데이터, CI, 배포, GitHub 리뷰 코멘트, todo를 한곳에 보여 줌. 해결 안 된 코멘트, 실패한 체크, 남은 todo를 머지 blocker로 취급 — [Conductor docs](https://www.conductor.build/docs/guides/review-and-merge)
- `Create PR`은 현재 diff와 저장소 컨텍스트를 에이전트에게 보내 PR 설명을 쓰게 함. 머지 후 워크스페이스를 archive하고, 사이드바의 History 패널에서 복원 — [Conductor docs](https://www.conductor.build/docs/guides/review-and-merge)
- 변경 로그: Claude Code가 diff에 직접 코멘트하는 도구를 갖게 됐고, GitHub 코멘트가 diff에 동기화됨. Claude Code가 워크스페이스 diff를 읽는 `GetWorkspaceDiff` 도구도 있음 — [Conductor changelog p.11](https://www.conductor.build/changelog/page/11)
- 경쟁사 비교 글은 Conductor의 리뷰 루프를 가장 깊은 축으로 평가함(automerge, stacked PR 포함). 경쟁사 글이라 걸러서 볼 것 — [Pane vs Conductor](https://runpane.com/compare/conductor)

**Claude Code Desktop**

- diff 통계 표시(예: +12 -1)를 누르면 뷰어가 열림: 왼쪽 파일 목록, 오른쪽 파일별 변경. 줄을 클릭하면 코멘트 입력창이 뜨고 Enter로 추가함. 코멘트 여러 개를 모아 ⌘Enter로 한 번에 보내면 Claude가 수정한 결과가 새 diff로 올라옴 — [Claude Code Desktop docs](https://code.claude.com/docs/en/desktop)
- 툴바 오른쪽 위의 "Review code" 버튼은 커밋 전에 Claude가 로컬 diff를 평가해 diff 뷰에 직접 코멘트를 남기게 함. 서드파티 글에 따르면 컴파일 에러, 명백한 로직 오류, 보안 취약점 같은 신호가 강한 문제만 짚음 — [Claude blog: preview, review and merge](https://claude.com/blog/preview-review-and-merge-with-claude-code); [thepromptshelf](https://thepromptshelf.dev/blog/claude-code-desktop-app-exclusive-features-2026)
- 세션마다 git worktree로 격리됨 — [Claude Code Desktop docs](https://code.claude.com/docs/en/desktop)
- 버그 보고(Projects beta): Changes diff에 단 인라인 코멘트가 카드로는 보이지만 스레드에 실제로 전달되지 않음. "보냈다고 믿었는데 안 간" 실패 사례 — [claudeissues #96597](https://claudeissues.com/issue/96597-bug-projects-beta-inline-changes-comments-do-not-reach-their-thread)
- 기능 요청: VS Code 기본 git diff에서 변경된 줄에 마우스를 올리면 Claude가 그렇게 바꾼 이유를 보여 달라는 것 — [claudeissues #85769](https://claudeissues.com/issue/85769-feature-hover-on-a-changed-line-in-vs-codes-native-git-diff-shows-claudes-ration)

**OpenAI Codex app**

- 리뷰 패널에서 stage/revert를 세 단계로 지원: 전체 diff(헤더의 "Stage all"/"Revert all"), 파일, hunk. 원하는 것을 stage한 뒤 패널에서 바로 커밋. 로컬·worktree 작업 모두 커밋, 푸시, PR 생성 가능 — [Codex app: Review](https://developers.openai.com/codex/app/review); [Codex app features](https://developers.openai.com/codex/app/features)
- 인라인 코멘트는 직접 지시가 아니라 "리뷰 가이드"로 취급되므로, OpenAI는 코멘트 후 의도를 분명히 적은 후속 메시지를 보내라고 권장함 — [Codex app: Review](https://developers.openai.com/codex/app/review)
- 서드파티 관찰: 코멘트는 현재 diff에 고정돼 있어서 파일을 revert해 diff가 바뀌면 위치를 잃을 수 있음. revert 전에 코멘트와 후속 메시지를 먼저 보내라고 조언함 — [macaron.im guide](https://macaron.im/en/blog/codex-app-review-pane)

**Cursor (사용자 불만 위주, 포럼 버그 리포트)**

- Review 패널이 accept, dismiss, 커밋 후에도 닫히지 않음. 스태프 답변은 "Review 패널은 지금 pending diff가 있는지가 아니라 채팅 세션 동안의 모든 편집을 추적한다", 새 채팅을 열어야 초기화된다는 것 — [Cursor forum: Review panel doesn't dismiss](https://forum.cursor.com/t/review-panel-doesnt-dismiss-rendering-it-useless-reproduced-by-another-user-too/163722)
- 리뷰 파일 목록이 stale 파일로 쌓이고 git status와 동기화되지 않음 — [Cursor forum: stale files](https://forum.cursor.com/t/ai-agent-file-review-list-accumulates-stale-files-and-doesnt-sync-with-git-status/145914)
- 셸이나 스크립트로 쓴 에이전트 변경은 인라인 리뷰 UI에 안 나옴. 리뷰 목록이 내장 편집 도구의 변경만 추적하기 때문 — [Cursor forum: terminal edits missing](https://forum.cursor.com/t/agent-edits-made-via-the-terminal-script-shell-writes-dont-appear-in-the-inline-edit-review-ui/162348)
- 업데이트 후 리뷰/수락 UI 없이 변경이 자동 적용됨. Keep All / Reject All / 다음·이전 파일 내비게이션 바가 사라졌다는 보고 — [Cursor forum: auto-applies](https://forum.cursor.com/t/agent-mode-no-longer-shows-review-accept-interface-and-applies-file-changes-automatically-after-recent-update/152581); [Cursor forum: nav bar missing v2.6.20](https://forum.cursor.com/t/review-diff-navigation-bar-missing-after-agent-changes-v2-6-20/155587)
- 반대 방향 불만: 에이전트 편집마다 "Accept"를 눌러야 하는 게 짜증난다는 글 — [Cursor forum: why accept every edit](https://forum.cursor.com/t/why-the-hell-do-i-have-to-click-accept-an-every-agents-file-edit/145472)
- 파일 단위 ✓/✗ 아이콘은 Pending 모드에서 행에 hover할 때만 보임(발견하기 어려움) — 위 포럼 스레드들에서 정리한 내용, [Cursor forum: Agent review broken](https://forum.cursor.com/t/agent-review-accept-deny-seems-to-be-broken/142029)
- 다른 프로젝트들이 "Cursor식 hunk 단위 수락/거절 + 에이전트로 되돌아가는 코멘트"를 따라 할 모델로 명시함 — [strike #1324](https://github.com/jonathanung/strike/issues/1324); [hermes-agent PR #48813](https://github.com/NousResearch/hermes-agent/pull/48813)

**Zed agent panel**

- "Review Changes"(ctrl-shift-r)를 누르면 모든 변경을 모은 multibuffer 탭이 열림. hunk 단위나 전체로 accept/reject 가능. 파일 탭에서도 같은 컨트롤이 보이고 `agent.single_file_review`로 끌 수 있음(리뷰 중에는 git diff 표시를 임시로 대체함) — [Zed docs: Agent Panel](https://zed.dev/docs/ai/agent-panel)

**Vibe Kanban / Claude Squad / Crystal**

- Vibe Kanban: 줄 단위 코멘트가 에이전트에게 바로 전달됨. README에서 서비스 종료(sunsetting)를 공지했고 로컬 앱은 npx로 계속 실행 가능 — [vibecoding.app review](https://vibecoding.app/blog/vibe-kanban-review); [hysenlabs](https://hysenlabs.com/projects/bloopai-vibe-kanban); [runpane alternatives](https://runpane.com/alternatives/vibe-kanban)
- Claude Squad: 에이전트마다 tmux 세션과 git worktree를 하나씩 두고 탭으로 전환하는 TUI. 인라인 diff 코멘트 기능은 찾지 못함 — [agentastic alternatives](https://www.agentastic.dev/alternatives/vibe-kanban)
- Crystal: deprecated 상태이며 Nimbalyst로 바뀐 것으로 보임. 강점은 실행 결과의 side-by-side 비교 — [agentastic alternatives](https://www.agentastic.dev/alternatives/vibe-kanban); [abralo](https://abralo.com/alternatives)

**체크포인트/되돌리기 (Claude Code)**

- `/rewind`(별칭 `/checkpoint`, `/undo`)나 빈 프롬프트에서 Esc 두 번으로 열림. "코드만 복원", "대화만 복원", 둘 다 중 선택 가능 — [Claude Code docs: Checkpointing](https://code.claude.com/docs/en/checkpointing)
- 한계: Bash 명령(rm, mv, cp 등)으로 바뀐 파일은 추적하지 않고, symlink와 hard link는 건너뜀. 세션당 최근 100개 체크포인트만 유지하고, 세션과 함께 30일 후 정리됨(설정 가능) — [Claude Code docs: Checkpointing](https://code.claude.com/docs/en/checkpointing)

**리뷰가 병목이라는 사용자 목소리**

- HN 인용: "I also fire off tons of parallel agents, and review is hands down the biggest bottleneck." / 진짜 해법은 어떤 변경에 사람 리뷰가 필요한지 골라내는 것이고, 반드시 diff로 볼 필요도 없다는 의견. 원문 HN 스레드는 직접 확인하지 못했고 2차 인용임 — [dev.to: agentic coding moved my bottleneck to code review](https://dev.to/pat9000/agentic-coding-moved-my-bottleneck-to-code-review-24b7); [blakecrosley: smaller review surfaces](https://blakecrosley.com/blog/ai-coding-agents-smaller-review-surfaces)
- "에이전트가 작성하면 리뷰가 4.4배 오래 걸린다"(Faros AI 데이터를 2차 인용, 검증 필요) — [dev.to/max_quimby](https://dev.to/max_quimby/10x-prs-1x-reviewers-the-code-quality-bottleneck-166o)

### Inferences

- Aquila Agents의 Changes 패널(⌘⇧G)이 git 상태를 직접 읽는다는 점은 Cursor의 가장 큰 불만(셸 편집 누락, stale 목록)을 구조적으로 피함. 이 장점을 UI에서 드러낼 것(예: "git working tree 기준" 문구, 마지막 갱신 시각).
- 우선순위 제안(Aquila Agents 원칙 "CLI를 재구현하지 않음"과 호환되는 순서):
  1. **side-by-side/unified 전환 + 파일 목록 내비게이션**(j/k, 다음 파일). 비용이 낮고 모든 경쟁 제품에 있음.
  2. **줄 코멘트 → 해당 세션 pty에 텍스트로 붙여넣기.** `파일:줄` 형식 + 코드 인용 + 코멘트를 하나의 프롬프트로 만들어 활성 claude/codex 세션 입력창에 넣고, 전송(Enter)은 사용자에게 맡김. Desktop의 "모아서 ⌘Enter" 패턴. 채팅 재구현 없이 가장 많이 요청되는 루프를 닫을 수 있음. Codex 문서처럼 의도를 적는 한 줄을 덧붙이게 유도.
  3. **파일/hunk 단위 stage·revert**(git apply --cached / checkout -p 상당). Codex app과 Zed가 표준. revert는 되돌릴 수 없으므로 확인 창이나 stash 백업이 필요.
  4. **커밋 메시지 + PR**: "에이전트에게 커밋 메시지/PR 설명 작성 요청" 버튼은 세션에 프롬프트를 주입하는 방식으로 충분함(Conductor의 Create PR 패턴).
- Claude 체크포인트가 Bash 변경을 못 되돌리므로, Aquila Agents가 "세션 시작 시점 대비 diff"(시작 시 HEAD/stash 스냅샷 기록)를 보여 주면 차별점이 됨.

### Gaps

- GitHub Desktop, lazygit의 hunk staging UX에 대한 최신 사용자 의견은 이번 조사에서 직접 확인하지 못함(도구 호출 예산 한도).
- Conductor의 diff 레이아웃(side-by-side인지 unified인지), 파일별 "viewed" 표시는 문서에 없음.
- Claude Code VS Code 확장의 diff 수락 흐름에 대한 사용자 평가는 확인하지 못함.

## 2. 세션 히스토리와 재개 (`claude --resume`, `codex resume`, 검색, 이름 붙이기)

### Takeaway

양쪽 CLI의 resume picker는 **이름이 안 보이거나 검색이 안 되고, 세션이 사라진 것처럼 보이는** 문제로 이슈가 대량으로 쌓여 있음. 그래서 jsonl을 직접 파싱하는 서드파티 뷰어와 검색 도구가 생태계를 이룸. 게다가 Claude는 기본 30일 후 기록을 삭제함. Aquila Agents의 세션 히스토리 패널이 정확히 이 공백을 겨냥함.

### Cited Findings

**Claude Code**

- `/rename`으로 붙인 이름이 `--resume` picker에 안 나오고 첫 메시지가 대신 표시됨(#24704의 중복으로 닫힘) — [anthropics/claude-code #25311](https://github.com/anthropics/claude-code/issues/25311)
- `claude -r <session-name>`이 이름을 바꾼 세션을 자주 못 찾음 — [#27195](https://github.com/anthropics/claude-code/issues/27195)
- `/resume` 검색이 세션 내용과 요약만 대상으로 하고 사용자 지정 이름은 검색하지 않음(중복으로 닫힘) — [#43963](https://github.com/anthropics/claude-code/issues/43963)
- 이름을 바꾼 세션의 transcript가 디스크에 멀쩡히 있는데도 picker와 `claude agents`에 안 나옴. 우회법은 세션 ID로 재개(검색 시점 기준 open) — [#96559](https://github.com/anthropics/claude-code/issues/96559)
- `~/.claude/projects/` 아래에 맞는 디렉터리가 없으면 이름 바꾼 세션이 `/resume`에서 빠짐 — [#28269](https://github.com/anthropics/claude-code/issues/28269)
- fork하거나 재개한 세션의 제목이 `/rename` 이름을 덮어씀 — [#80906](https://github.com/anthropics/claude-code/issues/80906)
- picker에 이름, 날짜, ID를 표시해 달라는 요청 — [#25841](https://github.com/anthropics/claude-code/issues/25841)
- `/resume` 목록에서 바로 이름을 바꾸게 해 달라는 요청은 not planned로 닫힘 — [#72895](https://github.com/anthropics/claude-code/issues/72895); picker에 `/rename` 이름을 표시해 달라는 요청도 not planned — [#39414](https://github.com/anthropics/claude-code/issues/39414)
- transcript는 `cleanupPeriodDays`(기본 30일)가 지나면 삭제되므로 백업을 권장함 — [dev.to: Claude Code conversation history](https://dev.to/heylittlepan/claude-code-conversation-history-where-it-lives-how-to-search-it-how-to-get-it-back-4lc8); 체크포인트도 30일 후 정리 — [Checkpointing docs](https://code.claude.com/docs/en/checkpointing)

**Codex CLI**

- `codex resume` picker는 미리보기 텍스트(첫 사용자 메시지)로만 필터링함. 스레드 이름을 열로 보여 주고 검색에도 포함해 달라는 요청 — [openai/codex #10315](https://github.com/openai/codex/issues/10315)
- picker가 백엔드에서 받은 오래된 제목을 유지하는 버그 → 로컬 `session_index.jsonl`로 이름을 항상 덮어쓰도록 수정 — [openai/codex PR #16601](https://github.com/openai/codex/pull/16601)
- 공식 문서: `codex resume [SESSION_ID]`는 uuid나 세션 이름을 받고, 인자 없이 실행하면 picker가 열림 — [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- `/rename` 이름은 `~/.codex/session_index.jsonl`에 저장됨(서드파티 가이드) — [ccassist: Codex CLI history](https://ccassist.dev/codex-cli-history-viewer/)
- 서드파티 블로그에 따르면 v0.145에서 SQLite 기반 스레드 히스토리를 도입했고, picker에 이름, 작업 디렉터리, 마지막 수정 시각을 표시함. 함께 언급된 `codex session search` 명령은 공식 문서에서 확인하지 못함 — [danielvaughan: v0.145](https://codex.danielvaughan.com/2026/07/26/codex-cli-paginated-thread-history-sqlite-search-resume-persisted-names-memories/)

**서드파티 히스토리 도구(수요가 있다는 증거)**

- Show HN "search-sessions": DB 없이 jsonl을 직접 검색하는 Rust CLI. 빠른 인덱스 검색과 본문 전체 deep search를 제공하고, 결과마다 `claude --resume`에 넘길 세션 UUID를 붙여 줌 — [HN: Show HN search-sessions](https://news.ycombinator.com/item?id=47128630)
- claude-history-explorer(정규식 검색, 원본을 수정하지 않음), claude-session-viewer(TUI, tool use 표시), claude-JSONL-browser(Markdown 변환, 여러 로그 검색), 브라우저 로컬 뷰어 — [adewale/claude-history-explorer](https://github.com/adewale/claude-history-explorer); [jtklinger/claude-session-viewer](https://github.com/jtklinger/claude-session-viewer); [withLinda/claude-JSONL-browser](https://github.com/withLinda/claude-JSONL-browser); [michimani viewer](https://this.michimani.net/claude-code-history)
- "Claude Code and Codex Assist" VS Code 사이드바: 검색과 원클릭 resume 제공 — [kentgigger.com](https://kentgigger.com/posts/claude-code-conversation-history)
- Conductor는 archive한 워크스페이스를 사이드바 History 패널에서 복원함 — [Conductor docs](https://www.conductor.build/docs/guides/review-and-merge)

### Inferences

- Aquila Agents 세션 히스토리 패널에 꼭 필요한 것(이슈에서 반복되는 요구 순):
  1. **표시**: 사용자 지정 이름(Claude의 `/rename` 커스텀 타이틀, Codex의 `session_index.jsonl`) → 없으면 첫 사용자 메시지. 마지막 활동 시각, 메시지 수, 브랜치/cwd, 세션 ID(복사 버튼) 함께.
  2. **검색**: 이름 + 첫 메시지 + 본문 전체(deep). picker의 핵심 불만이 "이름이 검색 안 됨".
  3. **CLI picker와 다르게 디렉터리 매칭이 깨져도 보이게** 할 것: jsonl 안의 `cwd` 필드 기준으로 프로젝트에 묶고, 경로 인코딩 디렉터리 이름에만 의존하지 말 것(#28269, #96559 대응).
  4. **재개는 ID로**: `claude --resume <uuid>`, `codex resume <uuid>`를 새 탭에서 실행. 이름 기반 lookup이 불안정하다고 보고됨(#27195).
  5. **보존 경고**: "Claude는 30일 후 자동 삭제(cleanupPeriodDays)" 안내 + 선택적으로 Markdown 내보내기나 즐겨찾기(Aquila Agents 쪽 별도 저장). 휴지통 삭제는 계획대로 하되, 30일 자동 정리와 별개라는 점을 문구로 밝힐 것.
  6. Aquila Agents 안에서 이름 붙이기는 `~/.claude`에 쓰지 않는 규칙(AGENTS.md 규칙 6) 때문에 Aquila Agents 쪽 메타데이터로 저장하는 편이 안전함.
- Codex 저장 방식이 v0.145 이후 SQLite로 바뀌었을 가능성이 있으므로(서드파티 주장) `~/.codex/sessions` jsonl만 가정하지 말고 실제 버전에서 확인할 것.

### Gaps

- Claude Code 최신 버전(2026 하반기) `/resume` picker의 개선 내용(이름 표시나 검색이 고쳐졌는지)은 공식 changelog로 확인하지 못함. 여러 이슈가 중복이나 not planned로 닫힌 상태라 해결 여부가 불명확함.
- Reddit 사용자 반응은 이번 검색에서 직접 수집하지 못함.

## 3. 컨텍스트와 메모리 관리 (CLAUDE.md, auto memory, /compact, /clear, 컨텍스트 표시)

### Takeaway

사용자는 **항상 보이는 컨텍스트 사용률 표시**를 원함(기본 경고는 약 95% 근처에서야 뜸). 그래서 statusline 커스터마이즈로 직접 해결하는 사람이 많음. auto-compact가 언제 발동하는지 혼란스러워서 미리 수동으로 `/compact`하거나 `/clear`하는 습관이 권장됨. 메모리 쪽에서는 CLAUDE.md/AGENTS.md가 계속 커지기만 하는 "bloat"와 stale 규칙이 핵심 문제임.

### Cited Findings

- 기능 요청: "Context left till auto-compact" 경고는 약 95%에 가까워져야 나타나므로 상태 바에 항상 표시해 달라는 것 — [anthropics/claude-code #15247](https://github.com/anthropics/claude-code/issues/15247)
- 버그(v2.1.153, Max, 200K): statusline은 "100% context used"인데 auto-compact가 발동하지 않음. 원시 지표는 약 90%(200K 기준), 시스템 statusline은 약 33K 압축 버퍼를 뺀 사용 가능 공간 기준이라 숫자가 다름. `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200k`로 해결했다는 일화적 보고 — [#63015](https://github.com/anthropics/claude-code/issues/63015)
- auto-compact 임계값은 출처마다 85~95%로 다름. auto-compact window는 기본적으로 모델 컨텍스트 한도이고 `/autocompact`로 바꿀 수 있다는 가이드도 있음 — [continuumcode guide](https://continuumcode.ai/guides/claude-code-context-low/); [mindstudio](https://www.mindstudio.ai/blog/claude-code-compact-command-context-management)
- `/context`로 무엇이 컨텍스트를 차지하는지 분해해 볼 수 있음 — [Vincent's blog: /context](https://blog.vincentqiao.com/en/posts/claude-code-context/)
- statusline은 Claude Code의 실시간 context_window 데이터(2.1.72+)를 받아 표시할 수 있음. 컨텍스트 사용률을 자동으로 얻을 수 있는 곳은 statusline뿐이라서 hook과 연계해 경고 시스템을 만든 사례가 있음 — [claudecode.jp](https://claudecode.jp/en/news/student/claude-code-statusline-context-usage-display); [zenn: context warning system](https://zenn.dev/trust_delta/articles/claude-code-context-warning-001?locale=en)
- 품질이 떨어지기 전인 약 60%에서 일찍 compact하라는 권장, auto-compact를 아예 피하라는 글 — [mindstudio](https://www.mindstudio.ai/blog/claude-code-compact-command-context-management); [nathanonn: never auto-compact](https://www.nathanonn.com/claude-code-never-auto-compact/)
- Anthropic 공식 권장은 CLAUDE.md를 파일당 약 200줄 이하로 유지하는 것(길수록 컨텍스트를 더 쓰고 준수율이 떨어짐). 오래되거나 충돌하는 지시는 주기적으로 정리하라고 함 — [getunblocked: audit bloated CLAUDE.md](https://getunblocked.com/blog/audit-fix-bloated-claude-md/)
- auto memory는 CLAUDE.md와 별도로 저장되고 세션 시작 때 MEMORY.md 인덱스의 앞 200줄 또는 25KB만 로드됨. CLAUDE.md가 정확해도 auto memory가 최신이라는 보장은 없음 — [aident: audit auto memory](https://aident.ai/blog/audit-claude-code-auto-memory)
- 연구("catastrophic remembering"): 1,867개 공개 저장소의 지시문 247,694개의 수명을 추적한 결과, 지시는 계속 추가되고 오래된 것은 거의 삭제되지 않음 — [Analytics India Magazine](https://analyticsindiamag.com/ai-features/youre-drowning-claude-code-in-instructions-you-cant-explain-or-remember); [danielvaughan](https://codex.danielvaughan.com/2026/08/12/catastrophic-remembering-agents-md-instruction-bloat-prompt-comments-codex-cli/)
- r/cursor 댓글: 모든 규칙에 날짜와 한 줄짜리 이유를 붙이고, 이유가 더는 성립하지 않으면 월간 정리 때 삭제하라는 것. "정당화할 수 없는 규칙이 바로 거짓말하는 규칙" — [getunblocked](https://getunblocked.com/blog/audit-fix-bloated-claude-md/)

### Inferences

- Aquila Agents는 pty만 보므로 컨텍스트 %를 직접 알기 어려움. 가능한 경로는 둘: (a) Aquila Agents가 주입하는 `--settings`에 statusline 명령을 넣어 context_window JSON을 `~/.aquila/`로 기록하게 하기(이미 hooks를 주입하는 구조와 일치하고 사용자 설정을 건드리지 않음), (b) jsonl의 마지막 assistant 메시지의 usage(input + cache 토큰)로 추정하기. 탭/사이드바에 작은 게이지를 두고 60~70%에서 색을 바꾸는 방식이 요청과 맞음.
- "Clear context" 버튼은 `/clear`를 pty에 쓰는 것으로 충분함. 다만 사용자들이 `/compact`(요약 유지)와 `/clear`(완전 초기화)를 구분해 쓰므로 두 버튼을 분리하거나 compact를 기본으로 두는 것을 검토할 것.
- "Claude 프로젝트 메모리 지우기"는 위험한 작업이므로 삭제 전에 auto memory(MEMORY.md 등)와 CLAUDE.md를 **구분해서 미리보기**로 보여 주고, 줄 수/KB와 200줄/25KB 한도 대비 표시를 넣으면 유용함. 휴지통 이동 원칙 유지.

### Gaps

- `/memory` 명령이나 auto memory 삭제에 대한 Reddit 사용자 반응은 찾지 못함.
- Codex CLI의 컨텍스트 표시와 compact UX에 대한 사용자 의견은 이번 조사에서 다루지 못함.

## 4. 비용/사용량 가시성 (세션별 토큰/비용, 5시간 창, 주간 한도)

### Takeaway

구독 사용자에게 진짜 관심사는 달러가 아니라 **"5시간 창과 주간 한도 중 얼마 남았고 언제 리셋되나"**임. Claude Code 내장 `/usage`가 사용량 바와 리셋 시각을 보여 주지만 항상 보이지는 않아서, ccusage(과거 분석)와 Claude-Code-Usage-Monitor(실시간 예측), 메뉴바 앱이 널리 쓰임.

### Cited Findings

- `/usage`는 구독 사용자에게 플랜 사용량 바, 각 창의 리셋 시각, 활동 통계를 보여 줌. Pro/Max/Team/Enterprise에서는 skills, subagents, plugins, MCP 서버 등 무엇이 한도를 소비했는지도 분해함 — [claudcod: rate limits](https://claudcod.com/blog/claude-code-rate-limits/); [fastero](https://fastero.com/blog/claude-code-usage)
- 유료 플랜은 롤링 5시간 세션 창과 주간 한도가 동시에 적용됨. Max와 Team Premium은 전체 모델 주간 한도와 Sonnet 전용 주간 한도 두 개가 있음 — [morphllm: usage limits](https://www.morphllm.com/claude-code-usage-limits); [usagebar](https://usagebar.com/blog/claude-weekly-limit-all-models-explained)
- 주간 리셋 방식은 출처마다 다름: 세션 시작 후 7일 롤링이라는 곳도 있고 계정별 고정 시각이라는 곳도 있음. 정확한 토큰 수는 공개하지 않음 — [reasonmachines](https://reasonmachines.com/guides/claude-usage-limit-explained); [bestagent.dev](https://bestagent.dev/claude-code-usage-limits/)
- `/cost`가 `/usage`의 별칭이라는 출처와 `/cost`·`/stats`가 같은 화면이라는 출처가 서로 다름 — [claudcod](https://claudcod.com/blog/claude-code-rate-limits/)
- 기기를 넘나드는 권위 있는 표시는 웹 Settings → Usage — [claudcod](https://claudcod.com/blog/claude-code-rate-limits/)
- ccusage: 로컬 jsonl 기반 CLI로 일별·세션별 리포트와 `blocks --live` 실시간 대시보드를 제공 — [ccusage GitHub](https://github.com/processtrader/ccusage); Claude-Code-Usage-Monitor는 실시간 소비와 예측을 담당해 둘을 함께 쓰는 조합이 소개됨 — [dev.to/shipyard](https://dev.to/shipyard/how-to-track-claude-code-usage-analytics-52ak)
- 메뉴바 앱 "Usage for Claude"(세션·주간 한도 추적), 오픈소스 onWatch(실시간 쿼터), 주간 요약을 주는 Claude Telemetry MCP — [alternativeto](https://alternativeto.net/software/usage-for-claude); [glama: Claude Telemetry MCP](https://glama.ai/mcp/servers/@cordlesssteve/claude-telemetry-mcp/blob/18ca64d4d63bc2b8e045612768f283f98101dff9/README.md)
- 비용 관리 공식 문서 — [Anthropic docs: costs](https://docs.anthropic.com/en/docs/claude-code/costs)

### Inferences

- Aquila Agents는 여러 세션과 계정을 한 창에서 다루므로(계정 전환 기능 있음) **계정별 5시간 창 / 주간 사용량 미니 게이지 + 리셋 카운트다운**을 사이드바 하단에 두면 경쟁 제품 대비 차별점이 됨. 데이터 소스는 ccusage처럼 로컬 jsonl의 usage 필드 합산(추정치로 표시)이 현실적이고, 정확한 한도는 비공개이므로 "추정"이라고 명시할 것.
- 세션 히스토리 행에 세션별 토큰과 API 환산 비용을 표시하면 히스토리와 사용량 기능을 함께 만들 수 있음(같은 jsonl 파싱).
- Codex 쪽 사용량은 `~/.codex/sessions`의 token_count 이벤트로 비슷하게 집계할 수 있을 가능성이 있으나 확인되지 않음.

### Gaps

- Reddit의 한도 관련 사용자 스레드(주간 한도 도입 반발, 리셋 혼란 등)는 이번 검색에서 직접 수집하지 못함.
- statusline에 rate-limit 리셋 정보가 노출되는지는 확인하지 못함.
- Codex CLI의 플랜 사용량 표시(`/status` 등)와 사용자 평가는 조사하지 못함.
- ccusage 저장소 URL(processtrader/ccusage)은 검색 결과에 나온 그대로임. 원 저자 저장소(ryoppippi/ccusage로 알려짐)와 다를 수 있어 확인이 필요함.
