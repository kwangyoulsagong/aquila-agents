import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hookSettings,
  portListening,
  pruneStaleHookSettings,
  removeClaudeHookSettings,
  writeClaudeHookSettings,
  parseClaudeVersion,
  promptTitle,
  readHookBody,
  SESSION_HEADER,
  startHookServer,
  supportsHttpHooks,
} from './hooks';
import type { HookSignal } from './status/tracker';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('startHookServer', () => {
  it('reads the event JSON for the tab in the session header, and answers with no body', async () => {
    const got: string[] = [];
    const port = await startHookServer((tab, h: HookSignal & { sessionId?: string }) =>
      got.push(`${tab}:${h.event}:${h.sessionId ?? h.notificationType ?? h.error ?? ''}`),
    );
    const post = async (
      body: string,
      headers: Record<string, string> = { [SESSION_HEADER]: 'ab12cd34' },
      url = '/hook',
    ) => {
      const r = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', body, headers });
      return [r.status, await r.text()];
    };

    expect(
      await post(JSON.stringify({ hook_event_name: 'SessionStart', session_id: ID, source: 'clear' })),
    ).toEqual([204, '']);
    expect(
      await post(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} })),
    ).toEqual([204, '']);
    expect(await post(JSON.stringify({ hook_event_name: 'StopFailure', error: 'rate_limit' }))).toEqual([
      204,
      '',
    ]);
    expect(await post(JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'not-a-uuid' }))).toEqual(
      [204, ''],
    );
    expect(await post('{broken')).toEqual([204, '']);
    expect((await post('{}', {}))[0]).toBe(404);
    expect((await post('{}', { [SESSION_HEADER]: '../x' }))[0]).toBe(404);
    expect((await post('{}', undefined, '/nope'))[0]).toBe(404);

    // Let the handlers after `end` run.
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual([
      `ab12cd34:SessionStart:${ID}`,
      'ab12cd34:PermissionRequest:',
      'ab12cd34:StopFailure:rate_limit',
      'ab12cd34:SessionStart:',
    ]);
  });
});

describe('promptTitle', () => {
  it('takes the first line of a prompt, cut for a tab title', () => {
    expect(promptTitle('  Fix the login bug\nwith details')).toBe('Fix the login bug');
    expect(promptTitle('a'.repeat(60))).toBe(`${'a'.repeat(39)}…`);
  });
  it('ignores slash commands and empty prompts', () => {
    expect(promptTitle('/clear')).toBe('');
    expect(promptTitle('   ')).toBe('');
    expect(promptTitle(undefined)).toBe('');
  });
});

describe('readHookBody', () => {
  it('reads the prompt from the body Claude 2.1.329 posts (T43)', () => {
    const body = {
      session_id: ID,
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp/work',
      permission_mode: 'default',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Reply with just OK. (Aquila T43 hook check)',
      prompt_id: 'a1',
    };
    const hook = readHookBody(JSON.stringify(body));
    expect(hook).toMatchObject({ event: 'UserPromptSubmit', sessionId: ID });
    expect(hook?.prompt).toBe('Reply with just OK. (Aquila T43 hook ch…');
    expect(hook?.prompt).toHaveLength(40);
  });
  it('gives UserPromptSubmit the prompt title (T43)', () => {
    expect(
      readHookBody(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'Add dark mode' })),
    ).toEqual({ event: 'UserPromptSubmit', prompt: 'Add dark mode' });
    expect(
      readHookBody(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '/model' }))?.prompt,
    ).toBe(undefined);
  });
  it('still finds the event name in a body cut at the size cap', () => {
    expect(readHookBody('{"hook_event_name": "PostToolUse", "tool_input": {"content": "aaa')).toEqual({
      event: 'PostToolUse',
    });
  });
  it('picks the notification type and session end reason', () => {
    expect(
      readHookBody(JSON.stringify({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }))
        ?.notificationType,
    ).toBe('idle_prompt');
    expect(readHookBody(JSON.stringify({ hook_event_name: 'SessionEnd', reason: 'clear' }))?.reason).toBe(
      'clear',
    );
    expect(readHookBody('[]')).toBeNull();
  });
  it('gives the notification context: tool summary, last answer, notification message', () => {
    const detail = (body: Record<string, unknown>) => readHookBody(JSON.stringify(body))?.detail;
    expect(
      detail({
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'npm install' },
      }),
    ).toBe('Bash: npm install');
    expect(
      detail({ hook_event_name: 'Stop', last_assistant_message: '\nAll 118 tests pass.\n\nDetails…' }),
    ).toBe('All 118 tests pass.');
    expect(detail({ hook_event_name: 'Notification', message: 'Claude needs your permission' })).toBe(
      'Claude needs your permission',
    );
    expect(detail({ hook_event_name: 'Stop' })).toBeUndefined();
    expect(
      detail({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }),
    ).toBeUndefined();
  });
});

describe('hookSettings', () => {
  it('listens to the status events, never idle_prompt notifications', () => {
    const { hooks } = hookSettings({ type: 'http' });
    expect(Object.keys(hooks)).toEqual(
      expect.arrayContaining([
        'PermissionRequest',
        'PermissionDenied',
        'StopFailure',
        'SubagentStart',
        'SubagentStop',
        'SessionEnd',
      ]),
    );
    const type = (event: string) => (hooks[event][0] as { hooks: { type: string }[] }).hooks[0].type;
    expect(type('Stop')).toBe('http');
    expect(type('SessionStart')).toBe('command'); // Claude skips http hooks for SessionStart
    const matcher = (hooks.Notification[0] as { matcher: string }).matcher;
    expect(matcher).toBe('permission_prompt|elicitation_dialog');
    expect(matcher).not.toContain('idle_prompt');
  });
});

describe('Claude version', () => {
  it('uses http hooks from 2.1.295', () => {
    expect(parseClaudeVersion('2.1.328 (Claude Code)')).toEqual([2, 1, 328]);
    expect(supportsHttpHooks([2, 1, 295])).toBe(true);
    expect(supportsHttpHooks([2, 1, 294])).toBe(false);
    expect(supportsHttpHooks([2, 0, 999])).toBe(false);
    expect(supportsHttpHooks([3, 0, 0])).toBe(true);
    expect(supportsHttpHooks(null)).toBe(true);
  });
});

describe('per-instance hook settings', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-hooks-'));
  const url = (file: string) => {
    const h = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      hooks: { Stop: { hooks: { url?: string }[] }[] };
    };
    return h.hooks.Stop[0].hooks[0].url;
  };

  it('two instances write their own http files, so one never repoints the other', () => {
    const dir = tmp();
    const a = writeClaudeHookSettings(1111, dir);
    const b = writeClaudeHookSettings(2222, dir);
    expect(a.http).not.toBe(b.http);
    expect(a.httpStatus).not.toBe(b.httpStatus);
    expect(url(a.http)).toBe('http://127.0.0.1:1111/hook');
    expect(url(b.http)).toBe('http://127.0.0.1:2222/hook');
    expect(a.legacy).toBe(b.legacy);
    removeClaudeHookSettings(a);
    expect(fs.existsSync(a.http)).toBe(false);
    expect(fs.existsSync(a.httpStatus)).toBe(false);
    expect(fs.existsSync(b.http)).toBe(true);
    expect(fs.existsSync(a.legacy)).toBe(true);
  });

  it('prunes the pairs of ports nobody listens on, keeps its own, live ones and the old shared file', async () => {
    const dir = tmp();
    writeClaudeHookSettings(1111, dir);
    writeClaudeHookSettings(2222, dir);
    writeClaudeHookSettings(3333, dir);
    fs.writeFileSync(path.join(dir, 'claude-hooks.json'), '{}');
    const removed = await pruneStaleHookSettings(1111, dir, async (port) => port === 2222);
    expect(removed.sort()).toEqual(['claude-hooks-status.3333.json', 'claude-hooks.3333.json']);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'claude-hooks-legacy-status.json',
      'claude-hooks-legacy.json',
      'claude-hooks-status.1111.json',
      'claude-hooks-status.2222.json',
      'claude-hooks.1111.json',
      'claude-hooks.2222.json',
      'claude-hooks.json',
    ]);
  });

  it('portListening tells a live port from a closed one', async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    expect(await portListening(port)).toBe(true);
    await new Promise<void>((r) => server.close(() => r()));
    expect(await portListening(port)).toBe(false);
  });
});
