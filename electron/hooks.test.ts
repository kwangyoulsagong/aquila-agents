import { describe, expect, it } from 'vitest';
import { startHookServer } from './hooks';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('startHookServer', () => {
  it('reports status hooks and the Claude session id from SessionStart', async () => {
    const statuses: string[] = [];
    const starts: string[] = [];
    const port = await startHookServer(
      (tab, status) => statuses.push(`${tab}:${status}`),
      (tab, id) => starts.push(`${tab}:${id}`),
    );
    const post = (path: string, body?: string) =>
      fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body }).then((r) => r.status);

    expect(await post('/hook/ab12cd34/done')).toBe(204);
    expect(await post('/session/ab12cd34', JSON.stringify({ session_id: ID, source: 'clear' }))).toBe(204);
    expect(await post('/session/ab12cd34', JSON.stringify({ session_id: 'not-a-uuid' }))).toBe(204);
    expect(await post('/session/ab12cd34', '{broken')).toBe(204);
    expect(await post('/nope')).toBe(404);

    expect(statuses).toEqual(['ab12cd34:done']);
    expect(starts).toEqual([`ab12cd34:${ID}`]);
  });
});
