import { describe, expect, it } from 'vitest';
import type { Project } from '@/shared/api';
import { editorOptions, parsePort, toForm, toSettings } from './settings';

const project: Project = { id: 'a', name: 'A', group: 'work', account: 'shared', path: '~/a' };

describe('project settings form', () => {
  it('round-trips a project with no settings to defaults that clear', () => {
    const form = toForm(project);
    expect(form).toMatchObject({ defaultAgent: 'claude', portBase: '', openIn: '' });
    expect(toSettings(form, project)).toEqual({
      name: 'A',
      group: 'work',
      account: 'shared',
      defaultAgent: 'claude',
      defaultBranch: '',
      setupScript: '',
      portBase: null,
      openIn: '',
      figma: false,
    });
  });

  it('sends Figma on/off for local projects only', () => {
    expect(toForm({ ...project, figma: true }).figma).toBe(true);
    expect(toSettings({ ...toForm(project), figma: true }, project)).toMatchObject({ figma: true });
    const remote: Project = { ...project, remote: { alias: 'devbox' } };
    expect(toSettings({ ...toForm(remote), figma: true }, remote)).not.toHaveProperty('figma');
  });

  it('sends the path only when it changed', () => {
    const form = { ...toForm(project), path: '/Users/me/b', portBase: '3000' };
    expect(toSettings(form, project)).toMatchObject({ path: '/Users/me/b', portBase: 3000 });
  });

  it('a remote project sends its host and the typed path', () => {
    const remote: Project = { ...project, path: '~/api', remote: { alias: 'devbox' } };
    const form = { ...toForm(remote), path: '~/api2', remoteAlias: ' gpu ', remoteClaudeDir: '~/.claude-w ' };
    expect(toForm(remote)).toMatchObject({ remoteAlias: 'devbox', remoteClaudeDir: '' });
    expect(toSettings(form, remote)).toMatchObject({
      path: '~/api2',
      remote: { alias: 'gpu', claudeConfigDir: '~/.claude-w' },
    });
    expect(toSettings(toForm(project), project)).not.toHaveProperty('remote');
  });

  it('parses ports: blank, valid, out of range, not a number', () => {
    expect(parsePort(' ')).toBeUndefined();
    expect(parsePort('3000')).toBe(3000);
    expect(parsePort('80')).toBeNull();
    expect(parsePort('70000')).toBeNull();
    expect(parsePort('30a0')).toBeNull();
  });

  it("keeps a project's own editor in the list", () => {
    expect(editorOptions('Nova')).toContain('Nova');
    expect(editorOptions('Cursor').filter((e) => e === 'Cursor')).toHaveLength(1);
  });
});
