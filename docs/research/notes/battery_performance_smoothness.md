# Aquila Agents 배터리 · 성능 · UI 부드러움 (Electron + xterm.js, macOS)

> 조사일 2026-11-19. 출처는 1차 자료(공식 문서, 릴리스 노트, 이슈) 우선. 커뮤니티 글은 그렇다고 표시함.
> 태그: **[출처 있음]** = 이 세션에서 직접 확인함. **[추론]** = 출처를 바탕으로 한 판단이거나, 이번 세션에서 확인하지 못한 학습 지식.

---

## 1. 사용자 불만과 측정치: Electron 터미널 vs 네이티브, Claude Code 출력

### Takeaway

엄밀한 터미널별 배터리 벤치마크는 공개된 것이 없다. 근거는 Activity Monitor 일화 수준이다. 반면 Claude Code 쪽 문제(깜빡임, 스크롤 튐, 장시간 세션에서 렌더 CPU 증가)는 문서와 이슈로 잘 확인된다. Anthropic은 2026년에 "fullscreen(alt-screen) 렌더러"를 만들어 이를 해결했다. 이 렌더러가 기본값이 되는 조건이 있고, 그 조건에 해당하는 사용자가 늘고 있다. 결국 Aquila Agents 입장에서 가장 큰 변수는 Claude Code가 어느 렌더러로 그리느냐다.

### Cited Findings

- 사례(MacBook Air M3, Activity Monitor Energy 탭, 12시간 누적 Energy Impact): Ghostty 3,600, Brave 125, Zoom(영상 포함) 99, Claude 데스크톱 앱 46. 저자는 GPU 렌더러가 효율보다 성능을 우선하기 때문이라고 해석한다. 처방은 iTerm2에서 GPU Rendering을 끈 "Battery" 프로필(`pmset -g batt`로 자동 전환), Terminal.app 사용(CPU 렌더링, App Nap 정상 진입), Ghostty에서 `cursor-style-blink = false` 설정 등이다. 측정은 한 사람의 일화이고 단위는 상대값이다. — [DEV: Your Terminal is Burning Battery](https://dev.to/frr149/your-terminal-is-burning-battery-like-its-mining-bitcoin-4e7l)
- Ghostty 개발자 입장: "배터리 상태에서 macOS가 Ghostty를 늦추려 하면 그렇게 할 수 있고, 우리는 그걸 존중한다." — [HN Ghostty 1.0 스레드(미러)](https://hn.nuxt.dev/item/42517447)
- Claude Code 공식 문서: fullscreen 렌더링은 "깜빡임을 없애고, 긴 대화에서도 메모리를 평평하게 유지하며", alternate screen buffer에 그리고 **보이는 메시지만 렌더**해서 "업데이트마다 터미널로 보내는 데이터 양을 줄인다." 효과는 "렌더링 처리량이 병목인 터미널, 예컨대 VS Code 통합 터미널(xterm.js), tmux, iTerm2에서 가장 크다." 작업 중 스크롤이 맨 위로 튀거나 화면이 번쩍이는 증상을 이 모드가 해결한다. — [Claude Code Docs: Fullscreen rendering](https://code.claude.com/docs/en/fullscreen)
- 같은 문서에서 기본값 규칙: 기능 플래그를 받는 세션이고 2026-05-06 이후 처음 사용한 사용자는 fullscreen이 기본이다. 기능 플래그를 받지 않는 세션(Bedrock/Vertex/Foundry, 텔레메트리 끔)은 첫 실행 버전이 v2.1.239 이상이면 fullscreen이다. 그 외에는 classic이 기본이다. `CLAUDE_CODE_NO_FLICKER=1`이면 강제 fullscreen, `CLAUDE_CODE_NO_FLICKER=0` 또는 `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1`이면 classic이다. `/tui fullscreen`·`/tui default`로 대화 중 전환할 수 있다. — [Claude Code Docs: Fullscreen](https://code.claude.com/docs/en/fullscreen)
- 같은 문서: Claude Code는 시작할 때 터미널의 synchronized output 지원 여부를 **probe**해서 지원하면 쓴다. tmux 3.6 이하는 미지원이라 깜빡임이 더 많다. fullscreen은 바뀐 셀만 보낸다. ConPTY 계열은 이를 잘못 병합해 잔상이 남을 수 있고, 이때 쓰는 우회책이 `CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT=1`이다. xterm.js 기반 터미널에서는 Claude Code가 링크 클릭을 터미널의 링크 핸들러에 맡긴다. 마우스 캡처를 끄려면 `CLAUDE_CODE_DISABLE_MOUSE=1`. — [Claude Code Docs: Fullscreen](https://code.claude.com/docs/en/fullscreen)
- 프로파일링(커뮤니티 글): classic 렌더러에서 화면 diff(`Qt1`)와 버퍼 재구성(`get`)이 세션 초반 CPU의 0.2%에서 세션 끝에는 48%까지 올라갔다. v2.1.14에서는 합계 약 22%(11.3% + 10.4%)로 줄었다. 500개 메시지 × 80열이면 프레임당 약 40,000셀을 diff한다는 추정도 있다. render 본문에서 changelog 파일을 초당 약 18회 `readFileSync` 한다. 이슈 사용자들이 보고한 수치로 메모리 29MB/분 증가, 500MB에서 타이핑 지연이 있다. — [DEV: I profiled Claude Code some more, part 2](https://dev.to/vmitro/i-profiled-claude-code-some-more-part-2-do-androids-dream-of-on-diffs-2kp6)
- 이슈 보고: "터미널 렌더러 CPU spin, 큰 세션에서 렌더 사이클당 625K writes / 0 blits로 100% CPU" (#21567). 장시간 백그라운드 Bash가 끝난 뒤에도 메인 스레드 CPU가 100–140%로 수 시간 지속(v2.1.222, macOS arm64, #85731). 원인은 확정되지 않은 사용자 보고다. — [검색 결과 요약: claudeissues 미러 #21567, #85731](https://claudeissues.com/issue/21567-terminal-renderer-cpu-spin-100-cpu-with-625k-writes-0-blits-on-large-session) (원문 fetch 실패. 검색 스니펫만 확인함)
- tmux에서 DECSET 2026이 빠져 깜빡이고 커서가 튄다는 이슈(#37283)는 resolved 처리됐다. — [anthropics/claude-code#37283](https://github.com/anthropics/claude-code/issues/37283)
- 고주사율·고해상도(4K@165Hz, 120Hz) 화면에서 Claude Code 출력 중 데스크톱 전체가 버벅인다는 보고가 있다(#42045). Windows 사례이고 CPU/GPU 수치는 없다. 한 사용자는 그래픽 드라이버의 커널 nonpaged pool 누수(약 60MB/시간)를 의심했다. 메인테이너 답변 없이 stale로 닫혔다. — [anthropics/claude-code#42045](https://github.com/anthropics/claude-code/issues/42045)
- fullscreen 렌더러가 macOS에서 줄바꿈된 행을 중복 출력하거나 깨뜨린다는 이슈(2026-06-10)가 있고, classic에는 없는 문제라고 한다. — [claudeissues #67215](https://claudeissues.com/issue/67215-bug-fullscreen-no-flicker-alt-screen-renderer-duplicates-content-lines-on-wrappe)
- 커뮤니티 PTY 프록시 "claude-chill"은 Claude Code의 화면 업데이트를 줄인다(비공식). — [feedbagel 요약](https://feedbagel.com/post/claude-chill-a-pty-proxy-tool-to-optimize-claude-codes-terminal-output-performan)

### Inferences

- [추론] Aquila Agents가 띄우는 `claude` 세션이 어느 렌더러를 쓰느냐에 따라 xterm.js 부하가 크게 달라진다. classic은 긴 대화일수록 프레임당 출력이 커지고 scrollback도 계속 쌓인다. fullscreen은 바뀐 셀만 보내고 scrollback이 늘지 않는다. Aquila Agents는 "사용자 CLI 설정을 건드리지 않는다"는 원칙(규칙 6)이 있으므로 env를 강제하지 말아야 한다. 대신 설정에서 "Claude 세션을 fullscreen으로 시작(`CLAUDE_CODE_NO_FLICKER=1`을 우리가 spawn하는 세션에만 주입)" 옵션을 주는 정도가 적당하다. 이 방식은 `--settings` 주입과 같은 범주다.
- [추론] fullscreen 모드에서는 대화가 xterm scrollback에 남지 않는다. 그러므로 "숨긴 세션도 scrollback을 지키려고 mount를 유지한다"는 현재 설계의 이점이 Claude 세션에서는 줄어든다. Codex나 셸 세션에는 여전히 의미가 있다.
- [추론] 2026년 기준으로 깜빡임 불만은 상당 부분 CLI 쪽에서 해결됐다. 남은 호스트 쪽 핵심은 (a) DEC 2026 지원(xterm.js 6.0 필요), (b) 많은 세션이 동시에 출력할 때의 처리량, 흐름 제어, 렌더 비용이다.

### Gaps

- VS Code 터미널, Hyper, Tabby, Warp, Wave와 Ghostty, iTerm2, Kitty, WezTerm, Alacritty를 같은 조건에서 비교한 Energy Impact나 전력(W) 측정은 찾지 못했다.
- Codex CLI의 렌더링 부하나 깜빡임에 대한 공식 자료는 이번 세션에서 찾지 못했다.
- #21567, #85731 원문을 fetch하지 못했다(미러 도메인 DNS 실패). 검색 스니펫만 근거다.

---

## 2. xterm.js 렌더러, 다중 WebGL 컨텍스트, 숨긴 터미널, 흐름 제어, DEC 2026

### Takeaway

(1) xterm.js 5.5에는 DEC 2026이 **없다**. 6.0.0에서 추가됐다(#5453). Claude Code는 이를 probe해서 쓰므로 6.x로 올리는 것이 깜빡임 감소에 가장 직접적이다. (2) Chromium은 활성 WebGL 컨텍스트가 약 16개를 넘으면 가장 오래된 것을 잃는다. 세션마다 WebglAddon을 붙이고 5–15개 세션을 mount한 상태로 두는 현재 구조는 이 한계에 닿는다. 보이는 터미널(최대 4개)에만 WebGL을 붙이는 방식이 정답에 가깝다. (3) 흐름 제어는 공식 가이드의 watermark 또는 callback counting 방식을 따르면 된다.

### Cited Findings

- xterm.js 6.0.0 릴리스: DEC mode 2026 synchronized output 지원 추가(#5453). **Canvas 렌더러 제거**(#5105, DOM 또는 WebGL을 권장). 스크롤바를 VS Code base 코드로 교체해 viewport와 스크롤 동작이 "매우 다르게" 바뀜(#5096). Smooth scroll은 프레임당 1회로 제한(#5037). CoreBrowserService 메모리 누수 수정(#4936). dispose 시 타이머 정리(#4984). WebGL 렌더러가 throw한 뒤 리스너가 남던 문제 수정(#5305). `onWriteParsed` API 공개(#5034). 이 밖에 breaking change로 `windowsMode`·`fastScrollModifier` 제거, `overviewRulerWidth` 이동이 있다. — [newreleases: @xterm/xterm 6.0.0](https://newreleases.io/project/npm/@xterm/xterm/release/6.0.0)
- Wave Terminal(Electron + xterm.js)은 2026-03-23에 xterm.js v6.0.0으로 올렸다(PR #3095). — [wavetermdev/waveterm#3095 (미러)](https://gh.r-mj.com/wavetermdev/waveterm/pull/3095)
- xterm.js `RenderService`는 화면 요소에 IntersectionObserver(threshold 0)를 걸어, 보이지 않을 때 렌더링을 **자동으로 일시정지**하고 보이면 재개한다. 숨긴 상태로 open된 경우도 따로 처리한다. 원래 동기는 "Hyper나 VS Code처럼 탭에 여러 터미널을 두는 앱의 성능과 배터리"였다. — [RenderService.ts (미러)](https://download.hermesedi.duckdns.org/.hermes/hermes-agent/node_modules/@xterm/xterm/src/browser/services/RenderService.ts); [xterm.js#880 pause/resume rendering 요청](https://github.com/xtermjs/xterm.js/issues/880)
- WebGL addon README: 브라우저는 OOM이나 시스템 suspend 이후 등 여러 이유로 WebGL 컨텍스트를 버릴 수 있다. `onContextLoss`에서 `dispose()`하고 폴백하라고 권한다. — [@xterm/addon-webgl README](https://cdn.jsdelivr.net/npm/@xterm/addon-webgl@0.19.0/README.md)
- 데스크톱 Chrome은 활성 WebGL 컨텍스트를 약 16개까지 허용한다. 초과하면 "Too many active WebGL contexts. Oldest context will be lost."가 뜬다. WebKit 커밋도 "다른 브라우저들은 동시 활성 WebGL 컨텍스트 16개 제한"이라고 적고 있다. Chromium에는 `--max-active-webgl-contexts` 스위치가 있다는 언급이 있으나 Electron에서 검증되지 않았다. — [WebKit commit](https://webkit.googlesource.com/WebKit/+/70e10861eb2fbd9d0862fd8702874c25ae5d8bfd%5E%21); [chromium graphics-dev](https://groups.google.com/a/chromium.org/g/graphics-dev/c/fmNedEEAYpA); [Plotly 커뮤니티](https://community.plotly.com/t/too-many-active-webgl-contexts/16379)
- 실사례 1 (kolu): 포커스된 타일만 WebGL을 쓰고 나머지는 DOM 렌더러로 둔다. blur 시 WebGL을 dispose하면 refresh가 예약되지 않아 폴백 렌더러가 이전 내용을 보여주는 버그가 있었고, dispose 직후 강제 repaint(`term.refresh(0, rows-1)`)로 해결했다. — [juspay/kolu#1299 (미러)](https://github.gg22.workers.dev/juspay/kolu/issues/1299)
- 실사례 2 (Superset 데스크톱): WebGL context loss가 한 번 나면 이후 터미널은 WebGL을 사용 불가로 표시하고 DOM으로 폴백한다. — [superset-sh/superset#4612 (미러)](https://github.meowingcats01.workers.dev/superset-sh/superset/pull/4612)
- VS Code에서 렌더링이 깨지면 `terminal.integrated.gpuAcceleration: off`로 우회한다는 보고가 있다. — [claudeissues #59915](https://claudeissues.com/issue/59915-bug-intermittent-terminal-rendering-corruption-in-vs-code-text-selection-forces)
- 흐름 제어 공식 가이드: xterm.js의 처리 속도는 약 5–35MB/s이고, 생산자는 GB/s급이 될 수 있다. 내부 write 버퍼는 50MB 상한이며 넘치면 **버린다**. 파싱은 이벤트 루프 1회당 16ms 프레임 미만으로 시간을 쪼갠다. 청크마다 pause/resume하는 방식은 비효율적이다. watermark 예시는 `HIGH=100000`, `LOW=10000`이고, 키 입력 반응성을 위해 HIGH는 500K를 넘기지 말라고 한다. 권장안은 **100KB마다만 write callback**을 붙이고 대기 중인 callback 수가 `HIGH=5`면 pause, `LOW=2`면 resume하는 방식이다. 검증은 `yes`를 실행하고 Ctrl-C 반응 시간을 보면 된다. WebSocket이나 IPC를 거치면 클라이언트가 ACK 메시지를 보내 서버 측 카운트를 맞춰야 한다. — [xterm.js Flow Control guide](https://xtermjs.org/docs/guides/flowcontrol/)
- Hyper에서 영감을 받은 방식: PTY 출력을 약 16ms 타이머 또는 약 100KB 임계값 중 먼저 오는 쪽에서 합쳐 전송한다(Taobao 엔지니어링 글). 다른 앱은 node-pty → main → IPC 배치(50ms) → renderer 구조를 쓴다. — [besthub: Boosting Web IDE terminal performance](https://besthub.dev/articles/boosting-web-ide-terminal-performance-with-xterm-js-and-node-pty-37688f4bf2db); [emdash IPC handlers 문서](https://www.mintlify.com/generalaction/emdash/api/ipc-handlers)

### Inferences

- [추론] **세션 5–15개 × WebglAddon = 16개 한계 근접 또는 초과**. 모든 세션에 WebGL을 붙이면 컨텍스트가 조용히 소실된다. 그러면 오래된 세션이 빈 화면이 되거나 폴백 없이 깨질 수 있다. 현재 Aquila Agents 코드가 세션별로 WebglAddon을 load한다면 이것이 가장 시급한 안정성·성능 이슈다. 처방은 "보이는 터미널(split 최대 4개)에만 WebGL을 붙이고, 숨길 때 dispose한 뒤 refresh"하는 것이다. 숨긴 터미널은 렌더러 없이(DOM 기본 렌더러) 버퍼만 유지한다. 컨텍스트 수가 최대 4개로 고정되고 GPU 메모리(glyph atlas, 터미널당 텍스처)도 줄어든다.
- [추론] `display:none`인 터미널은 IntersectionObserver로 렌더가 이미 멈춘다. 따라서 숨긴 터미널의 비용은 렌더링이 아니라 **파싱(write → 버퍼 갱신)**이다. 출력이 많은 Claude 세션이 숨겨져 있어도 파서는 계속 돈다. 숨긴 세션은 렌더러 측 비용이 거의 0이지만, 파싱 비용은 생산량에 비례한다.
- [추론] DOM 렌더러는 줄 단위 DOM 갱신이라 대량 출력에서 WebGL보다 CPU를 더 쓴다. 다만 숨긴 터미널은 렌더 자체가 일시정지되므로 renderer 타입은 문제가 되지 않는다.
- [추론] xterm.js 6.0 업그레이드는 DEC 2026 지원으로 Claude Code classic 렌더러의 깜빡임을 줄인다. 하지만 스크롤바와 viewport 동작이 크게 바뀌므로 Aquila Agents의 스크롤 관련 코드와 smoke 테스트를 다시 확인해야 한다. canvas addon은 쓰지 않으므로 그 영향은 없다.
- [추론] 흐름 제어: 숨긴 세션은 렌더가 없어 파싱이 빠르기 때문에 backpressure가 거의 걸리지 않는다. 핵심은 보이는 세션이 키 입력에 계속 반응하게 하는 것이다(`yes` 테스트). IPC를 거치므로 renderer → main으로 ACK(처리된 바이트 수)를 보내 main이 `pty.pause()`/`resume()`을 하는 구조가 필요하다.
- [추론] scrollback: 버퍼 한 줄은 셀당 고정 크기의 typed array이므로 메모리는 대략 `cols × scrollback × 터미널 수`에 비례한다. 15세션 × 10,000줄 × 200열이면 수백 MB 규모가 될 수 있다. 세션 종류별로 차등 적용하는 것(예: Claude fullscreen 세션은 작게, 셸은 크게)이 합리적이다. xterm 셀당 정확한 바이트 수는 이번에 출처로 확인하지 못했다.

### Gaps

- xterm.js 6.x의 DEC 2026 구현 세부(타임아웃 값, 숨긴 터미널에서의 동작)는 공식 문서에서 찾지 못했다. 소스(#5453)를 직접 확인해야 한다.
- 한글(CJK, wide char) 폭 계산 비용에 대한 측정 자료는 찾지 못했다. Unicode11 addon과 기본 Unicode 6 폭 테이블 차이, IME 성능 등은 별도로 조사해야 한다.
- Electron 39–45 기준 WebGL 컨텍스트 기본 한계값이 여전히 16인지 공식 확인을 하지 못했다(커뮤니티와 WebKit 근거만 있음).
- xterm.js 6.1(베타)의 성능 변경 사항은 확인하지 못했다.

---

## 3. Electron: 스로틀링, powerMonitor, IPC, 메인 프로세스

### Takeaway

Electron의 `powerMonitor`는 배터리·AC 전환, 열 상태, CPU 속도 제한 이벤트를 준다. 그래서 폴링 간격과 렌더 품질을 이벤트 기반으로 조정할 수 있다. Low Power Mode 전용 API는 문서에 없다. 공식 성능 가이드의 핵심은 "메인 프로세스를 막지 말 것(동기 fs/child_process 금지, 동기 IPC 금지)"이다. 대량 PTY 데이터는 main에서 16ms 또는 약 100KB 단위로 배치해 보내고 ACK 기반으로 흐름을 제어하는 것이 실무 표준이다.

### Cited Findings

- `powerMonitor` 이벤트: `on-battery`/`on-ac`(macOS, Windows), `thermal-state-change`(macOS, nominal/fair/serious/critical), `speed-limit-change`(macOS, Windows, 100 미만이면 열 관리로 CPU 제한 중), `suspend`/`resume`, `lock-screen`/`unlock-screen`, `user-did-become-active`/`user-did-resign-active`. 메서드: `isOnBatteryPower()`, `getCurrentThermalState()`, `getSystemIdleState(threshold)`, `getSystemIdleTime()`. **Low Power Mode API는 문서에 없음.** — [Electron powerMonitor](https://electronjs.org/docs/latest/api/power-monitor)
- Electron 성능 가이드: 메인 프로세스와 UI 스레드를 장시간 작업으로 막지 말 것. CPU 작업은 worker thread나 별도 프로세스로 보낼 것. `fs`·`child_process`의 동기 API를 피할 것. 동기 IPC와 `@electron/remote`를 피할 것. 렌더러의 저우선 작업은 `requestIdleCallback`으로 돌릴 것. 번들링, 지연 로딩, 쓰지 않으면 `Menu.setApplicationMenu(null)`. — [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- MessagePort를 쓰면 main을 거치지 않고 컨텍스트 간 직접 채널을 만들 수 있다(공식 문서에 처리량 수치는 없음). — [Electron MessagePorts](https://www.electronjs.org/docs/tutorial/message-ports)
- node-pty를 렌더러에서 main으로 옮기는 것이 성능에 유리하다는 논의(주로 Windows)가 있다. — [microsoft/node-pty#415](https://github.com/microsoft/node-pty/pull/415)

### Inferences

- [추론, 이번 세션에서 문서 미확인] `webPreferences.backgroundThrottling`의 기본값은 true다. 창이 가려지거나 최소화되면 rAF가 멈추고 타이머가 스로틀된다. Aquila Agents는 이 기본값을 유지해야 한다(false로 바꾸면 배터리에 손해). 다만 상태 판정용 "출력 활동 타이머"가 렌더러의 `setTimeout`에 의존한다면, 창이 가려졌을 때 스로틀로 상태 전환이 늦어질 수 있다. 상태 판정을 main 프로세스(pty 데이터를 직접 받는 곳)로 옮기면 정확성과 배터리 문제가 함께 해결된다.
- [추론] Low Power Mode는 Electron API가 없다. 대안은 (a) main에서 `pmset -g` 출력이나 macOS의 `NSProcessInfo.isLowPowerModeEnabled`를 네이티브 애드온으로 읽기, (b) `on-battery`와 `thermal-state-change`, `speed-limit-change`만으로 "절전 프로필"을 트리거하기다. (b)가 비용 대비 효과가 좋다.
- [추론] PTY 데이터 경로: node-pty `onData`가 올 때마다 `webContents.send`를 호출하면 IPC 메시지가 폭증한다. 세션별로 문자열을 모아 16ms(또는 rAF 주기) 또는 64–100KB 중 먼저 오는 시점에 1회 전송한다. 숨긴 세션은 더 긴 주기(예: 100–250ms)로 모으면 렌더러 깨우기 횟수가 줄어든다. 단, 숨긴 세션의 상태 dot과 알림은 main에서 판정해야 지연이 없다.
- [추론] 동기 IPC(`sendSync`)나 main의 `execSync`·`readFileSync`가 있다면 모든 세션의 입력 지연으로 이어진다. git 폴링도 `execFile`(async)로 돌려야 한다.

### Gaps

- Electron 39–45(2025–2026)의 구체적인 성능·전력 개선(예: Chromium 업그레이드별 효과)은 이번 세션에서 확인하지 못했다.
- MessagePort, `ipcRenderer.on`, transferable ArrayBuffer의 PTY 처리량 비교 벤치마크는 찾지 못했다.
- `sandbox`·`contextIsolation`의 성능 비용에 대한 정량 자료는 찾지 못했다(일반적으로 미미하다고 알려져 있으나 출처 없음).

---

## 4. macOS 측정과 폴링 비용 (git, 시스템 모니터)

### Takeaway

git 폴링(5초마다 `git status` + `git diff`)은 매번 프로세스 2개를 spawn하고 작업 트리를 스캔한다. VS Code조차 `.git` 파일 감시, 셸 통합, 폴링을 섞어 쓴다. 그러니 `.git/index`·`HEAD`·`refs` 감시(FSEvents)와 작업 트리 감시에 debounce를 걸고, 폴링은 긴 간격의 안전망으로만 두는 것이 좋다. 측정 도구로는 Activity Monitor Energy 탭과 `powermetrics`가 있다.

### Cited Findings

- VS Code 내장 git 확장의 변경 감지(사용자 보고 기준): ① `.git/index`, `.git/refs/` 등의 파일 시스템 watcher, ② 통합 터미널 셸 통합으로 git 명령 감지, ③ `git.autoRefresh` 폴링(약 5초). git의 원자적 write 패턴 때문에 watcher가 놓치는 경우(WSL2)가 있다. — [claudeissues #33678](https://claudeissues.com/issue/33678-vs-code-source-control-panel-doesnt-refresh-after-git-operations)
- Watchman이나 fsmonitor가 작업 트리에 cookie 파일을 쓰면 VS Code가 `git status`를 루프로 호출하는 문제가 있었다. cookie를 `.git` 안에 쓰는 것으로 해결했다(VS Code는 `.git` 내부 변경 일부를 트리거로 보지 않음). — [git 메일링리스트](https://lore.kernel.org/git/9c09459b-2d27-6997-63c1-46c8df52eda7@gmail.com/t/)
- git 내장 `fsmonitor--daemon`은 최근 변경 파일 목록을 유지해 `git status`가 디스크 전체를 스캔하지 않게 한다. — [git-scm: git-fsmonitor--daemon](https://git-scm.com/docs/git-fsmonitor--daemon)
- 반면교사(Cursor): 멀티루트 워크스페이스에서 브랜치 추적과 파일별 git root 조회 때문에 분당 약 500개의 git 프로세스를 spawn했다. — [Cursor forum](https://forum.cursor.com/t/multi-root-workspace-agent-branch-tracker-and-per-file-git-root-lookups-spawn-500-git-processes-minute/171642)
- `git status`를 단일 폴더로 한정하면 로컬 테스트에서 약 10배 빨라졌다는 제안이 있다. — [microsoft/vscode#162417](https://github.com/microsoft/vscode/issues/162417)
- Activity Monitor Energy 탭의 "12시간 누적 전력 영향"이 사용자 불만의 근거로 실제로 쓰인다(사례 위 1절). — [DEV](https://dev.to/frr149/your-terminal-is-burning-battery-like-its-mining-bitcoin-4e7l)

### Inferences

- [추론] git 패널 개선 순서:
  1. **이벤트 기반**: `fs.watch(projectRoot, {recursive:true})`를 쓴다(macOS에서는 FSEvents 기반이라 저렴함). `.git/index`, `.git/HEAD`, `.git/refs/**`, 작업 트리 변경이 오면 300–500ms debounce 후 1회 갱신한다. `node_modules`, `.git/objects` 등은 무시한다.
  2. 갱신 시 `git status --porcelain=v2 -z`를 1회 실행한다. `git diff`는 사용자가 파일을 펼칠 때만 lazy하게 돈다. 동시에 1개만 실행하고 진행 중이면 다음 1회로 합친다.
  3. 안전망 폴링은 30–60초로 둔다. 창이 비포커스이거나 패널이 닫혀 있으면 중지한다.
  4. 사용자 저장소에 `core.fsmonitor`를 강제로 켜지 않는다(규칙 6의 정신. 설정 파일 변경 금지).
- [추론] 계정 상태 폴링(5초, 로그아웃 상태이고 포커스일 때)도 가능하면 파일 감시(자격증명 파일이나 디렉터리의 mtime)로 바꾸는 편이 낫다. 단, `~/.claude*`는 읽기만 해야 한다.
- [추론] 계획 중인 시스템 모니터(포커스 3초 / 비포커스 15초 / hidden 중지): CPU와 RAM은 `os.loadavg()`/`os.freemem()`나 `process.getCPUUsage()`, `app.getAppMetrics()`로 **spawn 없이** 얻는다. 배터리는 `powerMonitor` 이벤트와 `pmset -g batt`(spawn)를 섞되 60초 이상 간격으로 돌린다. 비포커스 15초는 배터리 상태에서 30–60초로 늘리는 것을 권한다. `on-battery`에서 간격을 2배로 하고 `thermal-state-change`가 serious 이상이면 중지한다.
- [추론] 측정 방법(검증 루프):
  - Activity Monitor > Energy: "Energy Impact"와 "12 hr Power", "App Nap" 열을 보고 Aquila Agents(Helper 프로세스 포함)를 Ghostty·iTerm2와 같은 시나리오(Claude 세션 5개, 1개가 스트리밍 중)로 비교한다.
  - `sudo powermetrics --samplers tasks,cpu_power,gpu_power -i 1000`: 프로세스별 CPU ms/s, wakeups/s, GPU 전력. 숨긴 세션이 많을 때 Aquila Agents의 **idle wakeups/s**가 핵심 지표다.
  - `top -o power`: 간이 비교용.
  - Instruments: Time Profiler, Energy Log(또는 Power Profiler), Chromium `--enable-gpu-rasterization` 상태 확인 등.
  - 처리량: `yes`·`cat 대용량파일`·vtebench로 Ctrl-C 반응 시간과 처리량. 입력 지연은 Typometer로 측정.

### Gaps

- macOS 타이머 병합(timer coalescing)과 App Nap이 Electron 앱(보이는 창이 있을 때)에 어떻게 적용되는지에 대한 Apple 1차 자료는 이번 세션에서 확인하지 못했다.
- `fs.watch` recursive(FSEvents)와 chokidar의 CPU 비교 수치는 찾지 못했다.

---

## 5. 부드러움: ProMotion, 리사이즈, React 리렌더, CSS

### Takeaway

이번 조사에서 1차 출처로 확인한 것은 적다. 확인된 것은 xterm.js 6.0의 "smooth scroll은 프레임당 1회"(#5037)와 Ghostty의 synchronized output 설명 정도다. 나머지는 일반적인 엔지니어링 원칙이므로 추론으로 표시한다.

### Cited Findings

- Ghostty 문서: synchronized output은 빠른 터미널에서 tearing을 막고 불필요한 업데이트를 줄인다. — [Ghostty: Synchronized Output](https://ghostty.org/docs/help/synchronized-output)
- xterm.js 6.0: smooth scroll을 프레임당 1회로 제한(#5037). 세로 리사이즈 시 선택이 지워지던 문제 수정(#5423). 버퍼 전환 시 스크롤 크기 수정(#5127). — [xterm.js 6.0.0 릴리스](https://newreleases.io/project/npm/@xterm/xterm/release/6.0.0)
- 고주사율(120–165Hz) 화면에서 Claude Code 출력 시 버벅임이 더 심하다는 사용자 보고가 있다(Windows). — [anthropics/claude-code#42045](https://github.com/anthropics/claude-code/issues/42045)

### Inferences

- [추론] **리사이즈 jank**: `ResizeObserver`가 올 때마다 `fit()`을 호출하면 매번 pty resize(SIGWINCH)가 발생한다. 그러면 Claude Code(Ink)가 전체 화면을 다시 그리고, 출력 폭주와 reflow 비용이 겹친다. 처방은 이렇다. ① ResizeObserver 콜백을 rAF로 합치고, cols·rows가 실제로 바뀔 때만 `fit()`을 호출한다. ② split 드래그 중에는 xterm을 CSS로만 늘리고(또는 그대로 두고) 드래그가 끝나면(pointerup) 1회 fit과 pty resize를 한다. 아니면 pty resize만 100–150ms debounce한다. ③ 숨긴(`display:none`) 터미널은 fit하지 말고, 보일 때 1회 fit한다(0×0 측정 방지).
- [추론] **React 리렌더 폭주**: 세션별 status, 출력 활동 타이머, 훅 이벤트를 workspace 페이지의 단일 state로 들고 있으면, 출력 한 바이트마다 사이드바·탭·스테이지 전체가 리렌더될 수 있다. 처방은 이렇다. ① status를 세션별 외부 store(`useSyncExternalStore`)로 분리하고 각 dot 컴포넌트만 구독한다. ② 상태 전환(idle↔working↔waiting)이 **바뀔 때만** 발행한다(출력 이벤트마다 발행하지 않음). ③ 판정은 main 프로세스에서 하고 렌더러는 전환 이벤트만 받는다. ④ xterm 인스턴스는 React state 밖(ref, 엔티티 모듈 맵)에 둔다.
- [추론] **CSS 애니메이션**: 상태 dot의 "pulse" 같은 무한 애니메이션은 세션 15개 × 무한 반복이 되어 컴포지터를 계속 깨운다. 무한 애니메이션은 피하거나 `opacity`·`transform`만 쓴다. 비포커스이거나 배터리 상태에서는 멈춘다. 프로젝트 규칙 4b(≤320ms, 상태 변화 확인용)와도 맞다. xterm 커서 깜빡임(`cursorBlink`)도 보이는 터미널 1개에만 켠다. Ghostty 사례에서도 커서 깜빡임 끄기가 배터리 팁이었다.
- [추론] **ProMotion 120Hz**: xterm.js는 rAF 주기로 렌더하므로 120Hz 화면에서는 출력 중 렌더가 2배다. 체감 부드러움과 전력의 트레이드오프다. 배터리 상태에서 출력이 폭주할 때는 렌더를 60Hz로 스로틀하는 옵션을 고려할 수 있다(xterm.js에는 공식 옵션이 없다. 쓰기 배치 주기(예: 16ms)를 조절하면 간접적으로 효과가 있다).
- [추론] Warp와 Ghostty가 부드럽게 느껴지는 이유는 네이티브 GPU 렌더러(Metal), vsync 정렬, synchronized output 지원, 메인 스레드와 분리된 IO·파싱 스레드 때문이다. Electron에서 근접하는 방법은 (a) 보이는 터미널만 WebGL, (b) DEC 2026(xterm 6), (c) 파싱 부하 분리(현재 xterm.js는 메인 렌더러 스레드에서 파싱하므로, 숨긴 세션의 대량 출력이 보이는 세션의 프레임을 잡아먹지 않게 main 측 배치·흐름 제어로 막음)이다.

### Gaps

- Warp, Ghostty 렌더링 아키텍처 1차 자료(블로그)는 이번 세션에서 fetch하지 못했다.
- xterm.js에서 숨긴 세션의 파싱 비용을 보이는 세션과 분리하는 방법(예: Web Worker 파서, headless 터미널)에 대한 공식 자료는 확인하지 못했다. `@xterm/headless`를 써서 숨긴 세션을 main 측에서 파싱하는 방안은 검토할 가치가 있으나 근거 자료가 없다.

---

## 부록: Aquila Agents 적용 우선순위 (영향 / 노력)

| #   | 기법                                                                                                                                                                                     | 예상 영향                                                                    | 노력                                                  | 근거                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------- |
| 1   | **보이는 터미널(≤4)에만 WebglAddon**. 숨기면 dispose 후 `refresh`. `onContextLoss`에서 dispose하고 DOM 폴백                                                                              | 높음: 16 컨텍스트 한계 회피(오래된 세션 깨짐 방지), GPU 메모리와 전력 감소   | 낮음–중간                                             | WebKit/Chromium 16 제한, addon README, kolu·Superset 사례 |
| 2   | **xterm.js 5.5 → 6.x** (DEC 2026 synchronized output)                                                                                                                                    | 높음: Claude Code가 probe해서 사용하므로 깜빡임과 중간 프레임 렌더 감소      | 중간: 스크롤바/viewport breaking change, smoke 재확인 | xterm 6.0 #5453, Claude Code 문서                         |
| 3   | **PTY 출력 배치(main)**: 16ms 또는 약 64–100KB, 숨긴 세션은 100–250ms. **ACK 기반 watermark 흐름 제어**(`pty.pause/resume`, HIGH ≤500K)                                                  | 높음: IPC 메시지와 렌더러 깨우기 감소, 출력 폭주 중 입력 반응성 유지         | 중간                                                  | xterm 흐름 제어 가이드, Hyper/Taobao 사례                 |
| 4   | **상태 판정을 main으로**, 렌더러는 상태 전환 이벤트만 받음. 세션별 store 구독                                                                                                            | 중–높음: React 리렌더 폭주 제거, backgroundThrottling과 무관하게 정확한 상태 | 중간                                                  | Electron 성능 가이드(메인 비차단) + 추론                  |
| 5   | **git 패널: FSEvents 감시 + debounce + lazy diff**, 폴링은 30–60초 안전망                                                                                                                | 중간: 5초마다 2개 spawn 제거, 유휴 wakeup 감소                               | 중간                                                  | VS Code git 방식, Cursor 반면교사                         |
| 6   | **powerMonitor 절전 프로필**: `on-battery`, `thermal-state-change`(serious 이상), `speed-limit-change`에서 폴링 간격 2–4배, 커서 깜빡임과 무한 애니메이션 끄기, 숨긴 세션 배치 주기 늘림 | 중간                                                                         | 낮음                                                  | Electron powerMonitor 문서                                |
| 7   | **리사이즈**: ResizeObserver → rAF 합치기, cols·rows가 바뀔 때만 fit, split 드래그 중에는 pty resize debounce 또는 드래그 끝에 1회                                                       | 중간: Claude Ink 전체 재그리기 폭주 감소                                     | 낮음                                                  | 추론                                                      |
| 8   | **Claude 세션 fullscreen 옵션**: 우리가 spawn하는 세션에만 `CLAUDE_CODE_NO_FLICKER=1` 주입(설정 토글, 기본은 사용자 설정을 따름)                                                         | 중–높음: 장시간 세션의 출력량과 scrollback 증가 억제                         | 낮음                                                  | Claude Code fullscreen 문서                               |
| 9   | **scrollback 차등**(셸 많이, Claude fullscreen 적게), 세션 수가 많을 때 경고                                                                                                             | 중간: 메모리                                                                 | 낮음                                                  | 추론                                                      |
| 10  | 시스템 모니터는 spawn 없이 `app.getAppMetrics()`/`os.*`, 배터리는 이벤트 + 저빈도                                                                                                        | 낮음–중간                                                                    | 낮음                                                  | 추론                                                      |
| 11  | 측정 루프 도입: `powermetrics --samplers tasks` (idle wakeups/s), Energy 탭 12hr Power, `yes` Ctrl-C 테스트를 smoke에 추가 검토                                                          | 검증용                                                                       | 낮음                                                  | DEV 사례, xterm 가이드                                    |
