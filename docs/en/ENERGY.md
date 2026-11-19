# Energy

> 한국어: [../ko/ENERGY.md](../ko/ENERGY.md)

Numbers, not guesses (T9). Two tools:

- **`npm run perf`** — inside the app: 15 shell sessions (2 on screen, 13 hidden), idle / streaming agent-like output /
  `yes` flood. Prints CPU % per process type, idle wakeups/s (`app.getAppMetrics`), IPC messages/s, fps and the
  `yes` → Ctrl-C response time. Add `AQUILA_POWER_SAVER=1` to force the power-saver profile.
- **`scripts/measure-energy.sh [app …]`** — outside the app: `top -stats pid,cpu,idlew,power` summed over each app's own
  processes (Aquila Agents, Terminal, Ghostty, iTerm2 — whichever run). `POWERMETRICS=1` also runs
  `sudo powermetrics --samplers tasks` for per-task wakeups and energy.

## Power profile

`electron/power.ts` watches `powerMonitor` (`on-battery` / `on-ac`, `speed-limit-change`, `thermal-state-change`).
**Saver** = on battery, CPU speed limit below 100 %, or thermal state `serious` / `critical`. In saver mode:

| Where | Normal | Saver |
|---|---|---|
| Hidden session output batch (main) | 200 ms | 1000 ms |
| Activity tick (quiet/busy detection, main) | 1 s | 2 s |
| Cursor blink | on | off |
| Looping animations (working pulse, waiting halo) | on | off (one-shot pop stays) |
| Changes panel / account status polling | 5 s | 15 s |
| "Waiting for 12 min" refresh | 15 s | 45 s |

On-screen output still flushes every frame (16 ms) and the Ctrl-C path is unchanged.

## Results (2026-11-19)

MacBook Pro, Apple silicon, macOS 27.2, on AC. `npm run perf`, 15 shells, 2 on screen; the streaming case runs a
~50 lines/s loop in every session (roughly a streaming agent).

| | Normal | Saver | |
|---|---|---|---|
| Idle: CPU | 0.1 % | 0.0 % | |
| Idle: wakeups/s (all processes) | 204 | 182 | −11 % |
| Streaming: CPU | 2.8 % | **0.9 %** | −68 % |
| Streaming: wakeups/s | 535 | 422 | −21 % |
| Streaming: `session:data` msgs/s | 131 | 83 | −37 % |
| Streaming: fps / longest frame gap | 120 / 9 ms | 120 / 9 ms | |
| `yes` flood: CPU | 8.6 % | 8.1 % | |
| `yes` → Ctrl-C answered | 17 ms | 18 ms | |

Single runs; expect ±0.5 % CPU noise between runs.

### Not measured yet

- **Aquila vs Terminal.app / Ghostty / iTerm2 with 5 real Claude sessions (1 streaming).** Ghostty and iTerm2 aren't
  installed on the measuring Mac, and real Claude sessions need a person driving them. Set each app up the same way
  and run `scripts/measure-energy.sh` with all of them open.
- `top`'s IDLEW column reads 0 for Electron's processes here (probably a permission limit), so the script's wakeups
  column is only meaningful with `POWERMETRICS=1`; use `npm run perf` for Aquila's own wakeups.
- Saver mode was forced with `AQUILA_POWER_SAVER=1`; the switch on unplugging was covered by unit tests, not by
  pulling the cable during a run.
