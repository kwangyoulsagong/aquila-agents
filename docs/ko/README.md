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
npm run check   # 타입 체크 + 린트(FSD 경계 포함) + 테스트
```

프로젝트 목록은 `~/.aquila/config.json`에 있습니다 (처음 실행 때 생성, 사이드바 "설정 파일 열기").

## 단축키

| 키 | 동작 |
|---|---|
| ⌘T / ⌘⇧T / ⌘⌥T | 현재 프로젝트에서 Claude / Codex / 셸 열기 |
| ⌘W | 세션 닫기 (빈 화면이면 분할 닫기) |
| ⌘D / ⌘⇧D | 오른쪽 / 아래로 분할 (최대 4개) |
| ⌘⌥방향키 | 분할 화면 사이 포커스 이동 |
| ⌘⇧G | 변경사항 패널(git diff) 열기 / 닫기 |
| ⌘1–9 | 프로젝트 이동 |

## 문서

- [아키텍처](ARCHITECTURE.md) · [디자인 시스템](DESIGN-SYSTEM.md) · [태스크](TASKS.md)
- 에이전트용: [AGENTS.md](../../AGENTS.md) (Codex) / [CLAUDE.md](../../CLAUDE.md) (Claude Code)
