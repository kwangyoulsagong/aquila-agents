// Shared argv pieces for the hidden `claude -p` runs (brief, graph extraction, Make with Claude, news summary,
// apply analysis). These read untrusted text (pasted mail, PDFs, articles, notes), so a prompt injection must have
// nothing to call: built-in tools are switched off (or narrowed to read-only ones) and only MCP servers we pass
// explicitly load — never the user's own servers, whatever their account's allow rules say.

/** No built-in tools and no MCP servers at all (`--strict-mcp-config` with no `--mcp-config`). */
export const NO_TOOLS: readonly string[] = ['--tools', '', '--strict-mcp-config'];

/** Only the read-only file tools (no Bash, Edit, Write, WebFetch…) and no MCP servers. */
export const READ_ONLY_TOOLS: readonly string[] = ['--tools', 'Read,Glob,Grep', '--strict-mcp-config'];
