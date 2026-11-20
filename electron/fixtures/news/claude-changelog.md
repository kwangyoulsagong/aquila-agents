# Changelog


## 2.1.329

- Added a trust dialog warning that says where a folder's hooks are declared
- Added a warning in the conversation, in Claude Desktop and other non-interactive hosts, when hooks in managed settings fail to load
- Added this session's scheduled tasks, `/loop` wakeups, the goal and this conversation's forks to `/tasks`; x stops one after asking
- Added a "Server message" row to a server's page in `/mcp` that shows the JSON-RPC error message of a remote HTTP MCP server that refuses the connection
- Added a "Marketplace auto-update" row to `/status` that names managed marketplaces that get no automatic updates, and why
- Added support for turning on Code Mode while OpenTelemetry events and metrics are enabled; each tool call the code makes sends its events; tracing still keeps it off
- Fixed `~/.claude.json` sometimes being reset to defaults when a network stall or file lock made it unreadable and cleared during a save
- Fixed repeated sign-outs on macOS when Claude Code could read the Keychain but not save to it. That session now stops at expiry and says why, and other sessions stay signed in

## 2.1.328

- Added auto mode for Claude Opus 4.6 and Sonnet 4.6 on Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry and Claude apps gateway; interactive sessions with no permission mode start in it
- Added `"onFailure": "block"` for `mcp_tool` hooks, as for command and HTTP hooks: a hook whose call fails blocks the action
- Added a warning when a message from a session that skips permission prompts may be held and dropped by a cloud session
- Added a notice in `/status` and `claude doctor` when an OpenTelemetry exporter has no endpoint and its data would likely be lost
- Added `CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME`, which lets a host stop `claude -p --resume` and `--continue` from running a tool call that a hook deferred
- Added support for apps that embed Claude Code to switch on the policy plugin's `allowManagedModsOnly` option; an admin's managed settings still win
- Added a startup warning to the Claude apps gateway when a policy's `maxEffortLevel` is not a valid effort level
- Self-hosted runner: Added `--repository-folder` to name the folder that sessions use for a repository at `--capacity 1`, in place of its path under the base folder, which can't be a symbolic link

## 2.1.327

- Added a confirmation before `/install-github-app` changes a repository
- Added `claude mcp add-json <name> -` to read the server's JSON from stdin, so tokens can stay off the command line; not available inside a Claude Code session
- Added a line when a resumed session's earlier messages can't be loaded
- Added a list in `/status` of broken agent, skill, command and output style files, keybinding errors, an unavailable sandbox, ignored permission settings and hook matchers that never match
- Added a note in `/config` when other settings override a row
- Added `x-claude-code-managed-settings-checksum` to the gateway hint headers; sent where managed settings set `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, including where they already do
- Added support for naming a session's billing group with the `attributionProject` setting, for Claude apps gateways that set `admin.billing_group_tag`
- Added `/tui classic` as the name for the non-fullscreen renderer; `/tui default` still works
