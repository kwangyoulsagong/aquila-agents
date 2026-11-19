# 에너지

> English: [../en/ENERGY.md](../en/ENERGY.md)

추측 말고 숫자로 (T9). 도구는 두 가지입니다.

- **`npm run perf`** — 앱 안에서 측정: 셸 세션 15개(화면 2개, 숨김 13개)로 idle / 에이전트 같은 스트리밍 출력 /
  `yes` 폭주를 잽니다. 프로세스 종류별 CPU %, idle wakeups/s(`app.getAppMetrics`), IPC 메시지/s, fps,
  `yes` → Ctrl-C 응답 시간을 출력합니다. `AQUILA_POWER_SAVER=1`을 붙이면 절전 프로필을 강제로 켭니다.
- **`scripts/measure-energy.sh [앱 …]`** — 앱 밖에서 측정: 앱마다 자기 프로세스들의 `top -stats pid,cpu,idlew,power`
  값을 합칩니다(Aquila Agents, Terminal, Ghostty, iTerm2 중 실행 중인 것). `POWERMETRICS=1`이면
  `sudo powermetrics --samplers tasks`로 작업별 wakeups와 에너지도 봅니다.

## 절전 프로필

`electron/power.ts`가 `powerMonitor`(`on-battery` / `on-ac`, `speed-limit-change`, `thermal-state-change`)를 봅니다.
**절전** = 배터리 사용 중, CPU 속도 제한 100 % 미만, 또는 발열 상태 `serious` / `critical`. 절전 모드에서는:

| 위치 | 일반 | 절전 |
|---|---|---|
| 숨긴 세션 출력 배치 (main) | 200 ms | 1000 ms |
| 활동 체크 (조용함/바쁨 판단, main) | 1초 | 2초 |
| 커서 깜빡임 | 켬 | 끔 |
| 반복 애니메이션 (작업 중 pulse, 대기 halo) | 켬 | 끔 (한 번 튀는 pop은 유지) |
| 변경 패널 / 계정 상태 폴링 | 5초 | 15초 |
| "12분째 대기" 갱신 | 15초 | 45초 |

화면에 보이는 출력은 여전히 매 프레임(16 ms) 보내고, Ctrl-C 경로는 그대로입니다.

## 결과 (2026-11-19)

MacBook Pro, Apple silicon, macOS 27.2, 전원 연결. `npm run perf`, 셸 15개, 화면 2개. 스트리밍은 모든 세션에서
초당 약 50줄을 찍는 루프(스트리밍 중인 에이전트와 비슷)입니다.

| | 일반 | 절전 | |
|---|---|---|---|
| Idle: CPU | 0.1 % | 0.0 % | |
| Idle: wakeups/s (전체 프로세스) | 204 | 182 | −11 % |
| 스트리밍: CPU | 2.8 % | **0.9 %** | −68 % |
| 스트리밍: wakeups/s | 535 | 422 | −21 % |
| 스트리밍: `session:data` 메시지/s | 131 | 83 | −37 % |
| 스트리밍: fps / 최장 프레임 간격 | 120 / 9 ms | 120 / 9 ms | |
| `yes` 폭주: CPU | 8.6 % | 8.1 % | |
| `yes` → Ctrl-C 응답 | 17 ms | 18 ms | |

각 1회 측정입니다. 실행마다 CPU ±0.5 % 정도 오차가 있습니다.

### 아직 못 잰 것

- **실제 Claude 세션 5개(1개 스트리밍)로 Aquila vs Terminal.app / Ghostty / iTerm2.** 측정한 Mac에 Ghostty와 iTerm2가
  없고, 실제 Claude 세션은 사람이 돌려야 합니다. 각 앱을 같은 상태로 띄워 두고 `scripts/measure-energy.sh`를 실행하세요.
- 이 환경에서 `top`의 IDLEW 열은 Electron 프로세스에 대해 0으로 나옵니다(권한 제한으로 보임). 그래서 스크립트의
  wakeups 열은 `POWERMETRICS=1`일 때만 의미가 있고, Aquila 자체 wakeups는 `npm run perf`로 보세요.
- 절전 모드는 `AQUILA_POWER_SAVER=1`로 강제로 켜서 쟀습니다. 전원을 뽑을 때 바뀌는 동작은 단위 테스트로 확인했고,
  측정 중에 실제로 케이블을 뽑아 보지는 않았습니다.
