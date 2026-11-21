# AI/ML engineers and AI coding agents / ADEs: friction and comfort (2025–2026)

Scope: people building LLM apps, agents, RAG, evals and fine-tunes, plus ML researchers, using Claude Code, Codex, Cursor, notebook agents, remote GPU boxes, tmux/cmux, and eval/trace tools. Research date: 2026-11-21.
Source quality: most of the evidence is GitHub issues, vendor/tool docs, the Cursor forum and practitioner blogs. I fetched few Reddit or HN threads directly, so verbatim Reddit quotes are scarce (see Gaps). Items marked "(search summary)" come from search-result snippets I did not open.

## 1. What breaks for AI engineers specifically (long-running jobs, GPU over SSH, notebooks, logs/metrics, cost, keys/accounts)

### Takeaway

The biggest AI-engineer-specific failures are: (a) agents kill or lose track of long-running processes such as training, eval and worker jobs; (b) agents over Remote SSH on HPC/GPU nodes are fragile; (c) notebook agents can't see kernel state, and `.ipynb` JSON wastes context; (d) agents "have no eyes" for metric dashboards, so they repeat runs and chase noise. Everyone falls back on tmux plus logs written to files.

### Cited Findings

**Long-running jobs next to agents**

- Claude Code issue #25188 (Feb 12, 2026), verbatim: "When Claude Code starts a long-running process via the Bash tool with `nohup ... &`, it gets tracked as a background task. When the session ends, compacts, or runs out of context, **all tracked background tasks are automatically SIGTERM'd**". Also: "The only workaround is to never start long-running processes through Claude Code at all, which defeats the purpose of having a shell." And: "Hours later, when the conversation context fills up and compacts, session cleanup kills all three — taking down my entire system silently." The proposed fixes were a `persistent: true` flag, a process allowlist, not killing on compaction, and `detach: true`. It was closed as a duplicate of #22882 (dupes #14802, #21700), which suggests the request recurs. — [GitHub #25188](https://github.com/anthropics/claude-code/issues/25188)
- A common ML pattern: run training in one terminal, run Claude Code in another to read the log files, and manage both with tmux. — [lzwjava blog](https://lzwjava.github.io/separate-terminals-for-training-and-analysis-en)
- Anthropic's own long-running-tasks guide includes a SLURM batch script that launches Claude Code inside tmux on a GPU partition with a multi-hour limit (search summary). — [Anthropic: long-running tasks](https://www.anthropic.com/research/long-running-tasks)
- W&B's ML course: "whenever you launch computations on a remote machine, you don't want them to be interrupted by ssh connections or internet disconnects" (search summary). — [W&B TMUX for ML Practitioners](https://wandb.ai/wandb_course/extras/reports/TMUX-Basic-Usage-for-ML-Practitioners--VmlldzoyMjgyMDIx)
- Claude Code now has "agent view" background sessions: "Each background session is a full Claude Code conversation that keeps running without a terminal attached." — [Claude Code docs: agent view](https://code.claude.com/docs/en/agent-view)
- Sionic AI comment on agent crashes during long sessions: "When mine crashes it leaves it running due to my config" (Raine3141, Dec 10, 2025). — [HF blog: Sionic AI](https://huggingface.co/blog/sionic-ai/claude-code-skills-training)
- Queue and preemption: in Lambda's experiment, jobs on a shared queue were preempted, and "the experiment was canceled and requeued for later". Also: "The agent only costs money while it's reasoning, not while it waits for a game to finish." (David Hartmann, June 25, 2026) — [Lambda blog](https://lambda.com/blog/what-happens-when-claude-code-gets-an-experiment-tracker)

**GPU / HPC over SSH**

- Cursor forum, Oct 8, 2026: "After the cursor_agent_host rollout, Agent over Remote SSH became unusable/extremely slow on my HPC compute node." Error: "Timed out waiting for the agent host bridge to register". Staff reply: "on newer versions, Agent runs inside Cursor server on the remote machine, not in the local app". The user asked to restore the local-client path, and there was no fix timeline. — [Cursor forum #174073](https://forum.cursor.com/t/remote-ssh-agent-unusable-on-ceph-hpc-after-cursor-agent-host-hung-planning-agent-host-bridge-unavailable-was-fast-before/174073)
- Other Cursor forum reports (search summary): Agent times out with `deadline_exceeded` over SSH while edit, terminal and navigation work; "agent execution provider did not respond in time"; the remote extension host crashes out-of-memory on the Minerva HPC; one user's agent failed because the _remote_ server sat in a region Cursor doesn't serve, and they asked whether model calls could stay local while only files and exec run remote. — [timeout](https://forum.cursor.com/t/agent-execution-timed-out-on-remote-ssh-everything-else-works-fine/154891), [provider](https://forum.cursor.com/t/remote-ssh-agent-fails-agent-execution-provider-did-not-respond-in-time-remote-extension-host-never-activates-the-agent-executor/162771), [Minerva OOM](https://forum.cursor.com/t/remote-ssh-extension-host-crashes-on-minerva-hpc-out-of-memory-failed-to-spawn-thread/155674), [HPC timeout](https://forum.cursor.com/t/remote-ssh-agent-always-times-out-on-hpc-cluster-error-extension-host-timeout-provider-registration-timeout-in-cursor-3-16-29/168959)
- A Claude Code feature request asks for native persistent remote sessions using local tmux plus SSH (open proposal, search summary). — [GitHub #13613](https://github.com/anthropics/claude-code/issues/13613)
- cmux SSH (Mar 30, 2026) markets "uses your ~/.ssh/config, reconnects on drops" for running Claude Code on remote boxes (vendor claim). — [cmux blog](https://cmux.com/blog/cmux-ssh)
- Claude Science docs: connects to a GPU workstation or HPC cluster through the existing `~/.ssh/config` and key/ssh-agent, and "installs nothing on the host itself" (search summary). — [Claude Science: remote compute](https://claude.com/docs/claude-science/remote-compute-clusters.md)
- Mantra's author (vendor): "most of my actual work happens on remote machines, including GPU instances for fine-tuning". They built session replay because it was hard to see what remote Claude did. — [DEV: Mantra](https://dev.to/gonewx/running-claude-code-on-a-remote-server-now-you-can-actually-see-what-it-did-357i)

**Notebooks vs terminal agents**

- Patrick Mineault, "Claude Code for Scientists" (2026-01-29), quoted in a synthesis: "Plots embedded as base64 in JSON consume large context chunks." and "Claude is unaware of kernel state." — [projio synthesis](https://arashshahidi1997.github.io/projio/log/idea/idea-arash-20260410-131500-100001/) (original: neuroai.science/claude-code-for-scientists, not fetched)
- Marimo: agents work best "operating on plain `.py` files rather than fighting JSON structure"; it offers a scratchpad for inspecting in-memory state. — [marimo: notebooks as a tool for agents](https://marimo.io/blog/notebooks-as-a-tool-for-agents)
- JetBrains (Aug 2026) gave agents a live Jupyter kernel in PyCharm so they don't hand work to a subprocess and lose progress. Vendor benchmark: $59.09 on the kernel vs $67.06 on the shell across 12 ML tasks. — [JetBrains blog](https://blog.jetbrains.com/pycharm/2026/08/we-gave-ai-agents-a-live-jupyter-kernel-in-pycharm/)
- Kernel MCP servers (nteract, jupyter-kernel-mcp) keep variables between agent turns and expose `get_kernel_status`. — [nteract MCP](https://www.mintlify.com/nteract/desktop/guides/mcp-server), [jupyter-kernel-mcp](https://glama.ai/mcp/servers/codewithcheese/jupyter-kernel-mcp)
- VS Code's guide tells users to give the agent notebook context explicitly when a request depends on kernel state or cell output. — [VS Code: notebooks with AI](https://code.visualstudio.com/docs/copilot/guides/notebooks-with-ai)

**Watching logs/metrics; experiment memory**

- Lambda: "What agents can't do is keep track of what they've tried." Without tracking, the agent "re-runs experiments it already ran, or it loses the thread of what worked and why." On noise: "the same configuration scored 7 on one run and 3 on the next" and the agent "would have chased that 7 as if it were progress." On dashboards: "An agent has no eyes. It needs an API." The demo made about 810 API calls with "no dashboard, and no human reading charts". — [Lambda blog](https://lambda.com/blog/what-happens-when-claude-code-gets-an-experiment-tracker)
- Sionic AI (Dec 8, 2025): "Claude could help us train models, but it couldn't help us avoid repeating mistakes." "After a long experiment session, nobody wants to open a doc and summarize what happened." Their fixes: `/advise` before a run, `/retrospective` to turn a session into a skill and open a PR, and a "Failed Attempts" table in each skill. Commenter: "you can retroactively process ~/.claude logs to build retrospectives". — [HF blog](https://huggingface.co/blog/sionic-ai/claude-code-skills-training)
- Langfuse: "Long agent sessions that went wrong are hard to reconstruct from terminal scrollback." — [Langfuse: tracing coding agents](https://langfuse.com/resources/engineering/coding-agent-tracing)

**Payoff that keeps users coming back**

- Dimitris Papailiopoulos (via Simon Willison, Feb 17, 2026): "the distance between a question and a first answer just got very small". He describes Claude Code plus a few days of GPU time as "close to a magic box". — [Simon Willison](https://simonwillison.net/2026/Feb/17/dimitris-papailiopoulos/)
- Autoresearch at scale (search summary): Claude Code with 16 GPUs ran about 910 experiments in 8 hours (SkyPilot). HN skeptics said most gains "would have been found much faster with BO if properly parameterized". — [SkyPilot](https://blog.skypilot.co/scaling-autoresearch/), [HN item 47442435 mirror](https://hn.nuxt.dev/item/47442435)

### Inferences

- For Aquila: a session needs to clearly separate the job from the agent. A "job" pane or tab whose process survives agent compaction and exit (a plain shell or tmux on the remote), with a status dot and notification on exit or when the job prints an error, directly addresses #25188-style pain.
- Remote-first matters: AI engineers run on GPU boxes, so tolerating SSH drops (reattach, tmux-backed remote sessions) and keeping the model client local while exec is remote (the Cursor region and HPC complaints) are advantages of Aquila's approach of embedding the real CLI in a pty over SSH.
- Notifications should key off log events ("loss NaN", "CUDA OOM", "job finished"), not just agent idle, since the long wait is in the job.

### Gaps

- Few verbatim Reddit (r/MachineLearning, r/LocalLLaMA) or HN user quotes found on agents plus training jobs. The searches surfaced mainly forums, issues and blogs.
- No data on how Codex CLI handles long-running background processes in comparison.
- Colab Gemini and Hex agent pain points weren't researched (search budget).
- API-key and multi-provider-key friction (OpenAI, Anthropic, HF tokens, `.env` on remote boxes): I found no good sources.

## 2. How they want to see agent sessions alongside evals, traces, prompts and experiment runs

### Takeaway

The mainstream pattern in 2026 is to bring traces and runs into the agent through MCP or APIs (Langfuse, W&B/Weave), and to send the agent's own sessions out to the trace tool through hooks. I found no evidence of a widely praised side-by-side GUI layout. Humans still prefer a trace review UI, and agents need an API.

### Cited Findings

- Langfuse hooks: Claude Code runs a "Stop hook script (runs after each response)" that ships each session, with token usage per turn and each tool call as an observation. Codex uses plugin hooks (Codex 0.128+). Limits: "Session context files are not captured"; "A developer can disable a hook in their local config". — [Langfuse: tracing coding agents](https://langfuse.com/resources/engineering/coding-agent-tracing)
- Community Langfuse MCP plus agent skill lets Claude Code or Codex "query traces, inspect generations, debug exceptions, analyze sessions". Langfuse also hosts an official MCP endpoint at `/api/public/mcp` (search summary). — [avivsinai/langfuse-mcp](https://github.com/avivsinai/langfuse-mcp), [langfuse-mcp-server PyPI](https://pypi.org/project/langfuse-mcp-server/)
- The W&B MCP server gives coding agents runs, traces, evaluations and artifacts (`query_weave_traces_tool`, `count_weave_traces_tool`). A separate Weave plugin logs every Claude Code turn, tool call and subagent. — [W&B MCP docs](https://docs.wandb.ai/platform/mcp-server), [Weave Claude Code harness](https://docs.wandb.ai/weave/guides/integrations/agents/claude-code-harness)
- Lambda: the tracker exposed as API endpoints "that provide agents with what Weights & Biases provides humans", with a leaderboard, each idea pinned to a git branch, and run history. — [Lambda blog](https://lambda.com/blog/what-happens-when-claude-code-gets-an-experiment-tracker)
- Hamel Husain's evals skills (Mar 2, 2026): "Eval tools often get in the way." `error-discovery` builds a review app, samples traces and groups notes into failure modes. `build-review-interface` supports "human trace review". — [hamel.dev evals-skills](https://hamel.dev/blog/posts/evals-skills/)

### Inferences

- In Aquila, a lightweight link-out beats a full dashboard: detect trace and run URLs (Langfuse, LangSmith, W&B, MLflow) printed in terminal output and surface them as clickable chips in the tab or Changes panel. Or show the current eval run's pass rate next to the session. Making MCP servers for traces easy to enable per project is aligned with what's praised.
- The context-file blind spot in Langfuse ("Session context files are not captured") points to a gap Aquila could fill by showing which CLAUDE.md, AGENTS.md and skills a session loaded.

### Gaps

- I found no user-voiced preference for specific layouts (split panes with an eval dashboard vs tabs). LangSmith, Braintrust and MLflow MCP were not confirmed.

## 3. Agents editing prompts and agent code: reviewing prompt diffs, nondeterminism, verifying with evals

### Takeaway

Practitioners agree that a line diff of a prompt says almost nothing about behavior. The praised pattern is a "semantic diff": run evals on old vs new prompts, post the win rate and changed examples on the PR, and score statistically to handle nondeterminism. Evals are being packaged as agent skills.

### Cited Findings

- "The semantic diff is old_outputs → new_outputs over a corpus you trust, not old_prompt → new_prompt"; "text distance and behavioral distance are almost uncorrelated" (search summary). — [tianpan.co semantic diff](https://tianpan.co/blog/2026-07-05-the-semantic-diff-reviewing-a-prompt-change), [tianpan.co semantic diff prompts](https://tianpan.co/blog/2026-04-23-semantic-diff-prompts-behavioral-impact)
- Recommended: a CI job triggered on `prompts/**` posts pass/fail, a pairwise win rate and the changed inputs as a PR comment, and blocks the merge on regression. Nondeterminism is handled with bootstrap confidence intervals per slice. Keep the model id, sampling settings and tool schemas next to the prompt, because the "real change" can ship elsewhere (search summary). — [tianpan.co prompt diff review discipline](https://tianpan.co/blog/2026-04-16-prompt-diff-review-discipline), [MLflow: Prompt diffing](https://mlflow.org/articles/prompt-diffing/)
- 1Password argues that prompt changes deserve security review (search summary, not fetched). — [1Password blog](https://1password.com/blog/prompt-changes-security-review)
- Hamel Husain and Shreya Shankar: evaluation is part of development, like debugging. Pragmatic Engineer (Dec 2025) describes a team moving past "looks good to me" by reviewing traces (search summary). — [Simon Willison on AI evals FAQ](https://www.simonwillison.net/2025/Jul/3/faqs-about-ai-evals), [Pragmatic Engineer: evals](https://newsletter.pragmaticengineer.com/p/evals)
- Evals skills for coding agents (eval-audit, error-discovery, write-judge-prompt, judge validation against human labels). — [hamel.dev](https://hamel.dev/blog/posts/evals-skills/)
- Mineault's recommendations (via synthesis): plan before coding, write tests first, generate cheap and abundant plots so the agent's output gets checked visually and not only through code review. — [projio synthesis](https://arashshahidi1997.github.io/projio/log/idea/idea-arash-20260410-131500-100001/), [slides](https://slides-dgr.pages.dev/claude-research-best-practices)

### Inferences

- In Aquila's Changes panel, files that look like prompts (`prompts/**`, `*.prompt`, `*.md` under agent dirs, large string literals) could get a prose-friendly word-level diff. A one-click "run evals" action could launch the project's eval command in a sibling shell tab with a status dot. This is the "eval-in-the-loop" pattern, and Aquila would only orchestrate the real CLI.
- Flagging when a diff touches the model id, temperature or tool schemas next to prompts would match the "real change ships elsewhere" warning.

### Gaps

- No first-hand user complaints (Reddit or HN quotes) specifically about reviewing _agent-made_ prompt edits; sources are practitioner essays. No Cursor or Claude Code built-in prompt-diff feature found.

## 4. Multiple model accounts, usage limits, context gauges, model switching

### Takeaway

Heavy users rotate several Claude subscriptions and build or install switchers with per-account 5-hour and weekly gauges. Built-in support is missing and buggy: limits bleed across accounts on one device, and switching can revoke tokens. Context gauges now exist via statusline fields, but users disagree on what "percent" means (raw vs until auto-compact).

### Cited Findings

- Nihal Singh (Apr 18, 2026): "On a real build day, I can torch a 5-hour quota in 20 to 30 minutes if I'm not careful." "When I hit my window and the model downshifts or pauses, that's an intelligence brownout." "The catch: doing this by hand is miserable." "that friction breaks flow hard enough that you stop rotating and just accept the brownout." "The pattern that emerged is a rotation, not a 'primary + backup.'" The tool he wants: "One click swaps the active account under the hood. No browser dance, no re-login ritual." He also built a dashboard of 5-hour and weekly usage per account. He relays a Reddit reply saying Anthropic allows "up to 3 accounts on the same phone number and payment card" (secondhand, unverified). — [nihal111 blog](https://nihal111.github.io/2026/04/18/when-one-claude-subscription-isnt-enough.html)
- Bug: Claude Code shows "weekly limit reached" on account B (4% used) after logging out of account A. Rate limits are applied across Max accounts on the same device (search summary). — [GitHub #12786](https://github.com/anthropics/claude-code/issues/12786), [claudeissues mirror](https://claudeissues.com/issue/12786-rate-limit-incorrectly-applied-when-switching-between-max-accounts-on-same-devic)
- Feature request for built-in multi-account switching (search summary). — [GitHub #41886](https://github.com/anthropics/claude-code/issues/41886), [GitHub #64376](https://github.com/anthropics/claude-code/issues/64376)
- Switchers: claude-swap (rotate before hitting the limit; warns that current Claude Code may revoke the refresh token of the account you leave), clauth (falls back on the 5-hour limit), C2Switcher (tracks 5-hour, 7-day and Opus limits). Alias-based switching affects only new sessions (search summary). — [claude-swap README](https://raw.githubusercontent.com/realiti4/claude-swap/HEAD/README.md), [clauth](https://docs.rs/crate/clauth/0.7.3), [c2switcher](https://github.com/gmh5225/c2switcher), [Medium: two subscriptions](https://medium.com/front-end-weekly/running-two-claude-code-subscriptions-side-by-side-65d1f10a9dd4)
- Context gauge: the statusline JSON now has `context_window.used_percentage` and `remaining_percentage`, which can be null early in a session, and `current_usage` is null before the first call and after `/compact` (search summary). Third-party: ccusage statusline (context percent with color thresholds, cost source choice), cc-statusline (burn rate in $/hour), claude-code-status-line (percent "until auto-compact, not raw context token usage"), ccstatusline ("cost may not update properly when using /resume"). — [Claude Code statusline docs](https://code.claude.com/docs/en/statusline), [GitHub #10557](https://github.com/anthropics/claude-code/issues/10557), [ccusage statusline](https://www.mintlify.com/ryoppippi/ccusage/features/statusline), [cc-statusline](https://www.mintlify.com/chongdashu/cc-statusline), [claude-code-status-line](https://docs.rs/crate/claude-code-status-line/1.0.0), [ccstatusline](https://www.npmjs.com/package/ccstatusline)
- Cost visibility at team level: "coding agents are often a team's biggest LLM expense"; Langfuse breaks down spend by developer, project or model. — [Langfuse](https://langfuse.com/resources/engineering/coding-agent-tracing)

### Inferences

- Aquila's per-account usage gauge (shared and personal) and per-tab context gauge match the most-requested workaround tooling. Worth adding: show both 5-hour and weekly windows; predict "you'll hit the limit in ~N min" from burn rate; show which account each tab is bound to (switches affect only new sessions); label the context gauge clearly (raw vs until auto-compact) and handle null after `/compact`.
- Switching accounts mid-flow is the pain. Making "open this tab on account B" one click without re-login, while respecting the token-revocation caveat, is the high-value move.

### Gaps

- No good sources on Codex/OpenAI usage-limit gauges or on switching between Claude and Codex in one workflow. No sources on API-key (pay-as-you-go) vs subscription mixing for AI engineers who also call provider APIs in their apps.
