import { describe, expect, it } from 'vitest';
import { externalTarget, isAppPage } from './links';

describe('links from the app window', () => {
  it('only http(s) goes to the browser', () => {
    expect(externalTarget('https://claude.ai/settings')).toBe('https://claude.ai/settings');
    expect(externalTarget('http://localhost:3000/')).toBe('http://localhost:3000/');
    expect(externalTarget('file:///etc/passwd')).toBeNull();
    expect(externalTarget('javascript:alert(1)')).toBeNull();
    expect(externalTarget('about:blank')).toBeNull();
    expect(externalTarget('not a url')).toBeNull();
  });

  it('the app page itself may reload; any other page is not loaded in the window', () => {
    const app = 'file:///Applications/Aquila.app/Contents/Resources/app.asar/dist/index.html';
    expect(isAppPage(`${app}#x`, app)).toBe(true);
    expect(isAppPage('https://example.com/', app)).toBe(false);
    expect(isAppPage('http://localhost:5199/', 'http://localhost:5199/')).toBe(true);
    expect(isAppPage('http://localhost:3000/', 'http://localhost:5199/')).toBe(false);
  });
});
