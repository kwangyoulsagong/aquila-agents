# 디자이너·디자인 엔지니어·Figma를 쓰는 개발자를 위한 Aquila Agents: Figma 연동 + 앱 내 프리뷰 (2026-11 기준)

> 범위: 디자이너와 개발자가 Claude Code와 Codex를 Figma와 함께 쓰는 방식, 기존 통합 도구, 불만점, 앱 내 프리뷰 패턴, Figma MCP 자동 설정, Claude in Chrome과 브라우저 MCP를 쓴 디자인 QA, 그리고 Aquila Agents에 넣을 기능 후보.
> 출처 대부분은 2026년 자료다. 공식 문서를 우선했고, 벤더 블로그는 따로 표시했다. Reddit 원문 스레드는 검색에 거의 잡히지 않아 Figma 포럼, Substack, dev.to를 사용자 증거로 썼다.

## Figma ↔ 에이전트 연동 현황 (Figma MCP, Code Connect, Codex, 서드파티)

### Takeaway

2026년 말 기준 표준은 Figma 공식 **원격 MCP 서버 `https://mcp.figma.com/mcp`**(OAuth)다. 데스크톱 로컬 서버 `127.0.0.1:3845`는 조직/엔터프라이즈 용도로 밀려났다. Claude Code와 Codex는 둘 다 공식 지원 클라이언트이고, 읽기(design context, screenshot, variables, FigJam, comments)와 쓰기(live UI를 Figma로 보내는 `generate_figma_design`, `use_figma`)를 모두 지원한다. 사용자 불만은 **충실도 65~80%, 토큰이 hex/px로 붕괴, 느린 응답과 많은 토큰 소모, 플랜/시트별 rate limit 혼란**에 몰려 있다.

### Cited Findings

- Figma는 원격 서버를 권장하고(데스크톱 앱 없이 동작, 기능이 가장 많음), 데스크톱 서버는 "specific organization and enterprise needs"용으로 둔다. 원격 URL은 `https://mcp.figma.com/mcp`, 정부용은 `https://mcp.figma-gov.com/mcp`다. — [Figma Help: Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- MCP 서버는 모든 플랜에서 쓸 수 있지만 **MCP 클라이언트가 Figma MCP 카탈로그에 등록돼 있어야** 한다. Claude Code와 Codex는 desktop, remote, write-to-canvas, plugins/skills를 모두 지원하는 클라이언트로 등재돼 있다. 데스크톱 서버는 Professional 이상 플랜의 Dev 또는 Full 시트가 필요하고, 드래프트 밖 캔버스 쓰기는 Full 시트가 필요하다(베타 동안 무료, 이후 사용량 과금 예정). — [Figma Help](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- 디자인 컨텍스트를 얻는 기본 UX는 Figma에서 **선택 영역 링크를 복사해 클라이언트에 붙여넣는 것**이다(node ID를 추출함). — [Figma Help](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- 도구 목록(공식): 읽기 도구는 `get_design_context`(레이어/선택 영역의 컨텍스트와 코드, Design·Make), `get_screenshot`(노드 1개, PNG), `get_variable_defs`(선택 영역에서 쓰인 변수와 스타일), `get_metadata`(가벼운 XML 아웃라인), `get_figjam`(FigJam을 XML과 스크린샷으로), `get_comments`(원격 전용, 읽음 처리 안 함), `download_assets`(원격, 최대 20노드 PNG/JPG/SVG/PDF), `search_design_system`(원격), `get_code_connect_map`, `get_motion_context`, `whoami`(원격, 계정·플랜·시트) 등이다. 쓰기 도구는 `generate_figma_design`(live web UI를 Figma 레이어로, 원격 전용, 일부 클라이언트만, rate limit 미적용), `use_figma`, `html_to_figma`, `send_code_to_figma`, `generate_diagram`(Mermaid로 FigJam 다이어그램 생성), `add_code_connect_map` 등이다. 프롬프트로는 `create_design_system_rules`가 있다. — [Figma Developers: Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- 2026-02-17 Figma와 Anthropic이 "Code to Canvas"(`generate_figma_design`)를 발표했다. 실행 중인 브라우저 UI를 편집 가능한 Figma 레이어로 캡처하며, 당시에는 Claude Code 전용이자 Remote MCP 전용으로 보도됐다. — [925studios 플레이북](https://www.925studios.co/blog/2026-03-18-how-to-use-figma-mcp-with-claude-code-the-complete-playbook-2026), [codeminer42: What the demo didn't show](https://blog.codeminer42.com/figma-code-to-canvas-what-the-demo-didnt-show-you/)
- Claude Code 설정 경로는 세 가지다. ① `claude plugin install figma@claude-plugins-official`, ② `claude mcp add --transport http figma https://mcp.figma.com/mcp`, ③ 데스크톱 `http://127.0.0.1:3845/mcp`. 조직 관리자가 플러그인 설치를 막았으면 ②로 수동 추가한다. 가이드마다 transport 표기(sse/http)가 달라 공식 문서 확인이 필요하다. — [Griffin Wooldridge: Figma MCP + Claude Code Setup for Designers](https://griffinwooldridge.com/blog/figma-mcp-claude-code-setup), [alexbobes CTO guide](https://alexbobes.com/tech/figma-mcp-the-cto-guide-to-design-to-code-in-2026/)
- Figma 스스로 "The MCP server is not a one-click 'design to perfect code' tool"이라고 명시한다. — [toolradar 인용](https://toolradar.com/blog/figma-mcp-server)
- **Rate limit(공식):** Pro/Org 플랜의 Full 또는 Dev 시트는 하루 200 tool call, 분당 10회(Professional)다. Starter와 View/Collab 시트는 **월 6회(→ 최신 공식 페이지는 월 20회, 아래 "플랜별 기능 확인" 섹션 참조)**다. 쓰기 도구는 제외된다. 플랜 표에서는 분당 15회로 나와 공식 문서끼리도 불일치한다. — [Figma Developers: Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [Plans, access and permissions](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions)
- 사용자 보고: Professional Dev 시트인데도 Starter 한도에 걸린다. Figma 답변에 따르면 한도는 **시트 종류와 파일이 속한 플랜** 둘 다에 좌우된다. — [Figma Forum: stuck on starter limits](https://forum.figma.com/report-a-problem-6/figma-mcp-server-stuck-on-starter-limits-despite-active-professional-dev-seat-54926)
- 사용자 불만: "Figma MCP calls from Claude Code take a long time and use many tokens, and the generated quality is also low"라는 글과, design token이나 Tailwind config가 잘 정리되지 않은 것이 원인일 수 있다는 지적이 있다. — [Figma Forum: can't get good results](https://forum.figma.com/report-a-problem-6/figma-mcp-can-t-get-good-results-have-tried-many-things-41861)
- 토큰 충실도 문제: 화면은 맞아 보여도 토큰이 hex로 하드코딩된다. — [dev.to: My AI agent guesses design tokens repeatedly](https://dev.to/karthikeyan_sridhar_ecc11/my-ai-agent-guesses-design-tokens-repeatedly-mcp-doesnt-fix-it-either-570m). tokens 파일이 있어도 Tailwind 기본 팔레트로 회귀한다. — [developertoolkit.ai](https://developertoolkit.ai/en/ecosystem/mcp/design-tools-mcp/). 여러 AI 도구 비교에서 충실도는 65~80%였다. — [atomize.tools 블로그(2026-07)](https://atomize.tools/blog/figma-mcp/), 2차 인용이라 원 연구는 미확인
- 흔한 우회책: `get_variable_defs`로 토큰을 먼저 받고, `get_design_context`를 페이지가 아니라 섹션 단위로 호출하고, Code Connect를 세팅한다(Code Connect 매핑이 없으면 `get_code_connect_map`이 빈 값을 돌려준다). — [cc.bruniaux.com design-to-code](https://cc.bruniaux.com/guide/workflows/design-to-code/), [savvy.co.il production workflow](https://savvy.co.il/en/blog/wordpress-development/figma-mcp-production-workflow/)
- Codex: `~/.codex/config.toml` 또는 신뢰된 프로젝트의 `.codex/config.toml`에 `[mcp_servers.figma] url = "https://mcp.figma.com/mcp"`를 넣고, `codex mcp login figma`로 OAuth를 진행한다. 고정 콜백 포트는 `mcp_oauth_callback_port`, 자격증명 저장소는 `mcp_oauth_credentials_store`로 정한다. 공식 예시에는 `bearer_token_env_var = "FIGMA_OAUTH_TOKEN"` 방식도 있다. — [OpenAI Codex docs: MCP](https://developers.openai.com/codex/mcp), [Codex CLI + Figma MCP (danielvaughan)](https://codex.danielvaughan.com/2026/04/18/codex-cli-figma-mcp-design-to-code/)
- Builder.io(벤더 주장): 엔지니어가 repo를 한 번 연결하면 디자이너가 터미널이나 로컬 클론 없이 브랜치의 live UI를 시각적으로 편집해 PR을 만들 수 있다. "20+ parallel agents" in cloud containers. — [Builder.io blog](https://www.builder.io/blog/claude-code-visual-editor) (벤더 자사 비교라 독립 검증 없음)

### Inferences

- Aquila Agents가 Figma 연동을 **직접 구현할 필요는 없다**. 공식 MCP를 claude/codex 세션에 꽂아 주는 "배선 + UX"만 하면 된다(카탈로그 등재 클라이언트는 claude/codex이고 Aquila Agents는 호스트일 뿐이다).
- 사용자 불만 상위권인 토큰 충실도와 rate limit은 호스트가 개입할 지점이다. 예: 세션 시작 시 `create_design_system_rules` 실행 권장, rate limit 잔량 안내(`whoami`로 플랜과 시트 표시).
- Anima, Locofy, Framelink(Figma-Context-MCP)는 이번 조사에서 2026년 최신 1차 자료를 확보하지 못했다(Gaps 참조).

### Gaps

- Anima, Locofy, Framelink/Figma-Context-MCP, Figma Make의 2026년 상태와 사용자 평가는 시간 제약으로 확인하지 못했다.
- 2026년 말 기준 `generate_figma_design`이 Codex에서도 동작하는지는 확인하지 못했다(Figma 문서는 Codex를 write-to-canvas 지원으로 표기).
- Reddit(r/FigmaDesign, r/UXDesign)의 원문 정서는 검색에 걸리지 않았다.

## 디자인→코드→리뷰 루프 (프레임 전송, 시각 diff, 토큰 동기화)

### Takeaway

실제로 작동하는 루프는 **Figma MCP(디자인 ground truth)와 브라우저 MCP(렌더 ground truth)를 반복**하는 것이다. 에이전트가 프레임 스크린샷을 받고, 코드를 쓰고, localhost를 스크린샷한 뒤 비교·수정한다. 이 루프는 대부분 사용자가 직접 짜는 커뮤니티 패턴이고, 제품 내장 "design vs implementation diff"는 크롬 확장 같은 서드파티 영역에만 있다.

### Cited Findings

- wmedia 팁(2026-05): `figma-desktop`(`http://127.0.0.1:3845/mcp`)과 `chrome-devtools`(`npx chrome-devtools-mcp@latest`) 두 MCP로 "spec 읽기 → 프레임 스크린샷 → 코드 → Chrome에서 스크린샷 → 차이(예: spacing) 수정 → hover 확인 → `/goal` 충족 시 중단" 루프를 돈다. `/loop`로 감싸 디자인 시스템 컴포넌트를 매시간 검증하는 방식도 제안한다. RAM은 150~300MB 더 든다. — [wmedia.es](https://wmedia.es/en/tips/claude-code-figma-chrome-mcp-pixel-perfect)
- 같은 글에 따르면 Chrome DevTools MCP는 쿠키 없는 깨끗한 Chrome을 띄워서 로그인이 필요한 페이지에는 접근하지 못한다. 그런 경우는 `--chrome`(Claude in Chrome)을 권장한다. — [wmedia.es](https://wmedia.es/en/tips/claude-code-figma-chrome-mcp-pixel-perfect)
- Playwright MCP와 Figma MCP로 픽셀 퍼펙트를 검증하는 워크플로 사례가 있다. — [vadim-blog: pixel perfect playwright figma mcp](https://vadim-blog.vercel.app/pixel-perfect-playwright-figma-mcp)
- localhost 페이지와 Figma 프레임을 비교하는 크롬 확장으로 Uiprobe와 Design Diff가 있다(spacing, typography, color 차이 리포트). — [Uiprobe](https://chromewebstore.google.com/detail/uiprobe-compare-your-site/opcfheiigjnncbbaljoilbaokpmojpjj), [Design Diff](https://chromewebstore.google.com/detail/cgkibdgejfhgimijojlhocihekecbafj)
- Figma 공식 `get_screenshot`은 노드 1개를 PNG로 반환한다. 디자인을 "보게" 하는 용도이고, 내보내기에는 `download_assets`를 쓴다. — [Figma Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- Claude Code Desktop의 "Auto-verify changes"(기본 켜짐)는 편집 후 Claude가 스크린샷을 찍고, DOM을 검사하고, 클릭과 폼 입력을 하고, 에러를 확인해 고친 다음 응답을 마친다. — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)

### Inferences

- Aquila Agents 기능 후보 **"Design vs Build" 비교 뷰**: 세션에 연결한 Figma 노드의 `get_screenshot` 결과와 프리뷰 패널의 같은 라우트 스크린샷을 나란히 보여 주거나 오버레이(투명도 슬라이더)로 겹친다. "차이를 에이전트에게 보내기" 버튼은 두 이미지를 프롬프트에 첨부한다. 픽셀 diff 계산은 렌더러에서 해도 되고, 에이전트에게 맡겨도 된다.
- 토큰 동기화는 `get_variable_defs` 결과와 repo의 tokens(CSS 변수, Tailwind config)를 대조하는 skill/프롬프트 템플릿으로 제공하는 편이 현실적이다.

### Gaps

- 자동 시각 diff 정확도(픽셀 vs 지각 diff)에 대한 정량 사용자 보고는 찾지 못했다.

## 앱 내 프리뷰 패턴 (임베디드 브라우저, point-and-prompt, 디바이스)

### Takeaway

2026년에는 Claude Code Desktop, Cursor, Codex 앱이 모두 **임베디드 브라우저 + 요소 선택해서 프롬프트에 첨부**를 갖췄다. Cursor Design Mode가 가장 풍부하다(다중 선택, 영역 드로잉, 인라인 텍스트 편집, CSS 인스펙터, 음성, 배치 전송). 사람과 에이전트가 같은 화면을 공유하고 dev server 포트를 자동 관리하는 것이 기본 기대치가 됐다.

### Cited Findings

- **Claude Code Desktop Browser pane:** Cmd+Shift+B로 열고, 헤더의 **Dev servers** 메뉴로 서버를 시작하거나 중지한다. "Keep cookies", 개인 브라우저와 분리된 clean profile, **Cmd+Shift+S = "Select an element in the Browser"**를 제공한다. 설정은 `.claude/launch.json`(`runtimeExecutable`, `runtimeArgs`, `port` 기본 3000, `cwd`, `env`, `autoPort`, `url`)이고, Claude가 dev server를 감지해 이 파일을 써 준다. `autoPort: true`면 빈 포트를 찾아 `--port`/`-p`를 다시 쓰고, `false`면 실패한다(OAuth 콜백이나 CORS에 필요). 기존 서버에 붙으려면 command 없이 `url`만 쓴다. Diff 뷰에서는 줄마다 + 코멘트를 달고 Cmd+Enter로 일괄 전송한다. 프롬프트 박스는 + 버튼이나 드래그앤드롭으로 이미지와 PDF를 첨부한다. — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)
- Builder.io 분석: Claude Code 프리뷰는 "is not a visual editor. It is the AI's self-verification layer"라는 평가다. 요소를 클릭해도 다음 프롬프트의 컨텍스트가 될 뿐 직접 편집은 되지 않는다. 혼자 로컬에서만 쓰고, 모노레포 하위 폴더 dev server를 감지하지 못하고, 리빌드가 긴 앱에서는 auto-verify가 느리다는 한계를 든다. — [Builder.io](https://www.builder.io/blog/claude-code-visual-editor) (벤더 관점)
- Claude Code 이슈 #91521 "Design Mode"(2026-09-02): 클릭한 요소의 selector/XPath, 컴포넌트명, props, computed styles, 크롭 스크린샷을 다음 프롬프트에 붙여 달라는 요청이다. 요소를 말로 설명하는 것("the gold button in the third section")은 느리고 모호하며, 디자이너는 코드베이스를 몰라 정밀한 요청을 하기 어렵다는 문제를 지적했다. 사람의 댓글 없이 2026-11-07에 **stale로 "not planned" 종료**됐다. — [GitHub anthropics/claude-code#91521](https://github.com/anthropics/claude-code/issues/91521)
- **Cursor Design Mode** (Agents Window 브라우저, Cmd+Shift+D): 클릭으로 노트를 열고, ↑/↓로 부모/자식을 고르고, Shift+클릭으로 다중 선택하고, 드래그로 영역을 고르고, Draw/Ellipse/Rectangle/Arrow 마크업을 쓰고, 더블클릭으로 텍스트를 인라인 편집하고, "Edit CSS properties" 인스펙터와 Dictate(음성)를 쓰고, Batch edits(번호 핀을 모아 한 번에 Send)를 할 수 있다. 요소마다 전송되는 컨텍스트는 tag/id/classes/attributes, selector path, 텍스트 200자, 크기와 위치, computed style 6종, **React/Vue/Svelte 컴포넌트명과 component stack**, 요소 크롭 스크린샷(마크업 포함)이다. 반응형과 디바이스 크기는 문서에 없다. — [Cursor Docs: Design Mode](https://cursor.com/docs/agent/design-mode)
- Cursor 계보: Cursor 2.2(2025-12) Visual Editor에서 2026-04 Design Mode로 이름이 바뀌었고, 전환기에 UI 변경과 버그 보고가 있었다. — [Cursor forum 2.2](https://forum.cursor.com/t/cursor-2-2-visual-editor-for-cursor-browser/145958), [pasqualepillitteri](https://pasqualepillitteri.it/en/news/3794/cursor-design-mode-what-it-is-how-it-works-cursor-3)
- **Codex 앱 in-app browser**: 스레드 안에서 사람과 Codex가 같은 렌더 페이지를 공유한다. **Annotation mode**에서 요소나 영역(Shift+클릭)을 골라 코멘트를 달고, Cmd+클릭은 즉시 전송한다. 브라우저 프로필은 쓰지 않으며(쿠키·확장 없음), 로그인이 필요한 작업은 Codex for Chrome 확장으로 넘긴다. 2026-04 무렵 출시됐다. — [OpenAI Codex docs: In-app browser](https://developers.openai.com/codex/app/browser), [pasqualepillitteri (2026-04)](https://pasqualepillitteri.it/en/news/1568/codex-native-browser-openai-april-2026)
- 서드파티 Happy(Claude Code 모바일/원격 클라이언트)에도 "Live Preview Panel with Click-to-Edit" 기능 요청이 올라와 있다. — [slopus/happy#802](https://github.com/slopus/happy/issues/802)

### Inferences

- Aquila Agents는 CLI를 pty에 그대로 임베드하므로 Claude Desktop처럼 에이전트 내부 도구(auto-verify)를 바꿀 수는 없다. 대신 **호스트 레벨 프리뷰 + 선택 요소를 터미널 입력으로 주입**하는 방식이 가능하다.
  1. 프로젝트별 dev server 감지: `package.json` scripts와 pty 출력의 `localhost:\d+` 패턴을 파싱하고, `.claude/launch.json`이 있으면 재사용한다.
  2. Electron `WebContentsView`로 프리뷰 패널을 띄우고, 디바이스 프리셋(390/768/1440)과 줌을 둔다.
  3. "Select" 모드에서 hover 하이라이트를 띄우고, 클릭하면 selector, 텍스트, computed style, React fiber에서 얻은 컴포넌트명과 소스 위치(가능하면)를 수집하고 `webContents.capturePage(rect)`로 크롭 스크린샷을 찍는다. 이 정보를 활성 claude/codex 세션의 입력창에 텍스트로 넣고 이미지는 임시 파일 경로(`@/tmp/x.png`)로 붙인다.
  4. Cursor식 배치 노트: 여러 핀을 모았다가 한 번에 전송한다.
- Claude 이슈가 not-planned로 닫혔다는 점은 **Claude Code 생태계에서 dev server용 point-and-prompt가 여전히 공백**이라는 신호다. Aquila Agents가 claude와 codex 양쪽에 같은 UX를 주는 차별점이 될 수 있다.
- iOS Simulator/Android 에뮬레이터 미러링과 Storybook 임베드는 이번에 1차 자료를 확보하지 못했다. Storybook은 결국 localhost URL이라 같은 프리뷰 패널로 커버할 수 있다.

### Gaps

- Conductor, Windsurf 프리뷰, Bolt/Lovable/v0/Replit의 2026년 최신 프리뷰 UX는 이번에 확인하지 못했다.
- iOS Simulator 미러링을 다룬 데스크톱 에이전트 앱 사례는 찾지 못했다.
- Claude Code Desktop의 Cmd+Shift+S가 선택 결과를 정확히 무엇으로 넘기는지는 공식 문서에 설명이 없다.

## 디자이너가 터미널 도구에서 겁먹는 지점과 도움이 된 비터미널 장치

### Takeaway

디자이너는 Claude Code를 처음 보면 "복잡한 터미널 + 인터페이스 없음"으로 받아들인다. 입문 가이드는 공통적으로 **Desktop 앱(Code 탭), VS Code 내장 터미널, 이미지/스크린샷 첨부, 프리뷰**로 장벽을 낮추라고 조언한다. Anthropic도 CLI 제약을 이해하는 Claude Code 전담 프로덕트 디자이너를 채용 중이다.

### Cited Findings

- "for developers, working in a terminal is second nature. But for everyone else, it can feel intimidating." — [XDA](https://www.xda-developers.com/please-stop-ignoring-claude-code/)
- 디자이너의 첫인상은 "just looks like complicated terminal thing… no interface, nothing visually intuitive"였다. — [ADPList: Claude Code guide for designers](https://adplist.substack.com/p/claude-code-guide-for-designers)
- 입문 경로로 VS Code 내장 터미널과 Claude Desktop의 Code 탭이 권장된다("ease in through a chat interface"). — [Nervegna: Claude Code for Designers](https://nervegna.substack.com/p/claude-code-for-designers-a-practical), [technicallycurious](https://technicallycurious.substack.com/p/claude-code-for-business-users-getting)
- 디자이너가 며칠 만에 아이디어에서 작동하는 프로토타입까지 갔고, 비개발자가 iOS 앱과 Figma 플러그인을 만들었다는 사례가 있다. — [Nervegna](https://nervegna.substack.com/p/claude-code-for-designers-a-practical), [John Rodrigues](https://johnrodrigues.substack.com/p/claude-code-for-designers-176)
- Anthropic "Product Designer, Claude Code" 채용 공고는 터미널 인터페이스를 직접 다루고 CLI 제약을 이해하는 역할을 요구한다. — [Anthropic careers](https://www.anthropic.com/careers/jobs/5025976008)
- Claude Code와 Figma 3일 사용기(Medium Design Bootcamp)도 있다. — [Medium](https://medium.com/design-bootcamp/my-experience-with-claude-code-terminal-and-figma-so-far-4cc9ca5e39a7) (원문 세부는 미확인)

### Inferences

- Aquila Agents는 "진짜 CLI를 임베드한다"는 원칙을 지키면서도 다음을 얹을 수 있다.
  - **이미지 붙여넣기 및 드롭**: 터미널에 드롭하면 임시 경로로 저장하고 경로를 입력한다.
  - **Figma 링크 붙여넣기 인식**: 링크를 감지하면 "이 프레임 구현" 같은 프롬프트 칩을 띄운다.
  - **프리뷰 옆 배치**: 결과를 바로 본다.
  - **변경 승인을 시각적으로**: git changes 패널에 before/after 스크린샷을 둔다.
  - **권한 프롬프트 알림**: 기존 status dot.
- 온보딩은 "디자이너 모드" 프리셋으로 한다. 레이아웃은 터미널 하나 + 프리뷰 + Figma 패널이고, Figma MCP 자동 연결과 dev server 자동 시작을 켠다.

### Gaps

- r/UXDesign, r/FigmaDesign 원문 스레드 기반의 정량 정서는 확보하지 못했다.

## (A) 호스트 앱에서 Figma MCP 자동 설정 (원클릭)

### Takeaway

Claude Code는 **`--mcp-config <file>` (+ 선택적으로 `--strict-mcp-config`) 플래그로 세션별 MCP 주입**이 가능하다. 따라서 Aquila Agents는 `~/.claude*`를 건드리지 않고 `~/.aquila/figma-mcp.json`을 만들어 spawn 시 넘기면 된다(기존 `--settings ~/.aquila/claude-hooks.json` 패턴과 같다). OAuth는 세션 안의 `/mcp` 또는 `claude mcp login`이 처리하지만 **토큰 저장 위치는 Claude 관리 영역**이라 호스트가 완전히 격리할 수는 없다. Codex는 user/project `config.toml`만 문서화돼 있어 세션 단위 주입 수단이 약하다(`-c` override 가능성은 미확인).

### Cited Findings

- Claude Code 스코프: local(기본)은 `~/.claude.json`, project는 repo 루트의 `.mcp.json`(VCS로 공유), user는 `~/.claude.json`에 저장된다. 우선순위는 local > project > user > plugin > claude.ai connectors이고 필드는 병합하지 않는다. — [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp)
- 프로젝트 `.mcp.json`은 인터랙티브 세션에서 **사용 전 승인 프롬프트**가 뜬다(`claude mcp reset-project-choices`로 초기화). untrusted 폴더에서는 `enableAllProjectMcpServers`가 무시된다. — [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp)
- `--strict-mcp-config`를 주면 `--mcp-config`로 넘긴 서버만 로드하고 `.mcp.json` 같은 다른 곳의 서버는 건너뛴다(미로드 프로젝트 서버의 승인 프롬프트 생략은 v2.1.246 이상). — [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp)
- `.mcp.json`은 `${VAR}`, `${VAR:-default}` 확장을 지원한다(`url`, `headers` 등). 단 원격 서버의 url/headers에서는 `ANTHROPIC_API_KEY` 같은 자격증명 변수를 빈 값으로 읽는다. — [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp)
- 원격 HTTP OAuth: 401/403이 오면 인증 필요로 표시되고, 세션 안에서 `/mcp`로 브라우저 로그인한다. 셸에서는 `claude mcp login <name> [--no-browser]`, `claude mcp logout <name>`이다. client secret은 macOS 키체인에 저장된다. OAuth 토큰의 정확한 저장 위치는 문서 발췌에 명시돼 있지 않았다. — [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp)
- 프로젝트 파일 형식: `{"mcpServers": {"figma": {"type": "http", "url": "https://mcp.figma.com/mcp"}}}`. — [Claude Code Docs: MCP](https://code.claude.com/docs/en/mcp) (형식은 문서 예시를 Figma에 대입)
- 데스크톱 로컬 서버는 Figma Desktop의 Dev Mode에서 "MCP Server"를 켜야 하고, 파일이 열려 있어야 한다. `claude mcp add --transport http figma-desktop http://127.0.0.1:3845/mcp`. — [wmedia.es](https://wmedia.es/en/tips/claude-code-figma-chrome-mcp-pixel-perfect)
- Codex: `[mcp_servers.<name>]`를 `~/.codex/config.toml` 또는 신뢰된 프로젝트의 `.codex/config.toml`에 넣고, `codex mcp login <name>`으로 OAuth한다. `mcp_oauth_callback_port`와 `mcp_oauth_credentials_store`(3가지 백엔드)를 지원한다. 일부 블로그는 `[features] rmcp_client = true`를 요구하지만 공식 문서에서는 확인하지 못했다. — [OpenAI Codex MCP](https://developers.openai.com/codex/mcp), [danielvaughan: Codex MCP management](https://codex.danielvaughan.com/2026/05/19/codex-cli-mcp-server-management-cli-commands-oauth-streamable-http-production-patterns/)
- 플랜과 시트: 원격은 모든 플랜에서 쓸 수 있지만 Starter와 View 시트는 월 6회(→ 최신 공식 페이지는 월 20회, 아래 "플랜별 기능 확인" 섹션 참조)라 사실상 체험용이다. 데스크톱 서버는 Professional 이상의 Dev/Full 시트가 필요하다. — [Figma Help](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server), [Figma rate limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)
- 설정 시 겪는 문제: 조직이 플러그인 설치를 막으면 수동 HTTP 추가가 필요하다. — [Griffin Wooldridge](https://griffinwooldridge.com/blog/figma-mcp-claude-code-setup). "This Figma file could not be accessed" 오류와 Claude에서 파일 접근이 깨진다는 보고도 있다. — [Figma Forum 54505](https://forum.figma.com/report-a-problem-6/mcp-error-this-figma-file-could-not-be-accessed-54505), [Figma Forum 54513](https://forum.figma.com/report-a-problem-6/figma-mcp-in-claude-file-access-broken-multiple-debug-uuids-54513)

### Inferences (Aquila Agents 구현 제안)

- **원클릭 "Figma 연결" (Claude):**
  1. `~/.aquila/mcp/figma.json`에 원격 서버 정의를 쓴다.
  2. claude를 spawn할 때 `--mcp-config ~/.aquila/mcp/figma.json`을 추가한다. 사용자 기존 MCP를 유지하려면 `--strict-mcp-config`는 붙이지 않는다.
  3. 첫 사용 시 터미널에 `/mcp` 인증을 안내하거나, 별도 pty에서 `claude mcp login figma`를 실행한다.

  이렇게 하면 `~/.claude*`에 쓰지 않는 규칙을 지킨다. 다만 `claude mcp login`이 Claude 자체 저장소(키체인 또는 `~/.claude.json`)에 토큰을 기록하는 것은 CLI의 동작이지 Aquila Agents의 쓰기가 아니라는 점을 문서에 명확히 해야 한다.

- **감지:**
  - 데스크톱 서버: `http://127.0.0.1:3845/mcp`에 HTTP 요청이 성공하는지(또는 TCP 연결)로 판별한다.
  - Figma 앱 실행 여부: `pgrep -x Figma` 또는 `NSWorkspace` 번들 ID `com.figma.Desktop`로 확인한다.
  - 원격 인증 상태: `claude mcp list` 출력을 파싱하거나 `whoami` 도구로 확인한다.
  - 이미 사용자 스코프에 figma가 있으면 local > project > user 우선순위 때문에 중복을 주입하지 않는다.
- **Codex:** 세션별 플래그 주입이 문서화돼 있지 않다. 따라서 (a) 사용자 확인 후 프로젝트 `.codex/config.toml`에 추가하거나(사용자 파일이 아닌 repo 파일), (b) `codex -c mcp_servers.figma.url=...` 형태의 config override가 되는지 검증해야 한다(미확인). `~/.codex` 쓰기는 규칙 위반이라 불가하다.
- UI에는 연결 상태 점(초록=인증됨, 노랑=서버만 있음, 회색=없음)과 플랜/시트, 일일 잔여 호출 안내를 둔다(잔여량 API는 미확인이라 "Pro Dev 시트 200회/일" 같은 정적 안내).

### Gaps

- Claude Code `--mcp-config`의 정확한 파일 형식(JSON 문자열 또는 파일, 다중 지정) 전문을 문서에서 끝까지 확인하지 못했다(문서 뒷부분 미열람). 다만 플래그 존재와 `--strict-mcp-config` 상호작용은 확인했다.
- Codex에 세션 단위 MCP 주입(`-c` override 또는 `CODEX_HOME` 대체)이 가능한지는 미확인이다. `CODEX_HOME`을 바꾸면 사용자 인증까지 분리되는 부작용이 생길 수 있다.
- Figma OAuth의 동적 클라이언트 등록 및 CIMD 세부(Scalekit 글이 언급)는 확인하지 못했다.

## (B) Claude in Chrome / 브라우저 MCP로 Figma 요소 검사와 디자인 QA

### Takeaway

Figma 웹 캔버스는 WebGL 렌더링이라 **DOM으로 레이어나 Dev Mode 값을 읽는다는 공식·커뮤니티 근거를 찾지 못했다**. Claude in Chrome으로 Figma를 "보는" 것은 스크린샷 수준에 그칠 가능성이 높다(추론). 레이어, 변수, 스크린샷은 **Figma MCP(`get_design_context`, `get_variable_defs`, `get_screenshot`)가 정답**이다. 브라우저 쪽(Claude in Chrome, Chrome DevTools MCP, Playwright MCP)은 **구현된 localhost를 렌더·검사하는 쪽**으로 쓰는 것이 커뮤니티 표준 조합이다.

### Cited Findings

- Claude in Chrome 기반 디버깅 스킬은 localhost 라우트로 이동해 스크린샷을 찍고 console과 network를 검사한다. — [playbooks.com browser-debugging skill](https://playbooks.com/skills/madappgang/claude-code/browser-debugging)
- 커뮤니티 프롬프트 패턴: "Figma 스크린샷을 붙여 React로 구현하고, localhost:3000을 열어 스크린샷한 뒤 원본과 비교해 차이를 나열하라." — [pulse-vibe 블로그](https://pulse-vibe-landing.pages.dev/blog/end-of-screenshot-pasting), [dev.to: Fixing visual discrepancies with Claude Code Chrome extension](https://dev.to/orca_forge/fixing-visual-discrepancies-with-claude-code-chrome-extension-3h2)
- Figma MCP는 디자인의 ground truth, Chrome DevTools MCP는 렌더의 ground truth로 두고 일치할 때까지 반복한다. Chrome DevTools MCP는 clean profile이라 로그인 페이지에는 Claude in Chrome(`--chrome`)을 쓴다. — [wmedia.es](https://wmedia.es/en/tips/claude-code-figma-chrome-mcp-pixel-perfect)
- Claude Code Desktop의 Browser pane도 clean profile이고, 로그인 정체성이 필요한 사이트는 Claude in Chrome을 권장한다. 외부 사이트 쓰기 동작은 사이트별 Allow once/Always/Deny 승인이 필요하고 localhost는 승인 없이 쓴다. — [Claude Code Docs: Desktop](https://code.claude.com/docs/en/desktop)
- Codex도 같은 구조다. in-app browser는 비인증이고, 인증이 필요한 작업은 Codex for Chrome으로 넘긴다. — [danielvaughan: Codex for Chrome](https://codex.danielvaughan.com/2026/05/07/codex-for-chrome-extension-browser-integration-authenticated-workflows/)
- Figma는 WebGL과 하드웨어 가속에 의존하고, WebGL이 실패하면 캔버스가 비어 보인다(chrome://gpu 확인 안내). — [Figma Forum 54778](https://forum.figma.com/report-a-problem-6/unable-to-access-a-particular-page-in-my-figma-file-due-to-webgl-error-popop-54778)
- `get_screenshot`은 노드 단위 PNG이고, `get_metadata`는 레이어 XML 아웃라인이다. 브라우저로 캔버스를 찍는 것보다 정확하고 노드에 정렬된 결과를 준다. — [Figma Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)

### Inferences

- **Claude in Chrome으로 Figma 웹을 직접 검사하는 방식은 권장하지 않는다.** 캔버스 픽셀만 보이고(추론), Figma 웹 로그인 세션이 필요하며, 외부 사이트 쓰기 승인과 확장 권한 문제가 겹친다. Dev Mode 패널의 텍스트(CSS 스니펫)는 DOM 텍스트라 읽힐 가능성이 있지만 검증된 보고는 없다.
- 비교 표(추론 정리):
  - Figma MCP `get_screenshot`/`get_design_context`: 정확한 노드, 변수 이름, 코드 힌트를 준다. rate limit을 소모한다.
  - Chrome DevTools MCP: 깨끗한 Chrome에서 DOM, computed style, 성능을 본다. 로그인 페이지에는 접근하지 못한다.
  - Playwright MCP: 헤드리스로 재현 가능한 스크린샷과 뷰포트를 다뤄 CI성 회귀 검사에 맞다.
  - Claude in Chrome: 사용자 실 프로필로 인증 페이지를 다루지만 사이트별 권한이 필요하다.
- Aquila Agents 관점에서는 **자체 프리뷰 패널(Electron)이 Chrome DevTools MCP의 역할을 일부 대신**할 수 있다. 사람이 고른 요소와 스크린샷을 에이전트에 넘기는 식이다. 에이전트가 스스로 브라우저를 조작하는 것은 CLI가 가진 MCP(chrome-devtools, playwright)에 맡긴다. 나아가 Aquila Agents 프리뷰를 CDP 포트(`--remote-debugging-port`)로 노출해 `chrome-devtools-mcp --browserUrl`로 붙이면, 사람과 에이전트가 같은 화면을 공유하게 할 수 있다(검증 필요).

### Gaps

- Claude in Chrome이 Figma 웹 파일에서 레이어나 Dev Mode 값을 읽을 수 있는지 직접 다룬 자료는 없었다(검색 결과는 일반 WebGL 오류 스레드뿐).
- chrome-devtools-mcp를 Electron webContents CDP 엔드포인트에 붙이는 사례는 확인하지 못했다.

## Figma를 매일 보는 개발자(프론트엔드·백엔드)를 위한 기능

### Takeaway

프론트엔드 개발자의 핵심 니즈는 **Figma 노드에서 기존 컴포넌트와 토큰 기반 코드를 얻는 것**(Code Connect, `get_variable_defs`, `search_design_system`), 에셋 추출(`download_assets`), 그리고 **"구현 후 디자인이 바뀌었는지" 알기**다. 백엔드 개발자는 FigJam 플로우와 코멘트를 에이전트 입력으로 쓸 수 있다(`get_figjam`, `get_comments`, `generate_diagram`). 변경 감지는 Figma Webhooks v2(파일당 3개, 플랜별 150/300/600개)나 REST 폴링으로 구현할 수 있다.

### Cited Findings

- Code Connect 관련 도구는 `get_code_connect_map`, `add_code_connect_map`이다. 원격 서버의 `get_design_context`는 `clientFrameworks` 파라미터로 적용할 매핑을 고른다. — [Figma Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- Code Connect가 없으면 MCP가 기존 컴포넌트 대신 새 마크업을 만들어 낸다. `get_code_connect_map`이 빈 값이면 매핑이 게시되지 않은 것이다. 상위 Figma 티어일수록 Code Connect 기능이 깊다. — [cc.bruniaux.com](https://cc.bruniaux.com/guide/workflows/design-to-code/), [toolradar](https://toolradar.com/blog/figma-mcp-server)
- 토큰과 변수: `get_variable_defs`(선택 영역의 변수와 스타일), `search_design_system`(라이브러리 검색, 원격 전용)을 쓴다. `html_to_figma`는 변수를 쓰지 않는다. — [Figma Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- 에셋: `download_assets`로 최대 20노드를 PNG/JPG/SVG/PDF로 내보내고 원본 이미지도 받는다(원격 전용). — [Figma Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- 핸드오프 불만: "Why does reading a Figma file still feel like archaeology in 2026" 같은 포럼 피드백이 있다. — [Figma Forum 52613](https://forum.figma.com/share-your-feedback-26/why-does-reading-a-figma-file-still-feel-like-archaeology-in-2026-52613). 토큰이 hex/px로 붕괴하는 문제는 위 섹션 참조.
- **FigJam과 코멘트:** `get_figjam`은 FigJam 다이어그램을 XML과 스크린샷으로 변환하고(원격·데스크톱 모두), `get_comments`는 Design, FigJam, Slides, Make의 코멘트 스레드를 읽는다(원격 전용, 읽음 처리 안 함). `generate_diagram`은 설명이나 Mermaid로 FigJam 다이어그램을 생성한다. — [Figma Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- **Webhooks:** 파일 webhook은 파일당 최대 3개, 플랜별로 Professional 150, Organization 300, Enterprise 600개까지다. 이벤트별 플랜 제한은 공식 페이지에서 확인하지 못했다. — [Figma Developers: Webhooks](https://developers.figma.com/docs/rest-api/webhooks). 이벤트 enum의 FILE_UPDATE와 FILE_VERSION_UPDATE(이름 있는 버전 생성 시)는 서드파티 레퍼런스 기준이다. — [Figma Webhooks events](https://developers.figma.com/docs/rest-api/webhooks-events). FILE_UPDATE가 도착하지 않는다는 포럼 보고도 있다. — [Figma Forum](https://forum.figma.com/t/webhook-events-file-update-and-file-comment-not-working/37080)

### Inferences (Aquila Agents 기능 후보)

1. **프로젝트/세션별 Figma 링크 고정**: 사이드바 프로젝트에 Figma 파일과 노드 링크를 저장한다. 탭 헤더에 썸네일(Figma REST `/v1/images` 또는 MCP 스크린샷)을 보여 준다.
2. **"이 프레임을 에이전트에 보내기"**: 링크를 고르면 활성 pty에 `Implement this Figma frame using our existing components and tokens: <url>`를 입력한다(템플릿은 i18n). 에이전트가 MCP로 해석한다.
3. **Design vs Implementation 비교**: git changes 패널 또는 프리뷰 패널 옆에 Figma 스크린샷과 localhost 스크린샷을 겹쳐 보는 뷰.
4. **변경 알림**: Figma 파일의 `lastModified`/version을 REST(`GET /v1/files/:key?depth=1` 또는 `/versions`)로 폴링한다. Electron 데스크톱 앱이라 webhook 수신 서버가 없으므로 폴링이 현실적이다(추론). 바뀌면 status dot과 알림으로 "연결된 프레임이 구현 이후 변경됨"을 띄운다. 노드 단위 diff는 `GET /v1/files/:key/nodes?ids=`의 해시를 비교한다. REST는 Personal Access Token이나 OAuth가 별도로 필요해서 MCP OAuth와 공유되지 않는다(추론).
5. **백엔드용**: FigJam 플로우 링크를 이슈처럼 세션에 붙인다. "이 플로우의 API 엔드포인트 스캐폴딩" 템플릿을 두고, `get_comments`로 미해결 코멘트를 TODO로 가져온다.

### Gaps

- Figma REST API 폴링 rate limit(2025년 tier 기반 변경)과 파일 버전 API의 플랜 제한은 이번에 확인하지 못했다.
- Code Connect가 어느 플랜과 시트를 요구하는지 공식 수치를 확인하지 못했다(Organization/Enterprise로 알려져 있으나 이번 출처로는 미검증).

## 플랜별 기능 확인 + 선택적 설정

### Takeaway

기능 가용성은 **플랜(파일이 속한 플랜) × 시트(View/Collab/Dev/Full)** 조합으로 정해진다. 앱이 이를 가장 확실하게 확인하는 방법은 Figma MCP의 **`whoami` 도구**다. 이 도구는 이메일, 소속 플랜, 플랜별 시트를 돌려주고 **rate limit에서 제외**된다. REST `GET /v1/me`는 플랜과 시트를 주지 않는다. 다만 REST 429 응답 헤더 `X-Figma-Plan-Tier`와 `X-Figma-Rate-Limit-Type`(low/high), 그리고 Enterprise 전용 엔드포인트의 403으로 간접 추정은 할 수 있다. Figma 설정 전체는 선택 사항으로 두고, 확인 결과에 따라 기능을 비활성화하고 사유를 표시하는 UX를 권장한다.

### Cited Findings

**플랜 × 시트 기능표** (출처는 각 행 끝에 표시. "—"는 해당 없음)

| 기능                                                  | Starter(무료)                  | Professional                                               | Organization                | Enterprise                 | 시트 조건                                                                                   |
| ----------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- | --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| Dev Mode                                              | ✗                              | ✓                                                          | ✓ (Dev 단독 시트 구매 가능) | ✓ (Dev 단독 시트)          | Full 또는 Dev. View 시트는 속성 보기, 측정, 코드 복사, 에셋 export 같은 기본 inspect만 가능 |
| 원격 MCP 호출 한도                                    | View/Collab 월 20회            | Full/Dev **200/일, 10/분**                                 | Full/Dev **200/일, 15/분**  | Full/Dev **600/일, 20/분** | View/Collab 시트는 어느 플랜이든 월 20회                                                    |
| 데스크톱 MCP (127.0.0.1:3845)                         | ✗                              | ✓                                                          | ✓                           | ✓                          | Dev 또는 Full                                                                               |
| 캔버스 쓰기 (드래프트 밖)                             | —                              | ✓                                                          | ✓                           | ✓                          | Full. 베타 중 무료, 이후 사용량 과금                                                        |
| Code Connect                                          | ✗                              | **불일치**: Help Center는 ✓, 개발자 문서와 스태프 답변은 ✗ | ✓                           | ✓                          | Full 또는 Dev. GitHub 연결은 파일 소유자나 조직 관리자가 설정. Government는 CLI만           |
| Variables REST API (`/v1/files/:key/variables/local`) | ✗                              | ✗                                                          | ✗                           | ✓                          | Enterprise 조직의 full member만. guest 불가. scope `file_variables:read`                    |
| Webhooks v2                                           | ?                              | 150개                                                      | 300개                       | 600개                      | 파일당 3개                                                                                  |
| Comments                                              | MCP `get_comments`는 원격 전용 |                                                            |                             |                            | REST Comments는 Tier 2 엔드포인트. 플랜별 제한은 찾지 못함                                  |

- MCP 한도(최신 공식 페이지): View/Collab은 모든 플랜에서 월 최대 20회다. Full/Dev는 Professional 200/일·10/분, Organization 200/일·15/분, Enterprise 600/일·20/분이다. Education은 Professional과 같다. 제외 도구는 `add_code_connect_map`, `create_new_file`, `generate_figma_design`, `whoami`이고, AI 크레딧을 쓰는 동작도 제외된다. 페이지는 한도에 걸릴 때의 정확한 오류 메시지를 싣지 않고 업그레이드 경로만 안내한다. — [Figma Developers: Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)
  - **충돌:** 같은 URL을 이번 세션 앞부분에서 검색했을 때는 "Starter/View/Collab 월 6회(→ 최신 공식 페이지는 월 20회, 아래 "플랜별 기능 확인" 섹션 참조), Pro 10/분, 플랜 표 15/분"이 나왔다. 이 문서 위 섹션들의 "월 6회(→ 최신 공식 페이지는 월 20회, 아래 "플랜별 기능 확인" 섹션 참조)"는 이 최신 fetch 기준 **월 20회로 정정**한다. Figma가 수치를 자주 바꾸므로 앱 UI에 숫자를 하드코딩하지 말아야 한다(추론).
- 한도는 시트와 **파일이 속한 플랜**에 함께 좌우된다. Pro Dev 시트 사용자가 Starter 한도에 걸린 사례가 있다. — [Figma Forum 54926](https://forum.figma.com/report-a-problem-6/figma-mcp-server-stuck-on-starter-limits-despite-active-professional-dev-seat-54926)
- MCP는 모든 플랜에서 쓸 수 있다. 데스크톱 서버는 Professional, Education, Organization, Government, Enterprise 플랜의 Dev 또는 Full 시트가 필요하고, 드래프트 밖 캔버스 쓰기는 Full 시트가 필요하다. — [Figma Help: Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- Code Connect: Help Center는 "Professional, Education, Organization, Government, and Enterprise… Requires a Full or Dev seat"라고 하고, UI와 CLI의 플랜 차이는 언급하지 않으며 Government는 CLI만 된다고 적는다. — [Figma Help: Code Connect](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect). 반면 개발자 문서와 Figma 스태프 답변은 Organization과 Enterprise만 된다고 한다. Professional에서는 Code Connect 토큰 scope가 없고 매핑이 거부된다는 사용자 보고도 있다. — [Figma Developers: Code Connect](https://developers.figma.com/docs/code-connect), [Forum 59258](https://forum.figma.com/ask-the-community-7/code-connect-on-the-professional-plan-docs-say-it-s-supported-but-there-s-no-code-connect-token-scope-and-mappings-are-rejected-59258), [Forum 59228](https://forum.figma.com/report-a-problem-6/code-connect-documentation-say-that-its-available-for-professional-59228)
- Dev Mode는 Starter 플랜에서 제공되지 않는다. Full 시트면 Dev Mode를 쓸 수 있고, Organization과 Enterprise에서는 Dev 단독 시트도 살 수 있다. 시트가 없는 사람도 View 시트로 기본 inspect(속성, 측정, 코드 복사, 에셋 export)는 할 수 있다. — [Figma Help 360039960434](https://help.figma.com/hc/en-us/articles/360039960434), [Figma Help: pricing/seats 업데이트](https://help.figma.com/hc/en-us/articles/27468498501527), [Forum](https://forum.figma.com/t/dev-mode-permission-on-team/63774) (일부는 포럼 출처)
- Variables REST API는 Enterprise 조직의 full member만 쓸 수 있고 guest는 쓸 수 없다. Tier 2이고 scope는 `file_variables:read`다. 다른 플랜에서는 플러그인으로 변수를 읽는 우회가 있다. — [Figma Developers: Variables](https://developers.figma.com/docs/rest-api/variables), [Variables endpoints](https://developers.figma.com/docs/rest-api/variables-endpoints), [Forum: why Enterprise only](https://forum.figma.com/suggest-a-feature-11/why-s-the-variables-api-only-available-on-enterprise-plans-36426/index1.html)
- Webhooks는 파일당 3개, Professional 150, Organization 300, Enterprise 600개까지다. — [Figma Developers: Webhooks](https://developers.figma.com/docs/rest-api/webhooks)

**앱이 플랜과 시트를 자동으로 확인하는 방법**

- **MCP `whoami`(최선):** 로그인한 이메일, 플랜 목록, 플랜별 시트를 보여 준다. Figma는 권한 오류가 날 때 파일 소유 계정으로 접속했는지 확인하는 용도로 권장한다. rate limit에서 제외되고 원격 전용이다. — [Rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- **REST `GET /v1/me`:** User 객체를 반환하고(Tier 3, scope `current_user:read`), 이 페이지에는 플랜이나 시트 정보가 나오지 않는다. — [Figma Developers: Users endpoints](https://developers.figma.com/docs/rest-api/users-endpoints/)
- **REST 429 헤더:** `Retry-After`(초), `X-Figma-Plan-Tier`(`enterprise|org|pro|starter|student`, 요청한 리소스가 속한 플랜), `X-Figma-Rate-Limit-Type`(`low`=Collab/Viewer, `high`=Full/Dev), `X-Figma-Upgrade-Link`. REST 한도는 Tier 1(file, nodes, image)에서 View/Collab 월 20회, Dev/Full 분당 10·15·20(Starter·Pro·Org)이다. Tier 2(comments, variables 읽기, webhooks, versions)는 View/Collab 분당 5회, Dev/Full 25·50·100이다. Tier 3은 View/Collab 분당 10회, Dev/Full 50·100·150이다. — [Figma Developers: Rate limits](https://developers.figma.com/docs/rest-api/rate-limits/)
- **403 방식:** Enterprise 전용인 Variables 엔드포인트가 403을 반환하면 "Enterprise가 아님"으로 추정할 수 있다. 다만 403의 정확한 본문 메시지는 확인하지 못했다(Gaps).

### Inferences (Aquila Agents UX 권장)

- **감지 순서**
  1. Figma 연결을 끈 상태가 기본이고, 아무것도 호출하지 않는다.
  2. 사용자가 "Figma 연결"을 누르면 원격 MCP를 OAuth로 인증하고 숨겨진 짧은 claude 실행으로 `whoami`를 부른다. 예: `claude -p "call figma whoami, print JSON" --mcp-config ~/.aquila/mcp/figma.json`. 결과(플랜과 시트 목록)를 `~/.aquila/figma-profile.json`에 캐시한다. 이렇게 하면 Aquila Agents가 Figma 토큰을 직접 들고 있지 않아도 된다.
  3. 데스크톱 서버는 `127.0.0.1:3845` 프로브로 별도 감지한다.
  4. 실행 중 rate limit이나 권한 오류가 나면 pty 출력 패턴을 감지해 상태를 갱신한다.
  - 대안으로 Aquila Agents가 Figma REST OAuth 앱을 등록해 직접 호출할 수도 있다. 하지만 `/v1/me`로는 시트를 알 수 없고, 429 헤더나 403에 의존해야 해서 열세다.
- **표시 규칙 (시트와 플랜이 기능을 결정)**
  - View/Collab 시트: "프레임 보내기"는 쓸 수 있되 "월 20회 한도" 경고를 붙인다. 데스크톱 MCP, Code Connect, 변경 알림 폴링은 비활성화하고 사유를 보여 준다("Dev 또는 Full 시트 필요").
  - Pro + Dev/Full: MCP 전체, 데스크톱 MCP, Code Connect는 "Organization 플랜 필요할 수 있음"으로 표시한다(문서 불일치).
  - Org/Enterprise + Dev/Full: 전체를 쓸 수 있다. Variables REST 기반 토큰 동기화는 **Enterprise일 때만** 켠다.
  - 캔버스 쓰기(`generate_figma_design`, `use_figma`)는 Full 시트가 아니면 "드래프트에만 생성"이라고 안내한다.
  - 숫자 한도는 하드코딩하지 않고 docs 링크와 `X-Figma-Upgrade-Link`로 연결한다.
- **선택적 온보딩**
  - 첫 실행 체크리스트에 "Figma 연결 (선택)"을 두고 "건너뛰기 / 나중에" 버튼을 제공한다. 설정 > 통합에서 언제든 켜고 끌 수 있게 한다.
  - **프로젝트별 토글**: 백엔드 repo에서는 끄고, Figma 링크가 고정된 프로젝트에서만 `--mcp-config`를 주입한다. 이는 wmedia가 백엔드 repo에서 project scope를 권장한 것과 같은 취지다.
  - 끈 상태에서는 Figma 관련 UI를 아예 숨긴다. 꺼져 있는데도 비활성 버튼이 잔뜩 보이는 것을 피하기 위해서다. 켠 상태에서만 비활성화와 사유 툴팁을 보여 준다.
  - 문구는 i18n 규칙에 따른다. 예: "Dev 시트 필요" / "Needs a Dev seat", "Organization 플랜 필요" / "Needs Organization plan".

### Gaps

- `whoami`의 정확한 응답 스키마(필드명, 플랜 ID 형식)는 공식 문서에서 확인하지 못했다.
- MCP 한도 초과나 시트 부족 시 MCP 서버가 돌려주는 정확한 오류 메시지 문자열은 문서에 없다. 출력 패턴 감지는 실측이 필요하다.
- Variables 엔드포인트 403의 본문 메시지, Comments와 Webhooks REST의 플랜 제한(Starter 허용 여부)은 확인하지 못했다.
- Code Connect가 Professional에서 되는지는 Figma 자체 문서끼리 불일치해 미해결이다.
- Enterprise의 REST tier별 수치는 추출된 페이지에 보이지 않았다.
