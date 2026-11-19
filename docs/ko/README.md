# Aquila Agents

> English: [../../README.md](../../README.md)

모든 프로젝트의 Claude Code·Codex 세션을 창 하나에서.
프로젝트마다 터미널을 띄울 필요 없이, 왼쪽에서 프로젝트를 고르고 Claude / Codex / 셸을 탭으로 열면
어떤 에이전트가 작업 중인지, 끝났는지, 나를 기다리는지 한눈에 보입니다.

- **진짜 CLI를 그대로.** 내 `claude`와 `codex`를 실제 터미널로 실행 — 로그인, `CLAUDE.md`, hooks, MCP,
  슬래시 명령, 토큰 사용량 전부 그대로.
- **보이는 상태.** 세션별·프로젝트별 작업 중 / 입력 필요 / 완료 표시 + macOS 알림.
- **Claude 계정 두 개.** 프로젝트마다 공용(`claude`) 또는 개인(`claude-personal`), 클릭 한 번으로 전환.
- **한국어·영어** UI.

## 실행

```bash
npm install     # Electron용 node-pty 빌드까지
npm run dev     # 핫 리로드로 앱 실행
npm run smoke   # 빌드 → 실행 → 터미널 세션 동작 확인 → 스크린샷 dist/smoke.png
npm run capture # 앱 가이드의 스크린샷·루프를 데모 픽스처로 다시 만들기 (ko + en)
npm run check   # 타입 체크 + 린트(FSD 경계 포함) + 테스트
npm run dist    # 패키징 → release/Aquila Agents-<버전>-arm64.dmg (+ .zip)
```

프로젝트 목록은 `~/.aquila/config.json`에 있습니다 (처음 실행 때 생성, 사이드바 "설정 파일 열기").

## 빌드 전달하기

`npm run dist`가 `release/Aquila Agents-<버전>-arm64.dmg`와 `.zip`(Apple Silicon)을 만듭니다. 전달할 때마다
`package.json`의 `version`을 올리세요. 아직 **서명·공증을 하지 않아서** 받는 맥에서는:

1. `.dmg`를 열고 **Aquila Agents**를 응용 프로그램 폴더로 끌어 놓습니다.
2. 처음 실행은 "확인되지 않은 개발자"로 막힙니다. 앱을 우클릭 → **열기** → **열기**, 또는 한 번만 실행:
   `xattr -dr com.apple.quarantine "/Applications/Aquila Agents.app"`
3. 그 맥에 `claude`나 `codex`가 이미 설치·로그인돼 있어야 합니다 (앱이 실제 CLI를 실행합니다).

## 단축키

| 키 | 동작 |
|---|---|
| ⌘T / ⇧⌘T / ⌥⌘T | 현재 프로젝트에서 Claude / Codex / 셸 열기 |
| ⌘W | 세션 닫기 (빈 화면이면 분할 닫기) |
| ⌘D / ⇧⌘D | 오른쪽 / 아래로 분할 (최대 4개) |
| ⌥⌘방향키 | 분할 화면 사이 포커스 이동 |
| ⇧⌘↩ | 포커스된 분할 확대 / 되돌리기 (헤더 더블클릭도 됨) |
| ⌥⇧⌘방향키 | 분할 크기 조절 (구분선 드래그, 더블클릭하면 반반) |
| ⇧⌘G | 변경사항 패널(git diff) 열기 / 닫기 |
| ⌘K | 명령 팔레트: 세션·프로젝트로 이동하거나 동작 실행 |
| ⌘J | 나를 기다리는 다음 세션으로 (waiting > error > done, 모든 프로젝트) |
| **+** 우클릭 | 새 Claude / Codex / 셸, 또는 **워크트리에서 새 Claude…** (`../<repo>-wt/<branch>`) |
| ⌘1–9 | 프로젝트 이동 |

## 문서

- [아키텍처](ARCHITECTURE.md) · [디자인 시스템](DESIGN-SYSTEM.md) · [태스크](TASKS.md)
- 에이전트용: [AGENTS.md](../../AGENTS.md) (Codex) / [CLAUDE.md](../../CLAUDE.md) (Claude Code)
