# 태스크

> English: [../en/TASKS.md](../en/TASKS.md)

지금까지 만든 것 (v0.1 기반): 그룹/프로젝트 사이드바, 프로젝트별 탭, xterm(WebGL) 안의 실제 `claude` / `codex` / 셸,
hooks 기반 Claude 상태, 그 외 세션은 출력 기반 상태, 알림, 프로젝트별 공용/개인 Claude 계정, 한/영 UI, 디자인 시스템,
단축키 ⌘T ⌘⇧T ⌘⌥T ⌘W ⌘1–9.

**병렬로 진행하는 법:** 세션 하나에 태스크 하나, 각자 브랜치/워크트리에서
(`git worktree add ../agentrix-T1 -b task/T1-split-view`). **담당 파일** 안에서만 작업하세요. 공유 파일
(`pages/workspace/*`, `src/shared/api/types.ts`, `src/shared/i18n/dictionary.ts`, `electron/main.ts`, `electron/preload.ts`, `components.css`)은
작게, 추가 위주로만 수정합니다. 같은 공유 파일을 건드리는 태스크끼리는 번호 순서대로 머지합니다.

---

### T1 · 화면 분할
- [x] **목표:** 세션 2~4개를 한 화면에서 보고 채팅 (프로젝트 상관없이).
  _남은 것: 패널 크기는 반반 고정(경계선 드래그로 크기 조절 없음), 화면이 하나일 땐 `.c-pane__head` 숨김(탭 바와 중복)._
- **UX:** ⌘D 오른쪽 분할, ⌘⇧D 아래 분할, ⌘⌥방향키로 포커스 이동, 탭을 패널 가장자리로 끌어 놓으면 그 방향으로 분할.
  각 패널에 `.c-pane__head` (상태 점 · 종류 · 프로젝트 · 계정). 포커스된 패널은 `data-focused`.
- **담당:** `src/widgets/split-view/`, `src/widgets/split-view/model/layout.ts` (+ 테스트), `src/widgets/session-stage/` (split-view로 합침).
- **완료 기준:** 프로젝트를 바꿔도 레이아웃 유지, 세션을 닫으면 패널이 합쳐짐, 크기 바뀌면 xterm 다시 맞춤.

### T2 · 계정 설정 (공용 `claude` / 개인 `claude-personal`)
- [ ] **목표:** `claude-personal`이 없는 사람도 앱에서 바로 설정.
- **스펙:**
  - Main: `accounts:status` → 계정마다 `{ configDirExists, loggedIn }` (`loggedIn` = `<dir>/.claude.json`에
    `oauthAccount`가 있음, 공용은 `~/.claude.json`).
  - 개인 계정이 준비 안 됐으면 `AccountSwitch`에 점 + "설정하기" 표시 → 폴더를 만들고 그 계정으로 Claude 세션을 열기
    (Claude가 자체 `/login` 진행).
  - 선택, **사용자가 명시적으로 눌렀을 때만**: "터미널에서도 `claude-personal` 쓰기" → `~/.zshrc`에
    `claude-personal() { CLAUDE_CONFIG_DIR="$HOME/.claude-personal" command claude "$@"; }`가 없으면 추가
    (먼저 미리보기 표시). rc 파일에 쓰는 건 여기가 유일한 예외.
- **담당:** `electron/accounts.ts`, `src/features/setup-account/`, `src/features/switch-account/`.

### T3 · 변경사항 패널
- [ ] **목표:** 에이전트가 바꾼 걸 앱 안에서 바로 확인.
- **UX:** ⌘⇧G로 오른쪽 `.c-panel` 토글: 브랜치, 변경 파일(상태 글자 + 경로), `.c-diff__line--*`로 그린 diff.
  앱에 포커스가 오면, 그리고 열려 있는 동안 5초마다 새로고침.
- **담당:** `electron/git.ts` (`git status --porcelain=v1 -b`, `git diff --no-color`, 400KB 제한),
  `src/widgets/changes-panel/`, `src/entities/diff/` (parseDiff + 테스트).

### T4 · 다시 열면 세션 복원
- [ ] **목표:** 앱을 다시 켜면 탭이 돌아옴.
- **스펙:** 열린 탭을 `~/.agentrix/state.json`에 저장. Claude: 우리가 만든 `--session-id <uuid>`로 시작하고
  `claude --resume <uuid>`로 복원. Codex: 해당 폴더에서 `codex resume --last`. 셸: 새 셸.
- **담당:** `electron/state.ts`, `sessions.ts`에 작은 추가.

### T5 · 프로젝트 관리 UI (JSON 직접 수정 없이)
- [ ] **목표:** 앱에서 프로젝트/그룹 추가·이름 변경·삭제·순서 변경.
- **UX:** 사이드바 아래 "+" → 폴더 선택(`dialog.showOpenDialog`), 이름 = 폴더 이름, 그룹 + 계정 선택.
  행 우클릭 → 이름 변경 / 그룹 변경 / 삭제. 끌어서 순서 변경.
- **담당:** `src/features/manage-projects/`, `electron/config.ts` (저장 헬퍼 추가).

### T6 · 커맨드 팔레트
- [ ] **목표:** ⌘K로 어떤 프로젝트/세션이든 바로 이동하거나 동작 실행.
- **담당:** `src/widgets/command-palette/`, `src/shared/lib/fuzzy.ts` (+ 테스트).

### T7 · 워크트리 세션
- [ ] **목표:** "워크트리에서 새 Claude" → `../<repo>-wt/<branch>` 만들고 거기서 세션 시작, 탭에 브랜치 표시.
- **담당:** `electron/worktrees.ts`, `src/features/open-in-worktree/`.

### T8 · 패키징
- [ ] **목표:** `npm run dist` → /Applications로 옮길 수 있는 `Agentrix.app` (arm64).
- **스펙:** electron-builder, 디자인 시스템 기반 아이콘(어두운 타일 + 강조색 마크), `node-pty`는 asar 밖으로.
- **담당:** `electron-builder.yml`, `build/`, `package.json` 스크립트.

### T9 · 배터리 측정
- [ ] **목표:** 추측 말고 숫자로.
- **스펙:** `scripts/measure-energy.sh`가 같은 세션 3개 조건에서 Agentrix와 Terminal.app을 `top -l 6 -s 5 -o power`로 측정,
  결과를 `docs/en/ENERGY.md` + `docs/ko/ENERGY.md`에 기록.
- **담당:** `scripts/`, 위 두 문서.

### T10 · 라이트 테마 (나중에)
- [ ] `tokens.css`에 `[data-theme='light']` 시맨틱 재매핑 추가, 터미널 테마도 따라감. 컴포넌트 수정은 금지.

### T11 · 세션 히스토리 · 세션 삭제 · 메모리 비우기
- [ ] **목표:** 프로젝트별로 지난 세션 목록을 보고, 이어서 열고, 필요 없는 건 지우고, Claude 프로젝트 메모리를 비우기.
- **데이터 (읽기):**
  - Claude: `<configDir>/projects/<인코딩된-경로>/*.jsonl` (절대경로의 `/`와 `.`을 `-`로 바꾼 이름),
    계정별 설정 폴더 **모두** (`~/.claude`, `~/.claude-personal`). 제목 = 첫 사용자 메시지, 그리고
    마지막 수정 시각, 메시지 수, 계정.
  - Codex: `~/.codex/sessions/**/rollout-*.jsonl` 중 `cwd`가 이 프로젝트인 것.
- **UX:** "히스토리"(⌘Y) 패널 (`.c-panel`): 날짜별 목록, 검색창, 행마다 이어서 열기 · 삭제.
  이어서 열기 = 새 탭에서 `claude --resume <id>` (맞는 계정으로) / `codex resume <id>`.
  프로젝트 메뉴: "Claude 메모리 비우기" → `<configDir>/projects/<인코딩된-경로>/memory/`.
  세션 탭 메뉴: "대화 컨텍스트 비우기" → 해당 Claude pty에 `/clear` + Enter 전송 (파일은 건드리지 않음).
- **안전 (필수):** 삭제와 메모리 비우기는 **macOS 휴지통으로 이동**(`shell.trashItem`), `rm` 금지.
  항상 앱 안 확인 창에서 지워질 대상(개수 + 경로)을 정확히 보여주고 확인받기. 지금 탭에 열려 있는 세션은 건드리지 않기.
  `~/.claude*` / `~/.codex` 안에 쓰는 건 여기만 예외.
- **담당:** `electron/history.ts` (+ 경로 인코딩/파싱 테스트, 픽스처 파일), `src/widgets/history-panel/`, `src/features/resume-session/`,
  `src/features/delete-session/`, `src/features/clear-memory/`, `src/shared/ui/ConfirmDialog.tsx`.

### T12 · 시스템 모니터 (CPU · RAM · 배터리 · 세션별)
- [ ] **목표:** 컴퓨터 부하를 한눈에, 그리고 어떤 세션이 자원을 먹는지 확인.
- **UX:** 사이드바 하단에 작은 미터 줄: CPU %, 메모리 사용/전체 + 압력 색상
  (`--color-status-done` 정상, `-waiting` 주의, `-error` 위험), 스왑 사용량, 배터리 % + 충전 여부 + 남은 시간.
  클릭 → 팝오버: 세션별 행(프로젝트 · 종류 · CPU % · RAM)과 그 외 상위 프로세스 5개
  (예: 잊고 켜둔 `next dev` 발견용). 탭에 마우스를 올리면 그 세션의 CPU/RAM 표시.
- **데이터 (main, 새 의존성 없이):** CPU는 `os.cpus()` 차이값, 메모리는 `vm_stat` + `sysctl hw.memsize` +
  `sysctl vm.swapusage` + `memory_pressure -Q`, 배터리는 `pmset -g batt`, 세션별은 pty pid의 프로세스 트리를
  `ps -Ao pid,ppid,%cpu,rss`로 합산.
- **배터리 고려:** 창이 보이고 포커스일 때만 3초마다, 포커스가 없으면 15초마다, 창이 숨겨지면 멈춤.
- **담당:** `electron/system.ts` (+ `vm_stat`/`pmset`/`ps` 파서 테스트, 픽스처 출력 사용),
  `src/widgets/system-meter/`, `src/entities/system/`.
