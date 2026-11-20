import { describe, expect, it } from 'vitest';
import {
  hookSettings,
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
