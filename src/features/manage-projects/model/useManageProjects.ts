import { useCallback, useState, type DragEvent, type MouseEvent } from 'react';
import {
  api,
  type Config,
  type Group,
  type Project,
  type ProjectEdit,
  type ProjectSettings,
  type Session,
} from '@/shared/api';
import { accountLabel, groupLabel, useT } from '@/shared/i18n';
import { draggedProject, dropPos, dropTarget, endProjectDrag, startProjectDrag, type DropPos } from './drag';

export type ManageDialog =
  | { kind: 'add'; path: string }
  | { kind: 'renameProject'; project: Project }
  | { kind: 'settings'; project: Project }
  | { kind: 'removeProject'; project: Project; sessions: number }
  /** `projectId`: move that project into the new group (from its "Group" menu). */
  | { kind: 'newGroup'; projectId?: string }
  | { kind: 'renameGroup'; group: Group };

interface Options {
  /** null until the config is loaded (the hook runs before the page can render). */
  config: Config | null;
  sessions: Session[];
  onChanged: (config: Config) => void;
  onAdded: (projectId: string) => void;
  /** After the project is gone from the config: close its sessions, pick another project. */
  onRemoved: (projectId: string, config: Config) => void;
  onError: (message: string) => void;
}

type Drop = { id: string; pos: DropPos } | { group: string } | null;

export type ManageProjects = ReturnType<typeof useManageProjects>;

/** Sidebar project management: "+" (folder picker), right-click menus, settings, dialogs, drag to reorder. */
const NO_CONFIG: Config = { language: 'ko', accounts: {}, groups: [], projects: [] };

export function useManageProjects({
  config: loaded,
  sessions,
  onChanged,
  onAdded,
  onRemoved,
  onError,
}: Options) {
  const t = useT();
  const config = loaded ?? NO_CONFIG;
  const [dialog, setDialog] = useState<ManageDialog | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);

  const edit = useCallback(
    async (e: ProjectEdit) => {
      const next = await api.editProjects(e);
      onChanged(next);
      return next;
    },
    [onChanged],
  );
  /** Menu and drag edits have no dialog to show an error in. */
  const tryEdit = (e: ProjectEdit) => edit(e).catch((err: unknown) => onError((err as Error).message));

  const addProject = async () => {
    try {
      const path = await api.pickFolder();
      if (path) setDialog({ kind: 'add', path });
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const openIn = (project: Project) =>
    api.openProjectIn(project.id).catch((err: unknown) => onError((err as Error).message));

  const projectMenu = async (project: Project, e: MouseEvent) => {
    e.preventDefault();
    const choice = await api.showContextMenu([
      { id: 'settings', label: t('settings.action') },
      { id: 'open-in', label: t('settings.openInAction', { app: project.openIn || 'Finder' }) },
      { separator: true },
      { id: 'rename', label: t('action.rename') },
      {
        label: t('projects.group'),
        submenu: [
          ...config.groups.map((g) => ({
            id: `group:${g.id}`,
            label: groupLabel(t, g),
            checked: g.id === project.group,
          })),
          { separator: true },
          { id: 'new-group', label: t('groups.new') },
        ],
      },
      {
        label: t('account.title'),
        submenu: Object.entries(config.accounts).map(([id, a]) => ({
          id: `account:${id}`,
          label: accountLabel(t, id, a),
          checked: id === project.account,
        })),
      },
      { separator: true },
      { id: 'remove', label: t('projects.remove') },
    ]);
    if (!choice) return;
    if (choice === 'rename') setDialog({ kind: 'renameProject', project });
    else if (choice === 'settings') setDialog({ kind: 'settings', project });
    else if (choice === 'open-in') void openIn(project);
    else if (choice === 'new-group') setDialog({ kind: 'newGroup', projectId: project.id });
    else if (choice === 'remove')
      setDialog({
        kind: 'removeProject',
        project,
        sessions: sessions.filter((s) => s.projectId === project.id).length,
      });
    else if (choice.startsWith('group:')) {
      const group = choice.slice('group:'.length);
      if (group !== project.group) tryEdit({ op: 'moveProject', id: project.id, group, index: Infinity });
    } else if (choice.startsWith('account:'))
      tryEdit({ op: 'updateProject', id: project.id, account: choice.slice('account:'.length) });
  };

  const groupMenu = async (group: Group, e: MouseEvent) => {
    e.preventDefault();
    const index = config.groups.findIndex((g) => g.id === group.id);
    const empty = !config.projects.some((p) => p.group === group.id);
    const choice = await api.showContextMenu([
      { id: 'rename', label: t('action.rename') },
      { id: 'up', label: t('groups.moveUp'), enabled: index > 0 },
      { id: 'down', label: t('groups.moveDown'), enabled: index < config.groups.length - 1 },
      { separator: true },
      { id: 'new', label: t('groups.new') },
      { id: 'remove', label: t('groups.remove'), enabled: empty },
    ]);
    if (choice === 'rename') setDialog({ kind: 'renameGroup', group });
    else if (choice === 'new') setDialog({ kind: 'newGroup' });
    else if (choice === 'up') tryEdit({ op: 'moveGroup', id: group.id, index: index - 1 });
    else if (choice === 'down') tryEdit({ op: 'moveGroup', id: group.id, index: index + 1 });
    else if (choice === 'remove') tryEdit({ op: 'removeGroup', id: group.id });
  };

  // ── Dialog submits (errors are shown in the dialog) ──
  const submitAdd = async (values: { name: string; group: string; account: string }) => {
    if (dialog?.kind !== 'add') return;
    const next = await edit({ op: 'addProject', path: dialog.path, ...values });
    const added = next.projects.find((p) => !config.projects.some((old) => old.id === p.id));
    setDialog(null);
    if (added) onAdded(added.id);
  };

  const submitName = async (name: string) => {
    if (!dialog) return;
    if (dialog.kind === 'renameProject') await edit({ op: 'updateProject', id: dialog.project.id, name });
    if (dialog.kind === 'renameGroup') await edit({ op: 'renameGroup', id: dialog.group.id, label: name });
    if (dialog.kind === 'newGroup') {
      const next = await edit({ op: 'addGroup', label: name });
      const group = next.groups.find((g) => !config.groups.some((old) => old.id === g.id));
      if (group && dialog.projectId)
        await edit({ op: 'moveProject', id: dialog.projectId, group: group.id, index: Infinity });
    }
    setDialog(null);
  };

  const submitSettings = async (settings: ProjectSettings) => {
    if (dialog?.kind !== 'settings') return;
    await edit({ op: 'updateProject', id: dialog.project.id, ...settings });
    setDialog(null);
  };

  const submitRemove = async () => {
    if (dialog?.kind !== 'removeProject') return;
    const next = await edit({ op: 'removeProject', id: dialog.project.id });
    setDialog(null);
    onRemoved(dialog.project.id, next);
  };

  // ── Drag to reorder ──
  const endDrag = () => {
    endProjectDrag();
    setDraggingId(null);
    setDrop(null);
  };

  const rowDrag = (project: Project) => ({
    draggable: true,
    'data-dragging': draggingId === project.id || undefined,
    'data-drop': drop && 'id' in drop && drop.id === project.id ? drop.pos : undefined,
    onDragStart: (e: DragEvent) => {
      startProjectDrag(e, project.id);
      setDraggingId(project.id);
    },
    onDragEnd: endDrag,
    onDragOver: (e: DragEvent) => {
      const dragged = draggedProject(e);
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      if (dragged === project.id) return setDrop(null);
      const pos = dropPos(e.clientY, e.currentTarget.getBoundingClientRect());
      setDrop((d) => (d && 'id' in d && d.id === project.id && d.pos === pos ? d : { id: project.id, pos }));
    },
    onDrop: (e: DragEvent) => {
      const dragged = draggedProject(e);
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = dropPos(e.clientY, e.currentTarget.getBoundingClientRect());
      const target = dropTarget(config.projects, dragged, project.id, pos);
      endDrag();
      if (target) tryEdit({ op: 'moveProject', id: dragged, ...target });
    },
  });

  /** Dropping on a group's label or empty line puts the project last in that group. */
  const groupDrop = (group: Group) => ({
    'data-drop': (drop && 'group' in drop && drop.group === group.id) || undefined,
    onDragOver: (e: DragEvent) => {
      if (!draggedProject(e)) return;
      e.preventDefault();
      setDrop((d) => (d && 'group' in d && d.group === group.id ? d : { group: group.id }));
    },
    onDrop: (e: DragEvent) => {
      const dragged = draggedProject(e);
      if (!dragged) return;
      e.preventDefault();
      endDrag();
      tryEdit({ op: 'moveProject', id: dragged, group: group.id, index: Infinity });
    },
  });

  return {
    dialog,
    closeDialog: () => setDialog(null),
    addProject,
    openSettings: (project: Project) => setDialog({ kind: 'settings', project }),
    openIn,
    projectMenu,
    groupMenu,
    submitAdd,
    submitName,
    submitSettings,
    submitRemove,
    rowDrag,
    groupDrop,
  };
}
