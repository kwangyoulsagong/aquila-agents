# Ghostty 기능 조사 — 우리에 넣을 만한가 (2026-11-20)

기준: Ghostty 1.3(2026-03), 1.4(2026-10). 판단 기준은 (1) 에이전트 세션 허브라는 우리 목적에 맞는가,
(2) 실행 성능 부담, (3) xterm.js 위에서 할 수 있는가.

## 이미 있음

| Ghostty                                | 우리                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 커맨드 팔레트(1.2)                     | ⌘K (T6)                                                                                                                             |
| splits, 포커스 이동, zoom              | split view + zoom/resize (T1, T22)                                                                                                  |
| 스크롤백 메모리 절감(1.4 압축, 70~90%) | 압축은 xterm.js에서 불가. 대신 종류별 스크롤백(`SCROLLBACK`: claude/codex 5000, shell 10000) 이미 있음 → T37의 스크롤백 절반은 끝남 |
| `GHOSTTY_SURFACE_ID` env               | `AQUILA_TAB_ID` env                                                                                                                 |
| `+ssh` terminfo 설치                   | 원격은 전용 tmux로 실행(T29), 필요 없음                                                                                             |
| OSC 7501 상태 프로토콜(Hashimoto 제안) | 상태 판정 1차 경로(T14)                                                                                                             |

## 넣을 만함

1. **스크롤백 검색 ⌘F** (1.3 헤드라인). 우리에 없음. `@xterm/addon-search`로 가능. 검색할 때만 돌기 때문에
   평소 성능 비용 0. 긴 Claude 출력에서 에러·파일명 찾기에 바로 쓸모 있음. **추천: 새 작업.**
2. **붙여넣기 안전성 점검**. 1.3이 CVE-2026-26982(붙여넣은 제어 문자로 명령 실행)를 고침. 우리 붙여넣기는
   xterm.js `paste()` + bracketed paste. 붙여넣는 텍스트 안의 `ESC[201~` 같은 제어 문자를 걸러 내는지 **확인
   필요**. 작고 보안 관련이라 검색 작업에 같이 넣기 좋음.
3. **전역 단축키로 앱 호출 (quick terminal 변형)**. Ghostty quick terminal은 드롭다운 셸이지만, 우리에 맞는 형태는
   "어디서든 단축키 → Aquila 앞으로 + 다음 대기 세션으로 이동". `globalShortcut` 하나, 성능 비용 0. 사용자가
   바꾸거나 끌 수 있어야 함(다른 앱 단축키와 충돌). **추천: 작게.**

## 보류

- **프롬프트 마크 / 프롬프트 간 이동(OSC 133)**, 1.3의 click-to-move-cursor. 셸 세션에만 의미가 있고 Claude/Codex
  TUI는 OSC 133을 내지 않음. 우리 세션 대부분이 에이전트라 효과가 작음. 셸 통합 스크립트를 주입해야 하는데
  "사용자 CLI 설정을 건드리지 않는다" 규칙과도 부딪힘.
- **xterm.js → libghostty-vt(WASM, `ghostty-web`) 교체**. xterm.js 호환 API가 있어 이론상 교체 가능하고 파싱
  성능·메모리 이득이 있을 수 있음. 하지만 libghostty 1.0은 제3자 글로만 확인됨, `ghostty-web`은 패치된 포크,
  한글 IME(T18) 회귀 위험이 큼(cmux에서도 IME 버그 보고). 지금은 xterm.js 6로 충분. 1~2일 스파이크(세션 15개
  메모리·CPU 비교 + IME smoke)는 나중에 가치 있음.

## 안 넣음

- Kitty graphics(1.4 완전 구현): 에이전트 CLI가 쓰지 않음. xterm.js 지원도 없음.
- Terminal inspector: 터미널 개발자용.
- 네이티브 Metal 렌더러, Linux OpenGL: Electron 앱이라 해당 없음.

## 출처

- [1.3.0 release notes](https://ghostty.org/docs/install/release-notes/1-3-0)
- [1.4.0 release notes](https://ghostty.org/docs/install/release-notes/1-4-0)
- [Mitchell Hashimoto — 1.4 announcement](https://x.com/mitchellh/status/2115124583170974193)
- [libghostty is coming](https://mitchellh.com/writing/libghostty-is-coming)
- [coder/ghostty-web](https://github.com/coder/ghostty-web)
- [Libghostty 1.0 (제3자)](https://www.buildmvpfast.com/blog/libghostty-1-0-build-terminal-ghostty-engine-2026)
- [Ghostty 1.2: command palette, quick terminal size](https://alternativeto.net/news/2025/9/ghostty-1-2-adds-command-palette-new-app-icons-quick-terminal-size-and-ssh-improvements)
