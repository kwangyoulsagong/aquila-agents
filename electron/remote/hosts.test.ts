import { describe, expect, it } from 'vitest';
import { parseHosts } from './hosts';

describe('parseHosts', () => {
  it('lists concrete Host names, skipping wildcards and comments, following simple Includes', () => {
    const config = [
      '# work',
      'Host devbox gpu-1  # trailing',
      '  HostName 10.0.0.2',
      'Host *.internal !bad',
      'host=staging',
      'Include extra.conf',
      'Include conf.d/*',
      'Host devbox',
    ].join('\n');
    const read = (f: string) => (f === 'extra.conf' ? 'Host from-include\n' : null);
    expect(parseHosts(config, read)).toEqual(['devbox', 'gpu-1', 'staging', 'from-include']);
  });

  it('stops recursive includes', () => {
    expect(parseHosts('Include self\nHost a', () => 'Include self\nHost a')).toEqual(['a']);
  });
});
