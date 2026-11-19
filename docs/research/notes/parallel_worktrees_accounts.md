# 병렬 AI 코딩 에이전트 사용성: 프로젝트 관리 · 워크트리 · 다중 Claude 계정 · 오케스트레이션 (사용자 관점)

> 조사 시점: 2026-11-19. 사용자 증언(HN 스레드, GitHub 이슈)을 마케팅보다 우선했음. Reddit 스레드는 검색에 직접 잡히지 않아 거의 인용하지 못함(Gaps 참조). 비교 블로그 다수는 경쟁 제품 벤더가 쓴 글이므로 사실 확인용으로만 사용.

## 1. 병렬 에이전트 도구들은 워크트리/브랜치/머지/정리/포트/env/node_modules를 어떻게 다루며, 사용자에게 무엇이 깨지는가?

### Takeaway

워크트리는 "파일 격리"만 해결하고 "런타임 격리"(포트, DB, Docker, .env, node_modules)는 해결하지 않는다. 이것이 모든 제품에서 공통적인 불만 1순위이며, 잘 된 제품(Superset, Conductor, Codex 앱, Claude Code)은 **레포별 setup/teardown 스크립트 + gitignored 파일 복사 규칙 + 워크스페이스별 포트 블록 할당**으로 답한다. 또 하나의 반복 불만은 "기존 로컬 체크아웃을 그대로 써 달라(재클론 금지)"이다.

### Cited Findings

**공통 문제(런타임 격리)**

- 워크트리는 tracked 파일만 가져오므로 `.env`가 없고, node_modules도 없어서 새로 설치해야 함. 3개 에이전트가 모두 3000 포트를 두고 싸움. "Git worktrees solve filesystem isolation but not runtime isolation" — [DEV: Worktrees break on .env, node_modules and Port 3000](https://dev.to/gabrielanhaia/git-worktrees-for-coding-agents-break-on-env-nodemodules-and-port-3000-fix-all-three-3781), [Upsun Developer](https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents)
- 권장 해법: 워크트리마다 `.env.local`에 고유 `PORT`(3101, 3102…), DB/컨테이너도 워크트리별 리소스로 취급, 부트스트랩 스크립트(install + env 복사 + 포트 할당), 동시 에이전트 3~4개로 제한. Next.js는 복사한 `.env`의 PORT를 무시했다는 보고도 있음 — [DEV](https://dev.to/gabrielanhaia/git-worktrees-for-coding-agents-break-on-env-nodemodules-and-port-3000-fix-all-three-3781), [MindStudio playbook](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees)
- node_modules 심링크 공유는 위험(의존성 버전 충돌 재발). lockfile이 같을 때만 심링크하라는 조언 — [DEV jsmanifest](https://dev.to/jsmanifest/parallel-ai-coding-with-git-worktrees-run-multiple-agents-without-conflicts-11na)

**Conductor (conductor.build, macOS, 클로즈드 소스, 2026-11-04 Meta 합류 발표)**

- 칭찬: "worktrees took way too much setup and hand-holding… Conductor made it easy", "took 90% of the friction out of worktrees" — [HN 46029331](https://news.ycombinator.com/item?id=46029331), [HN 45520043](https://news.ycombinator.com/item?id=45520043)
- Show HN 불만: _1tem "does NOT work the way I expected" — 기존 체크아웃의 워크트리를 원했는데 GitHub에서 클론함. cahaya: "로컬 브랜치로 동작하면 Crystal에서 갈아탈 것". pjm331: `.env` 등 untracked 파일 누락. _1tem: 워크스페이스마다 의존성 재설치가 느림. henryaj: "local branch doesn't have the changes that are on the PR". lmeyerov: 브랜치 간 Docker daemon/compose 프로젝트 충돌 — [Show HN: Conductor](https://news.ycombinator.com/item?id=44594584)
- 같은 스레드: GitHub OAuth 권한 범위가 너무 넓다는 비판("INSANE") → 메이커가 fine-grained 권한 + 로컬 `gh` CLI 인증으로 수정. aantix: "Claude Code의 느낌이 사라진다"(인터럽트/히스토리 키바인딩 불일치). 요청: 새 워크스페이스의 기본 브랜치 설정, "Open in…" 커스텀 툴, 멀티레포(프론트+백엔드) 태스크, Codex/Gemini 지원, GitHub 없이 로컬 git — [Show HN: Conductor](https://news.ycombinator.com/item?id=44594584)
- 메이커 답변: 레포의 "setup script" 필드로 node_modules/env 복사 — 같은 스레드
- 후속 HN: "main 브랜치에서 작업하는 세션도 원한다(워크트리 동시 작업이 지저분해짐)", Codex에 MCP/규칙이 적용되는지 불명확 — [HN 46029331](https://news.ycombinator.com/item?id=46029331) (검색 스니펫 기반)
- 마무리 흐름: diff 리뷰 → PR 생성 → 머지 → 워크스페이스 **archive** — [Conductor docs](https://www.conductor.build/docs/)
- 비교글: 재클론 방식 때문에 `.env` 재설정 오버헤드가 반복 지적됨; GUI PR 생성, AI 리뷰, CI 체크 확인 — [ai-deck 비교](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)
- Meta 합류 후 일부 HN 사용자는 "셧다운"으로 받아들임, 대안 이동 권고 글 등장 — [HN 50369503](https://news.ycombinator.com/item?id=50369503), [bodegaone](https://www.bodegaone.ai/blog/conductor-alternatives-after-meta) (스니펫 기반, 상세 미확인)

**Superset (superset.sh, Electron, ELv2, 무료 + Pro $20/seat)**

- 기존 로컬 레포 위에서 워크트리 자동 관리(재클론 없음), node_modules와 `.env.development.local`이 따라옴 — [ai-deck 비교](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)
- `.superset/config.json`의 `setup`/`teardown` 배열; 스크립트에 워크스페이스 이름, 루트 레포 경로, `SUPERSET_PORT_BASE` 전달; 워크스페이스마다 **연속 20개 포트 블록** 예약, teardown 시 포트/Docker 컨테이너/임시파일 정리 — [Superset README](https://github.com/superset-sh/superset/blob/main/README.md), [Setup & Teardown 가이드](https://mintlify.wiki/superset-sh/superset/guides/setup-teardown-scripts), [deepwiki](https://deepwiki.com/superset-sh/superset/8.2-setup-and-installation)
- Launch HN 칭찬: collin128 "Conductor에서 갈아탔다", micro23xd "여러 레포에서 40~50개 세션 동시 실행", cpan22 "네이티브 Codex/Claude Code TUI를 bloat 없이 쓸 수 있어 좋다", walthamstow "백그라운드 서비스가 터미널을 살려두는 게 훌륭", BrandiATMuhkuh 포트 예약 + setup 스크립트로 병렬 웹서버·e2e 테스트 — [Launch HN: Superset](https://news.ycombinator.com/item?id=48236770)
- Launch HN 불만: igor47 "'just'(setup 스크립트로 하면 된다)가 많은 걸 떠안고 있다" — 하드코딩된 포트, 에이전트가 프로젝트 태스크 대신 pytest를 직접 호출. toddmorey "I've never used lsof so much in my life." desireco42 "vibe coded electron app, 2GB! is too much", 프리징·렌더링 깨짐, 임포트한 프로젝트가 안 보임. micro23xd 긴 세션/4K에서 터미널 렌더링 글리치. dbbk 새 워크스페이스 모달에 모드 선택 없음. drcongo "What exactly am I signing in to?" hmokiguess "tmux면 충분, 이런 툴은 무겁고 압도된다" — [Launch HN: Superset](https://news.ycombinator.com/item?id=48236770)
- 머지 충돌: mashlol은 소프트웨어가 자동 충돌 해결을 강제해야 한다고, dbbk는 Opus가 잘 처리한다고 반론 — 같은 스레드

**cmux (네이티브, GPL-3.0)**

- 워크트리 자동화 없음(사용자/에이전트가 CLI로 생성), 사이드바에 포트 번호·PR 표시, **입력 대기 에이전트에 파란 링**, `cmux notify`로 Claude Code 훅 → macOS 알림, Electron이 아니라 가볍다는 평 — [ai-deck 비교](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)

**Claude Squad / Crystal / vibe-kanban / Sculptor**

- Claude Squad: 에이전트마다 tmux 세션 + git worktree, SSH에서도 동작; "wrapper이지 workspace가 아니다 — 리뷰/머지는 여전히 사용자 몫" — [augmentcode 비교](https://www.augmentcode.com/tools/open-source-agent-orchestrators), [munderdiffl.in](https://munderdiffl.in/blog/best-claude-code-multi-agent-tools/)
- Crystal: 2026년 2월 deprecated, 후속은 Nimbalyst(선택적 워크트리 격리) — [augmentcode 비교](https://www.augmentcode.com/tools/open-source-agent-orchestrators). Show HN 당시엔 "Does One Thing Really Well", 오픈소스·로컬 브랜치 지원으로 Conductor 대안으로 언급 — [Show HN: Conductor](https://news.ycombinator.com/item?id=44594584)
- vibe-kanban: 운영사 Bloop 2026-04-10 종료, 클라우드 보드 사라짐, 로컬 툴은 동작/커뮤니티 유지 — [DEV: Vibe Kanban alternatives](https://dev.to/agentverateam/vibe-kanban-alternatives-after-the-bloop-shutdown-2026-p80) (출처 간 유지 상태 서술 상이)
- Sculptor(Imbue): 문서상 기본은 git worktree, 컨테이너는 실험적 백엔드; 포트·DB·.env는 여전히 수동 — [developertoolkit 비교](https://developertoolkit.ai/en/ecosystem/agent-tools/agent-shells/) (2차 출처)

**Codex 앱 (OpenAI)**

- 컴포저 아래 "Worktree" 선택 + 로컬 environment(setup 스크립트) 선택; 워크트리는 `$CODEX_HOME/worktrees`에 **detached HEAD**로 생성해 브랜치를 오염시키지 않음; gitignored 파일 자동 복사 안 됨; 최근 15개만 유지(자동 정리); setup 스크립트는 줄마다 별도 bash 세션이라 `export`가 유지 안 됨 — [Verdent guide](https://www.verdent.ai/guides/codex-app-worktrees-explained), [Daniel Vaughan: Codex worktree lifecycle](https://codex.danielvaughan.com/2026/04/11/codex-app-worktree-lifecycle-local-environments/), [codex-docs 미러](https://www.codex-docs.com/en/docs/environments/git-worktrees) (모두 3자 출처)

**Claude Code CLI / 데스크톱 (공식 문서)**

- `claude --worktree <name>` → `.claude/worktrees/<name>/`, 브랜치 `worktree-<name>`; 이름 생략 시 `bright-running-fox` 같은 자동 이름; `claude --worktree "#1234"`로 PR에서 분기; `worktree.baseRef`: `"fresh"`(origin 기본 브랜치, 기본값) / `"head"`(현재 HEAD) — [Claude Code docs: worktrees](https://code.claude.com/docs/en/worktrees.md)
- `.worktreeinclude`(gitignore 문법)로 `.env` 등 gitignored 파일만 복사; 데스크톱 앱 병렬 세션에도 적용 — 같은 문서
- 정리 규칙: 깨끗한 워크트리는 자동 삭제(이름 붙은 세션은 확인), 변경/미커밋/새 커밋 있으면 keep/remove 질문, `-p` 비대화형은 정리 안 함; 백그라운드/서브에이전트 워크트리는 `cleanupPeriodDays` 후 sweep, 실행 중엔 `git worktree lock` — 같은 문서
- 머지된 경우 감지: 원격 브랜치가 삭제되고 모든 커밋이 기본 브랜치에 있으면 같은 이름 재사용 시 기본 브랜치로 리셋 — 같은 문서
- 권한 승인("don't ask again")은 메인 체크아웃의 `.claude/settings.local.json`에 저장되어 모든 워크트리에 공유 — 같은 문서
- 데스크톱 앱은 새 세션마다 자동으로 워크트리를 만들며 끌 토글이 없다는 사용자 불만/기능요청 — [claudeissues #91472](https://claudeissues.com/issue/91472-feature-make-git-worktree-pooling-opt-out-one-worktree-per-session-removed-only), [wotai](https://wotai.co/blog/claude-code-worktrees) (미러/2차 출처)

**병렬화 자체에 대한 회의**

- koliber: "the limiting factor is my attention" — 3개 세션 이상은 의미 없음, 머지 충돌 피하려 서로 무관한 코드베이스에서만 병렬. bob1029: "One 'slow' agent can outpace many fast ones"; "$100 of tokens in 60 seconds" 경고. Olshansky: 겹침 방지를 위해 워크트리 대신 여러 클론 선호 — [Ask HN: How do you run parallel agent sessions?](https://news.ycombinator.com/item?id=46682551)
- Show HN Conductor: oc1 "워크트리는 불필요한 레이어, 진짜 병목은 사람의 리뷰" — [Show HN: Conductor](https://news.ycombinator.com/item?id=44594584); Superset 비교글: "can a human really review ten parallel agents?" — [ai-deck](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)

### Inferences

- Aquila Agents의 계획된 "New Claude in worktree"(`../<repo>-wt/<branch>`)는 Claude Code의 기본 위치(`.claude/worktrees/`)와 다르다. 사용자가 `claude --worktree`/데스크톱과 섞어 쓰면 두 곳에 워크트리가 흩어질 수 있으므로, (a) 기존 `git worktree list`를 읽어 어디서 만들었든 사이드바에 표시하고, (b) Claude Code의 `.worktreeinclude`를 존중(같은 규칙으로 복사)하는 것이 안전하다.
- 가장 베낄 가치가 큰 패턴: 프로젝트별 **setup / run / teardown 스크립트** + 워크스페이스별 **포트 베이스 환경변수**(Superset `SUPERSET_PORT_BASE` 20포트 블록) + 사이드바에 **세션별 리스닝 포트 표시**(cmux). 계획된 시스템 모니터(CPU/RAM)에 "이 세션이 연 포트"를 같이 보여주면 `lsof` 지옥(toddmorey)을 직접 해결.
- 재클론 금지, 기존 로컬 체크아웃 기반, GitHub 로그인 불필요 — Conductor의 초기 실패에서 얻는 교훈. Aquila Agents는 이미 로컬 우선이므로 이를 장점으로 내세울 수 있다.
- 정리(cleanup)는 Claude Code 규칙을 모델로: 깨끗하면 자동 삭제, 변경 있으면 확인, 머지 감지 후 "정리 가능" 배지. "archive"(Conductor)처럼 세션 종료와 워크트리 삭제를 한 동작으로.
- 리뷰 병목 때문에 "더 많은 병렬"보다 "주의가 필요한 세션 알림"(cmux 파란 링, Superset 알림)이 실제 가치. Aquila Agents의 상태 점/알림이 핵심 기능으로 맞다.
- "main 브랜치에서 바로 작업하는 세션" 요구도 있으므로 워크트리를 강제하지 말 것(Claude 데스크톱의 강제 워크트리 불만).

### Gaps

- Conductor 하위 문서(setup/run/archive 스크립트, `CONDUCTOR_PORT` 등 환경변수, 브랜치 네이밍)는 fetch한 인덱스 페이지에 없어 확인 못함.
- uzi, Cursor background agents, Claude Code web의 워크트리/포트 처리에 대한 사용자 증언은 이번 조사 범위(툴콜 한도) 안에서 찾지 못함.
- Reddit(r/ClaudeAI, r/ClaudeCode 등) 원문 스레드가 검색에 잡히지 않아 직접 인용 없음.

## 2. 프로젝트 온보딩: 레포 추가, 그룹핑, 프로젝트별 설정, setup 스크립트

### Takeaway

사용자는 "기존 로컬 폴더를 그대로 추가"하길 원하고, 클론/로그인/클라우드 계정을 앞세우는 온보딩에 반발한다. 프로젝트별 설정의 핵심은 setup 스크립트, 기본 브랜치, 사용할 에이전트/모드, "Open in…" 에디터다.

### Cited Findings

- Conductor는 GitHub에서 클론하는 방식이라 기존 체크아웃을 기대한 사용자 혼란("does NOT work the way I expected"); "GitHub 인증 없이 로컬 git" 요청(cloudking) — [Show HN: Conductor](https://news.ycombinator.com/item?id=44594584)
- 프로젝트별 요청: 새 워크스페이스의 기본 브랜치 설정(dgritsko), 커스텀 "Open in…"(SourceTree 등), 멀티레포 태스크(jerezzprime) — 같은 스레드
- Superset: 임포트한 프로젝트가 표시되지 않음(desireco42), 새 워크스페이스에서 모델/모드 선택 없음(tacone, dbbk), 로그인 대상이 불명확(drcongo; 메이커 "cloud service에 로그인"), git이 아닌 폴더 지원 요청(yawnxyz; 답: git init으로 초기화) — [Launch HN: Superset](https://news.ycombinator.com/item?id=48236770)
- Superset은 레포 안의 `.superset/config.json`에 setup/teardown 정의(팀과 공유 가능) — [Superset README](https://github.com/superset-sh/superset/blob/main/README.md)
- Codex 앱: 레포에 `.codex/environments/environment.toml`(local environment)로 setup 정의 — [Daniel Vaughan](https://codex.danielvaughan.com/2026/04/11/codex-app-worktree-lifecycle-local-environments/) (3자)
- Claude Code: 처음 보는 디렉터리에서는 workspace trust 대화상자를 한 번 통과해야 `--worktree`가 동작 — [Claude Code docs](https://code.claude.com/docs/en/worktrees.md)

### Inferences

- Aquila Agents의 "프로젝트 추가" UI: 폴더 피커 + 최근 폴더 + (가능하면) `~/.claude/projects` 등에서 최근 사용 레포 자동 감지(읽기만). 비-git 폴더는 허용하되 워크트리 버튼만 비활성.
- 프로젝트별 설정 항목 후보: 계정(이미 있음), 기본 에이전트(claude/codex/shell), 기본 브랜치, setup 스크립트, 포트 베이스, "Open in" 에디터. 설정을 레포 안 파일(예: `.aquila.json`)로도 읽을 수 있게 하면 팀 공유 가능 — 단 Superset/Codex처럼 별도 포맷을 또 만드는 대신 Claude Code의 `.worktreeinclude`를 재사용하는 것이 사용자 부담이 적음.
- 처음 실행하는 디렉터리의 trust 대화상자 때문에 워크트리 생성이 실패할 수 있음 → Aquila Agents가 워크트리 생성 전에 이를 안내해야 함.

### Gaps

- 레포 자동 감지/최근 레포 목록 UX에 대한 구체적 사용자 증언은 찾지 못함.
- 프로젝트 그룹핑/정렬에 대한 사용자 요구 자료 없음.

## 3. 다중 Claude 계정/구독: 전환, 사용량/레이트 리밋 가시성

### Takeaway

`CLAUDE_CONFIG_DIR` 디렉터리 분리가 사실상 표준(Aquila Agents 방식과 동일)이며, 사용자가 원하는 것은 (1) 재로그인 없는 전환, (2) 프로젝트별 계정 고정, (3) **계정별 5시간/주간 사용량 막대를 나란히**, (4) 한도 근처에서 자동 전환이다. 기존 statusline은 동시에 여러 계정을 돌릴 때 사용량 표시가 섞이는 버그가 보고됨.

### Cited Findings

- 6가지 방법: `/login`(한 번에 하나), `CLAUDE_CONFIG_DIR`(동시 사용 가능, 설정·히스토리·플러그인이 디렉터리별로 분리되어 각각 세팅 필요, "레포가 계정을 골라주지 못함"), `claude setup-token`(모델 요청만, Remote Control/커넥터 불가), claude-swap(`cswap auto`는 한도 90%에서 자동 전환), clauth(모든 계정 사용량 TUI, fallback 체인), Enjoy(유료, 프로젝트별 계정, 사용량 막대 나란히, 대화를 남은 계정으로 이동) — [enjoy.dev](https://enjoy.dev/blog/multiple-claude-code-accounts/) (Enjoy 판매사 글)
- 주의점: macOS Keychain 항목이 디렉터리별; `CLAUDE_CONFIG_DIR=~/.claude`를 명시하면 기본 `claude`와 **별도 Keychain 항목**이 생김 → 기본 계정은 그렇게 alias하지 말 것 — [enjoy.dev](https://enjoy.dev/blog/multiple-claude-code-accounts/), 검색 요약의 다른 가이드들([aq.dev](https://aq.dev/guides/run-multiple-claude-code-accounts/), [crowsnest](https://crowsnest.app/guides/use-multiple-claude-code-accounts/))
- 세션 히스토리는 계정 디렉터리별이라 공유되지 않음; 전환 직후 첫 메시지는 캐시 재구축으로 사용량을 더 씀; `CLAUDE_CODE_OAUTH_TOKEN`이 남아있으면 새 세션에 계속 적용 — [enjoy.dev](https://enjoy.dev/blog/multiple-claude-code-accounts/)
- 약관: Anthropic Claude Code 팀 Thariq가 2026년 2월 "여러 Max 계정 보유는 약관 위반이 아니나 토큰 재판매는 위반"이라고 했다고 인용됨; 회사가 특정 조직 로그인을 강제할 수 있음 — [enjoy.dev](https://enjoy.dev/blog/multiple-claude-code-accounts/) (2차 인용, 원문 미확인)
- Pro/Max 한도는 claude.ai와 Claude Code가 계정 단위로 공유, 5시간 세션 한도 + 주간 한도 — [Anthropic support](https://support.anthropic.com/en/articles/11145838) (검색 요약 기반)
- ccusage: Anthropic API에서 실제 레이트리밋 데이터를 가져와 statusline에 표시, `CLAUDE_CONFIG_DIR` 사용 시 해당 디렉터리의 자격증명을 읽고 `usage-limits.json`을 씀 — [ccusage (PyPI)](https://pypi.org/project/ccusage/)
- 버그 보고: 서로 다른 계정으로 동시 세션을 돌리면 Claude Code가 statusline stdin JSON에 넣는 `rate_limits`가 모든 로컬 세션에 공유되어 표시가 섞임 — [claudeissues #68772](https://claudeissues.com/issue/68772-bug-concurrent-sessions-on-different-accounts-share-rate-limit-display-statuslin) (미러)
- 기능 요청: 결제 계정 + 5h/7d 레이트리밋 + 모델을 보여주는 기본 statusline — [claudeissues #82885](https://claudeissues.com/issue/82885-ship-a-built-in-zero-config-terminal-status-line-billing-account-5h-7d-rate-limi); 5시간/주간 cap 데이터를 statusline 입력에 추가 요청 — [claudeissues #13871](https://claudeissues.com/issue/13871-feature-add-5-hour-and-weekly-usage-cap-data-to-statusline-inputs)
- 5시간 창은 실제 추론 호출 후에야 시작된다는 설명 — [clauth docs](https://docs.rs/crate/clauth/0.6.2)
- Claude Usage Tracker(메뉴바 앱) v2.3.0: 모든 계정을 동시에 보여주는 멀티 프로필 표시 — [mdskills](https://www.mdskills.ai/skills/claude-usage-tracker)
- 사용자 체감: "You can basically burn through 100% usage through a single day"(Tooster); collin128이 "Anthropic의 6월 15일 변경으로 Conductor 사용이 programmatic으로 과금된다"고 언급했으나 스레드 내 확인 없음 — [Launch HN: Superset](https://news.ycombinator.com/item?id=48236770) (미검증 주장)

### Inferences

- Aquila Agents의 shared(`~/.claude`)/personal(`CLAUDE_CONFIG_DIR=~/.claude-personal`) 설계는 커뮤니티 표준과 일치. 단 shared 계정 실행 시 `CLAUDE_CONFIG_DIR`을 명시적으로 `~/.claude`로 설정하지 말고 **변수를 비워두어야** Keychain 분리 문제가 생기지 않음(코드 점검 권장).
- 차별화 기회: 사이드바/상단에 **계정별 5h·주간 사용량 막대 + 리셋 시각**을 나란히. 각 세션 탭에 어떤 계정으로 돌고 있는지 배지. ccusage 방식(디렉터리별 자격증명으로 조회)을 참고하되, Claude Code 자체 statusline의 공유 버그를 피하려면 세션별이 아닌 계정 디렉터리별로 조회해야 함.
- "한도 근처 자동 전환"은 수요가 있지만 약관/ToS 회색지대와 토큰 복사 리스크가 있음 → Aquila Agents는 규칙 6(사용자 CLI 설정 건드리지 않음)에 맞게 "한도 임박 알림 + 다른 계정으로 새 세션 열기" 버튼 정도가 적절.
- 계정 디렉터리 분리 시 설정/플러그인/히스토리가 따로라는 점이 불만 → personal 셋업 시 "shared의 settings를 복사할까요?" 같은 선택(명시적 확인 하에) 고려 가능.

### Gaps

- Anthropic 공식 문서의 다계정 사용량 API/정책 원문은 직접 확인 못함(지원 문서는 검색 요약만).
- Reddit에서의 계정 전환 불만 원문 인용 없음.
- "6월 15일 programmatic 과금 변경" 주장 진위 미확인.

## 4. 다수 에이전트 실행 시 리소스(CPU/메모리/배터리/팬/Electron) 불만

### Takeaway

리소스 문제의 주범은 래퍼 앱보다 **Claude Code 프로세스 자체**(유휴 시 인스턴스당 10~100% CPU, 장시간 세션 수십 GB 메모리, Apple Silicon 발열)로 다수 GitHub 이슈가 있다. 동시에 Electron 래퍼에 대한 "무겁다(2GB)" 불만도 있어, 가벼움 자체가 판매 포인트(cmux 네이티브, Superset "light")가 된다.

### Cited Findings

- 유휴 시 인스턴스당 CPU 10~90%, "여러 인스턴스를 돌리면 문제" (not planned로 종료) — [anthropics/claude-code #30807](https://github.com/anthropics/claude-code/issues/30807)
- 유휴 세션 2개에 인스턴스당 ~100% CPU(Linux) — [#22275](https://github.com/anthropics/claude-code/issues/22275); 유휴 2세션 합계 81.9% CPU(메모리 할당 thrashing) — [#18280](https://github.com/anthropics/claude-code/issues/18280)
- 여러 터미널로 24시간+ 후 30GB+ 메모리, 80%+ CPU — [#9711](https://github.com/anthropics/claude-code/issues/9711); 14시간 후 23GB, 143% CPU — [#11377](https://github.com/anthropics/claude-code/issues/11377)
- ~30분에 걸쳐 CPU/메모리 증가, `claude --resume`으로 재시작하면 정상화 (not planned) — [#22968](https://github.com/anthropics/claude-code/issues/22968)
- v2.1.4 이후 Apple Silicon에서 단일 인스턴스로도 심한 발열/스로틀링 — [#17563](https://github.com/anthropics/claude-code/issues/17563); 대화형 질문 프롬프트 대기 중 높은 CPU, "컴퓨터가 뜨거워짐" — [#9897](https://github.com/anthropics/claude-code/issues/9897)
- Electron 래퍼 불만: "vibe coded electron app, 2GB! is too much" — [Launch HN: Superset](https://news.ycombinator.com/item?id=48236770); 반대로 "vscode보다 훨씬 가볍게 느껴진다"(bicepjai) — 같은 스레드; cmux는 네이티브라 "runs light" — [ai-deck](https://ai-deck.app/blog/conductor-vs-superset-vs-cmux/)
- 긴 세션/4K에서 터미널 렌더링 글리치(micro23xd), 프리징(desireco42) — [Launch HN: Superset](https://news.ycombinator.com/item?id=48236770)

### Inferences

- Aquila Agents 시스템 모니터의 핵심 가치: **세션별(pty 프로세스 트리) CPU/RAM**을 보여주고 "유휴인데 CPU 높음"·"메모리 N GB 초과" 세션을 강조 + **"재시작(resume)"** 원클릭(#22968에서 resume이 정상화). 이는 래퍼가 해결 못 하는 CLI 버그에 대한 실용적 완화책.
- 배터리 사용 중일 때 경고/유휴 세션 일시정지 제안은 발열·배터리 이슈(#17563)와 직결.
- Aquila Agents 자체도 Electron이므로 xterm 렌더러(WebGL), 숨겨진 탭 렌더링 중지, 스크롤백 한도 등으로 "2GB" 비판을 피해야 함; 앱 자체 사용량도 모니터에 표시하면 신뢰도 상승.

### Gaps

- 팬/배터리 소모를 직접 측정한 사용자 보고(예: "N개 세션에서 배터리 X시간")는 찾지 못함.
- 위 이슈들이 최신 버전에서 수정됐는지 확인 안 함.
- Conductor/Superset 앱 자체의 측정된 메모리 수치 자료 없음(2GB 언급은 설치 용량인지 메모리인지 불명확).
