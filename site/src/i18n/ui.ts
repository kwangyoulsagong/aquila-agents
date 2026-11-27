/**
 * Every string on the site, Korean and English. `ko` defines the shape; `en` must match it (typecheck fails otherwise).
 * Feature copy follows the in-app guide (src/shared/i18n/dictionary.ts) — keep them telling the same story.
 */

export const LANGS = ['ko', 'en'] as const;
export type Lang = (typeof LANGS)[number];

const ko = {
  meta: {
    title: 'Aquila Agents — 모든 에이전트를 한 창에서',
    description:
      'Claude Code, Codex, 셸 세션을 프로젝트별로 한 창에 모으고, 누가 일하는지·끝났는지·나를 기다리는지 한눈에 보는 데스크톱 앱.',
  },
  nav: {
    features: '기능',
    notes: '노트',
    compare: '비교',
    faq: 'FAQ',
    download: '다운로드',
    language: 'English',
    skip: '본문으로 건너뛰기',
    menu: '메뉴',
  },
  hero: {
    pill: '1.4 — 블록으로 편집하는 노트, 표 보기',
    titleA: '모든 에이전트를,',
    titleB: '한 창에서.',
    sub: '프로젝트마다 터미널을 옮겨 다니지 마세요. Claude Code, Codex, 셸을 탭으로 열고 누가 일하는지, 끝났는지, 나를 기다리는지 한눈에 봅니다.',
    ctaMac: 'macOS용 다운로드',
    ctaGithub: 'GitHub',
    meta: 'macOS · Apple Silicon · 한국어 / English',
  },
  mock: {
    projects: '프로젝트',
    review: '리뷰할 것',
    claude: 'Claude',
    codex: 'Codex',
    shell: 'zsh',
    toastTitle: 'api · Codex',
    toastBody: '입력을 기다려요',
    claudeLines: [
      '> 결제 페이지 테스트가 왜 실패하는지 찾아서 고쳐줘',
      '● checkout.test.ts 읽는 중…',
      '● 원인: 통화 반올림이 0.5에서 내림돼요',
      '● src/money.ts 수정 (+4 −2)',
      '✓ 테스트 42개 통과',
    ],
    codexLines: [
      '> API 응답에 페이지네이션 추가',
      '• routes/orders.ts 계획 세우는 중',
      '• cursor 기반으로 구현할까요? (y/n)',
    ],
  },
  marquee: { label: '이미 쓰고 있는 그대로 돌아가요' },
  film: {
    eyebrow: '1분 둘러보기',
    title: '말보다 화면으로.',
    sub: '실제 앱 화면이에요. 챕터를 눌러 원하는 곳부터 보세요.',
    play: '재생',
    pause: '일시정지',
    chapters: [
      { id: 'sessions', title: '세션 열기', caption: '⌘T 한 번이면 지금 프로젝트에서 Claude가 열려요.' },
      { id: 'attention', title: '기다리는 세션', caption: '⌘J로 입력을 기다리는 세션에 바로 도착해요.' },
      { id: 'split', title: '화면 분할', caption: '⌘D로 나눠 최대 4개 에이전트를 나란히 봐요.' },
      { id: 'changes', title: '변경사항 리뷰', caption: '에이전트가 바꾼 diff를 보고, 줄에 코멘트를 달아요.' },
      { id: 'worktree', title: '워크트리', caption: '브랜치마다 따로, 서로 부딪히지 않게.' },
      { id: 'palette', title: '명령 팔레트', caption: '⌘K로 프로젝트, 세션, 명령 어디든.' },
      { id: 'graph', title: '노트 그래프', caption: '노트와 세션, 바뀐 파일이 이어진 지도.' },
    ],
  },
  principles: {
    eyebrow: '진짜 CLI',
    title: '다시 만든 채팅이 아니라, 진짜 CLI.',
    sub: 'Aquila는 설치된 claude와 codex를 실제 터미널에서 그대로 실행해요. 채팅도, 권한 확인도, 슬래시 명령도 다시 만들지 않아요.',
    items: [
      {
        title: '같은 로그인, 같은 설정',
        body: 'CLAUDE.md, 훅, MCP, 슬래시 명령, 토큰 사용량까지 터미널에서 쓰던 그대로예요.',
      },
      {
        title: '내 설정은 건드리지 않아요',
        body: '상태를 읽는 훅은 Aquila가 띄운 세션에만 --settings로 붙여요. ~/.claude나 ~/.codex에는 쓰지 않아요.',
      },
      {
        title: '내 컴퓨터에서만',
        body: '상태와 기록은 ~/.aquila에 남아요. Claude 호출이 필요한 기능은 누를 때만, 보낼 내용을 먼저 보여줘요.',
      },
    ],
  },
  status: {
    eyebrow: '상태',
    title: '누가 나를 기다리는지, 바로 보여요.',
    sub: '에이전트 열 개를 돌려도 놓치지 않아요. 색 하나로 상태를 읽고, 단축키 하나로 기다리는 세션에 도착해요.',
    legend: { working: '작업 중', waiting: '입력 필요', error: '오류', done: '완료' },
    steps: [
      {
        title: '상태 점',
        body: '주황은 입력 필요, 빨강은 오류, 파랑은 작업 중, 초록은 완료. 프로젝트와 세션마다 보여요.',
        kbd: '',
      },
      {
        title: '다음 대기 세션',
        body: '입력을 기다리는 세션으로 바로 가요. 누를수록 오래 기다린 순서로 돌아요.',
        kbd: '⌘J',
      },
      {
        title: '알림 · Dock 배지',
        body: '다른 곳을 볼 때 입력 필요와 오류만 알려요. Dock 배지는 기다리는 세션 수예요.',
        kbd: '',
      },
      {
        title: '리뷰할 것',
        body: '보지 않는 사이 끝난 세션이 바뀐 파일 수, 브랜치와 함께 오래된 순서로 모여요.',
        kbd: '',
      },
    ],
  },
  showcase: {
    eyebrow: '작업 흐름',
    title: '여는 것부터 리뷰까지, 한 곳에서.',
    sub: '분할해서 나란히 보고, 바뀐 코드를 리뷰하고, 브랜치마다 따로 돌려요.',
    tabs: [
      {
        id: 'split',
        label: '화면 분할',
        body: '최대 4개 세션을 나란히. 탭을 가장자리로 끌어도 나뉘어요.',
        kbd: '⌘D',
      },
      {
        id: 'changes',
        label: '변경사항',
        body: '에이전트가 바꾼 파일과 diff를 옆에서 보고, 줄에 코멘트를 남겨 세션에 붙여 넣어요.',
        kbd: '⇧⌘G',
      },
      {
        id: 'worktree',
        label: '워크트리',
        body: '브랜치마다 ../<저장소>-wt/<브랜치>에서 따로 작업해요. .env처럼 필요한 파일만 복사해요.',
        kbd: '',
      },
      {
        id: 'preview',
        label: '미리보기',
        body: '실행 중인 앱을 옆에서 보고, 요소를 클릭하면 선택자와 스크린샷이 에이전트 탭에 붙어요.',
        kbd: '',
      },
      {
        id: 'remote',
        label: '원격 SSH',
        body: 'SSH 호스트의 폴더를 프로젝트로 추가해요. 세션은 tmux에서 돌아 연결이 끊겨도 이어져요.',
        kbd: '',
      },
      {
        id: 'history',
        label: '세션 기록',
        body: '지난 Claude·Codex 세션을 대화 내용으로 찾아 새 탭에서 이어 해요.',
        kbd: '⌘Y',
      },
    ],
  },
  notes: {
    eyebrow: '노트',
    title: '코드 옆에 사는 노트.',
    sub: '프로젝트 폴더의 Markdown이 설정 없이 그래프가 되고, 에이전트가 바꾼 부분은 diff로 돌아봐요. 파일은 끝까지 그냥 Markdown이에요.',
    big: {
      title: '노트 그래프',
      body: '노트, 세션, 바뀐 파일이 어떻게 이어지는지 이번 주, 전체 지도, 주변으로 봐요.',
    },
    cards: [
      { id: 'blocks', title: '블록 편집', body: '⋮⋮ 손잡이로 옮기고, / 로 제목·할 일·표를 넣어요.' },
      {
        id: 'properties',
        title: '속성 · 표 보기',
        body: 'frontmatter를 속성 줄로 고치고, 노트를 표로 모아 정렬해요.',
      },
      {
        id: 'whatIsThis',
        title: '이게 뭐야?',
        body: '받은 기획서·PDF·Figma 링크를 넣으면 제품, 기능, 의도, 열린 질문을 정리해요.',
      },
    ],
  },
  grid: {
    eyebrow: '디테일',
    title: '매일 쓰는 작은 것들까지.',
    inspect: '눌러서 보기',
    close: '닫기',
    items: [
      {
        id: 'palette',
        title: '명령 팔레트',
        body: '프로젝트, 세션, 명령을 이름 일부로 찾아 실행해요.',
        kbd: '⌘K',
      },
      {
        id: 'terminal',
        title: '터미널 도우미',
        body: '이미지 붙여 넣기, 찾기, URL·경로를 라벨 키로 복사. 붙여 넣기만으론 명령이 실행되지 않아요.',
        kbd: '',
      },
      {
        id: 'accounts',
        title: 'Claude 계정 두 개',
        body: '공용(claude)과 개인(claude-personal)을 프로젝트마다 한 번에 바꿔요.',
        kbd: '',
      },
      {
        id: 'designer',
        title: '디자이너 비교',
        body: '앱과 Figma를 나란히 또는 겹쳐 보고, 다른 곳을 에이전트에 보내 고쳐요.',
        kbd: '',
      },
      {
        id: 'run',
        title: 'Run',
        body: 'dev 서버와 테스트 워처를 에이전트와 따로 띄우고 상태를 봐요.',
        kbd: '',
      },
      {
        id: 'globalShortcut',
        title: '전역 단축키',
        body: '어느 앱에서든 누르면 가장 오래 기다린 세션이 앞으로 와요.',
        kbd: '',
      },
      {
        id: 'restore',
        title: '다시 열면 그대로',
        body: '탭과 분할이 돌아오고, Claude·Codex는 대화를 이어서 열어요.',
        kbd: '',
      },
      {
        id: 'power',
        title: '배터리 절약',
        body: '배터리·발열 중에는 애니메이션과 갱신을 줄여 전력을 아껴요.',
        kbd: '',
      },
    ],
  },
  shortcuts: {
    title: '손이 키보드를 떠나지 않게.',
    items: [
      { keys: ['⌘', 'T'], label: 'Claude 열기' },
      { keys: ['⌘', 'D'], label: '오른쪽으로 분할' },
      { keys: ['⌘', 'J'], label: '다음 대기 세션' },
      { keys: ['⌘', 'K'], label: '명령 팔레트' },
      { keys: ['⇧', '⌘', 'G'], label: '변경사항 패널' },
      { keys: ['⌘', '1–9'], label: '프로젝트로 이동' },
    ],
  },
  compare: {
    eyebrow: '비교',
    title: '터미널 창 여러 개 대신.',
    colUs: 'Aquila',
    colThem: '프로젝트마다 터미널',
    rows: [
      { label: '진짜 claude · codex CLI', us: true, them: true },
      { label: '모든 세션 상태를 한눈에', us: true, them: false },
      { label: '입력을 기다리면 알림', us: true, them: false },
      { label: '프로젝트별로 정리된 세션', us: true, them: false },
      { label: '바뀐 코드 diff 리뷰와 코멘트', us: true, them: false },
      { label: '다시 열면 탭·대화 복원', us: true, them: false },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: '자주 묻는 질문',
    items: [
      {
        q: 'Claude Code나 Codex가 따로 필요한가요?',
        a: '네. Aquila는 이미 설치되고 로그인된 claude, codex를 그대로 실행해요. 같은 계정과 요금제를 쓰고, 토큰 사용량도 터미널에서 쓸 때와 같아요.',
      },
      {
        q: '제 Claude 설정 파일이 바뀌나요?',
        a: '아니요. 상태를 읽는 훅은 Aquila가 띄운 세션에만 --settings 옵션으로 붙여요. ~/.claude, ~/.codex, 셸 설정 파일에는 쓰지 않아요.',
      },
      {
        q: 'Windows나 Linux도 되나요?',
        a: '지금은 macOS(Apple Silicon)만 지원해요. Intel Mac과 다른 OS는 아직이에요.',
      },
      {
        q: '처음 열 때 "확인되지 않은 개발자"라고 떠요.',
        a: '아직 서명 전이라 그래요. 앱을 우클릭 → 열기 → 열기를 한 번 하면 돼요.',
      },
      {
        q: '원격 서버에서도 쓸 수 있나요?',
        a: '네. SSH 호스트의 폴더를 프로젝트로 추가하면 세션이 호스트의 tmux에서 돌아서, 연결이 끊겨도 이어져요.',
      },
      {
        q: '업데이트는 어떻게 받나요?',
        a: '새 버전이 나오면 앱이 알려 주고, 무엇이 바뀌었는지 릴리스 노트를 보여줘요.',
      },
    ],
  },
  download: {
    eyebrow: '다운로드',
    title: '오늘 밤엔 터미널 대신 한 창으로.',
    sub: 'claude 또는 codex가 설치되고 로그인되어 있으면 바로 시작할 수 있어요.',
    mac: { title: 'macOS', detail: 'Apple Silicon · .dmg', cta: '다운로드' },
    stepsTitle: '처음 설치할 때',
    steps: [
      '.dmg를 열고 Aquila Agents를 응용 프로그램으로 끌어다 놓아요.',
      '처음 실행이 막히면 앱을 우클릭 → 열기 → 열기.',
      '시작 점검이 CLI, PATH, 프로젝트 폴더를 확인해 줘요.',
    ],
    releases: '모든 릴리스 보기',
  },
  footer: {
    tagline: '모든 Claude Code · Codex 세션을, 한 창에서.',
    product: '제품',
    resources: '리소스',
    releases: '릴리스',
    github: 'GitHub',
    madeWith: 'Aquila 안에서, 에이전트와 함께 만들었어요.',
  },
};

export type Dict = typeof ko;

const en: Dict = {
  meta: {
    title: 'Aquila Agents — Every agent, one window',
    description:
      'A desktop app that gathers your Claude Code, Codex and shell sessions by project in one window — and shows which agent is working, done, or waiting for you.',
  },
  nav: {
    features: 'Features',
    notes: 'Notes',
    compare: 'Compare',
    faq: 'FAQ',
    download: 'Download',
    language: '한국어',
    skip: 'Skip to content',
    menu: 'Menu',
  },
  hero: {
    pill: '1.4 — Block-editing notes and a table view',
    titleA: 'Every agent,',
    titleB: 'one window.',
    sub: 'Stop juggling a terminal per project. Open Claude Code, Codex and a shell as tabs, and see at a glance which agent is working, done, or waiting for you.',
    ctaMac: 'Download for macOS',
    ctaGithub: 'GitHub',
    meta: 'macOS · Apple Silicon · English / 한국어',
  },
  mock: {
    projects: 'Projects',
    review: 'To review',
    claude: 'Claude',
    codex: 'Codex',
    shell: 'zsh',
    toastTitle: 'api · Codex',
    toastBody: 'Needs your input',
    claudeLines: [
      '> Find out why the checkout tests fail and fix it',
      '● Reading checkout.test.ts…',
      '● Cause: currency rounding floors at 0.5',
      '● Edited src/money.ts (+4 −2)',
      '✓ 42 tests passed',
    ],
    codexLines: [
      '> Add pagination to the orders API',
      '• Planning routes/orders.ts',
      '• Use cursor-based pagination? (y/n)',
    ],
  },
  marquee: { label: 'Runs what you already use' },
  film: {
    eyebrow: 'A one-minute tour',
    title: 'Show, don’t tell.',
    sub: 'This is the real app. Pick a chapter to jump in.',
    play: 'Play',
    pause: 'Pause',
    chapters: [
      { id: 'sessions', title: 'Open sessions', caption: 'One ⌘T opens Claude in the current project.' },
      { id: 'attention', title: 'Waiting sessions', caption: '⌘J lands you on the session that needs input.' },
      { id: 'split', title: 'Split view', caption: '⌘D splits — up to four agents side by side.' },
      { id: 'changes', title: 'Review changes', caption: 'Read the diff an agent made and comment on a line.' },
      { id: 'worktree', title: 'Worktrees', caption: 'One branch each, never in each other’s way.' },
      { id: 'palette', title: 'Command palette', caption: '⌘K to any project, session or action.' },
      { id: 'graph', title: 'Notes graph', caption: 'A map of notes, sessions and changed files.' },
    ],
  },
  principles: {
    eyebrow: 'Real CLIs',
    title: 'Not a chat clone. The real CLI.',
    sub: 'Aquila runs the claude and codex you installed, in a real terminal. No rebuilt chat, no rebuilt permission prompts, no rebuilt slash commands.',
    items: [
      {
        title: 'Same login, same setup',
        body: 'CLAUDE.md, hooks, MCP, slash commands, token usage — exactly as in your terminal.',
      },
      {
        title: 'Your setup stays yours',
        body: 'Status hooks attach with --settings, only to sessions Aquila starts. Nothing is written to ~/.claude or ~/.codex.',
      },
      {
        title: 'On your Mac',
        body: 'State and history stay in ~/.aquila. Features that call Claude run only when you click, and show what they send first.',
      },
    ],
  },
  status: {
    eyebrow: 'Status',
    title: "See who's waiting on you.",
    sub: 'Run ten agents and miss nothing. Read status from one color, land on the waiting session with one key.',
    legend: { working: 'Working', waiting: 'Needs input', error: 'Error', done: 'Done' },
    steps: [
      {
        title: 'Status dots',
        body: 'Orange needs input, red is an error, blue is working, green is done — per project and per session.',
        kbd: '',
      },
      {
        title: 'Next waiting session',
        body: 'Jump straight to the session that waits for you. Repeats cycle through them, longest wait first.',
        kbd: '⌘J',
      },
      {
        title: 'Notifications · Dock badge',
        body: "Only needs-input and errors are notified while you're elsewhere. The Dock badge counts waiting sessions.",
        kbd: '',
      },
      {
        title: 'To review',
        body: 'Sessions that finished while you looked away gather oldest first, with changed files and branch.',
        kbd: '',
      },
    ],
  },
  showcase: {
    eyebrow: 'Workflow',
    title: 'From opening to review, in one place.',
    sub: 'Split to see them side by side, review what changed, and run each branch on its own.',
    tabs: [
      {
        id: 'split',
        label: 'Split view',
        body: 'Up to 4 sessions side by side. Drag a tab onto a pane edge to split.',
        kbd: '⌘D',
      },
      {
        id: 'changes',
        label: 'Changes',
        body: 'See the files and diff the agent changed, comment on a line, paste the comments into the session.',
        kbd: '⇧⌘G',
      },
      {
        id: 'worktree',
        label: 'Worktrees',
        body: 'Each branch works in ../<repo>-wt/<branch>. Only the ignored files you list, like .env, are copied.',
        kbd: '',
      },
      {
        id: 'preview',
        label: 'Preview',
        body: 'See the running app beside the agent; click an element to paste its selector and a screenshot into the tab.',
        kbd: '',
      },
      {
        id: 'remote',
        label: 'Remote SSH',
        body: 'Add a folder on an SSH host as a project. Sessions run in tmux, so they survive a dropped connection.',
        kbd: '',
      },
      {
        id: 'history',
        label: 'History',
        body: 'Find past Claude and Codex sessions by what was said, and resume one in a new tab.',
        kbd: '⌘Y',
      },
    ],
  },
  notes: {
    eyebrow: 'Notes',
    title: 'Notes that live next to your code.',
    sub: 'Markdown in your project folders becomes a graph with no setup, and what an agent changed comes back as a diff. The files stay plain Markdown.',
    big: {
      title: 'Notes graph',
      body: 'See how notes, sessions and changed files connect — this week, as a map, or around one note.',
    },
    cards: [
      {
        id: 'blocks',
        title: 'Block editing',
        body: 'Drag the ⋮⋮ handle to move, type / for headings, to-dos and tables.',
      },
      {
        id: 'properties',
        title: 'Properties · Table view',
        body: 'Edit frontmatter as property rows; gather notes in a table to sort and filter.',
      },
      {
        id: 'whatIsThis',
        title: 'What is this?',
        body: 'Drop a spec, PDF or Figma link: get the product, feature, intent and open questions.',
      },
    ],
  },
  grid: {
    eyebrow: 'Details',
    title: 'Down to the little things you use daily.',
    inspect: 'Click to see',
    close: 'Close',
    items: [
      {
        id: 'palette',
        title: 'Command palette',
        body: 'Find any project, session or action by part of its name.',
        kbd: '⌘K',
      },
      {
        id: 'terminal',
        title: 'Terminal helpers',
        body: 'Paste images, find in output, copy URLs and paths by label. A paste alone never runs a command.',
        kbd: '',
      },
      {
        id: 'accounts',
        title: 'Two Claude accounts',
        body: 'Shared (claude) or personal (claude-personal) per project, one click to switch.',
        kbd: '',
      },
      {
        id: 'designer',
        title: 'Designer compare',
        body: 'See the app and Figma side by side or overlaid, and send the differences to an agent.',
        kbd: '',
      },
      {
        id: 'run',
        title: 'Run',
        body: 'Start dev servers and test watchers apart from the agent, and watch their status.',
        kbd: '',
      },
      {
        id: 'globalShortcut',
        title: 'Global shortcut',
        body: 'From any app, bring Aquila forward on the session that has waited longest.',
        kbd: '',
      },
      {
        id: 'restore',
        title: 'Back where you left',
        body: 'Tabs and splits come back; Claude and Codex resume their conversations.',
        kbd: '',
      },
      {
        id: 'power',
        title: 'Battery saver',
        body: 'On battery or running hot, the app animates and refreshes less.',
        kbd: '',
      },
    ],
  },
  shortcuts: {
    title: 'Hands stay on the keyboard.',
    items: [
      { keys: ['⌘', 'T'], label: 'Open Claude' },
      { keys: ['⌘', 'D'], label: 'Split right' },
      { keys: ['⌘', 'J'], label: 'Next waiting session' },
      { keys: ['⌘', 'K'], label: 'Command palette' },
      { keys: ['⇧', '⌘', 'G'], label: 'Changes panel' },
      { keys: ['⌘', '1–9'], label: 'Jump to project' },
    ],
  },
  compare: {
    eyebrow: 'Compare',
    title: 'Instead of a pile of terminal windows.',
    colUs: 'Aquila',
    colThem: 'A terminal per project',
    rows: [
      { label: 'The real claude · codex CLI', us: true, them: true },
      { label: 'Every session’s status at a glance', us: true, them: false },
      { label: 'Notified when an agent needs input', us: true, them: false },
      { label: 'Sessions organised by project', us: true, them: false },
      { label: 'Diff review with line comments', us: true, them: false },
      { label: 'Tabs and conversations restored on relaunch', us: true, them: false },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions',
    items: [
      {
        q: 'Do I need Claude Code or Codex installed?',
        a: 'Yes. Aquila runs the claude and codex you already installed and logged in to — same account, same plan, same token usage as in your terminal.',
      },
      {
        q: 'Does it change my Claude config?',
        a: 'No. Status hooks are attached with the --settings flag, only to sessions Aquila starts. It never writes to ~/.claude, ~/.codex or your shell rc files.',
      },
      {
        q: 'Does it run on Windows or Linux?',
        a: 'macOS on Apple Silicon, for now. Intel Macs and other systems are not supported yet.',
      },
      {
        q: 'macOS says “unidentified developer”.',
        a: "Builds aren't signed yet. Right-click the app → Open → Open, once.",
      },
      {
        q: 'Can I use it with remote servers?',
        a: 'Yes. Add a folder on an SSH host as a project; sessions run in tmux on the host, so they survive a dropped connection.',
      },
      {
        q: 'How do updates work?',
        a: 'The app tells you when a new version is out and shows its release notes.',
      },
    ],
  },
  download: {
    eyebrow: 'Download',
    title: 'Tonight, one window instead of ten terminals.',
    sub: 'If claude or codex is installed and logged in, you can start right away.',
    mac: { title: 'macOS', detail: 'Apple Silicon · .dmg', cta: 'Download' },
    stepsTitle: 'First install',
    steps: [
      'Open the .dmg and drag Aquila Agents to Applications.',
      'If the first launch is blocked, right-click the app → Open → Open.',
      'The setup checklist checks your CLIs, PATH and project folders.',
    ],
    releases: 'All releases',
  },
  footer: {
    tagline: 'Every Claude Code and Codex session, in one window.',
    product: 'Product',
    resources: 'Resources',
    releases: 'Releases',
    github: 'GitHub',
    madeWith: 'Built inside Aquila, alongside agents.',
  },
};

export const ui: Record<Lang, Dict> = { ko, en };

export function isLang(v: string | undefined): v is Lang {
  return (LANGS as readonly string[]).includes(v ?? '');
}
