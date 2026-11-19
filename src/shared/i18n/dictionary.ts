// UI strings in Korean and English. Shared by main (notifications) and renderer.
// Add a key to BOTH languages — the `satisfies` check fails the typecheck if one is missing.
import type { Account, Group, Language, SessionKind } from '../api/types';

const ko = {
  'action.openClaude': 'Claude 열기',
  'action.openCodex': 'Codex 열기',
  'action.openShell': '셸 열기',
  'action.closeSession': '세션 닫기',
  'action.openConfig': '설정 파일 열기',
  'action.switchLanguage': 'English',
  'action.closePane': '분할 닫기',
  'pane.empty': '빈 화면',
  'empty.pickProject': '왼쪽에서 프로젝트를 고르세요',
  'account.title': 'Claude 계정',
  'account.shared': '공용',
  'account.personal': '개인',
  'group.work': '회사',
  'group.personal': '개인',
  'kind.claude': 'Claude',
  'kind.codex': 'Codex',
  'kind.shell': '셸',
  'notify.done': '작업 완료',
  'notify.waiting': '입력 필요',
  'error.projectNotFound': '프로젝트를 찾을 수 없어요: {id}',
  'error.configRead': 'config.json을 읽지 못했어요: {message}',
} as const;

type Key = keyof typeof ko;

const en = {
  'action.openClaude': 'Open Claude',
  'action.openCodex': 'Open Codex',
  'action.openShell': 'Open shell',
  'action.closeSession': 'Close session',
  'action.openConfig': 'Open settings file',
  'action.switchLanguage': '한국어',
  'action.closePane': 'Close pane',
  'pane.empty': 'Empty pane',
  'empty.pickProject': 'Pick a project on the left',
  'account.title': 'Claude account',
  'account.shared': 'Shared',
  'account.personal': 'Personal',
  'group.work': 'Work',
  'group.personal': 'Personal',
  'kind.claude': 'Claude',
  'kind.codex': 'Codex',
  'kind.shell': 'Shell',
  'notify.done': 'Done',
  'notify.waiting': 'Needs input',
  'error.projectNotFound': 'Project not found: {id}',
  'error.configRead': "Couldn't read config.json: {message}",
} satisfies Record<Key, string>;

const DICT: Record<Language, Record<Key, string>> = { ko, en };

export type Translate = (key: Key, vars?: Record<string, string>) => string;

export function translator(lang: Language = 'ko'): Translate {
  const dict = DICT[lang] ?? ko;
  return (key, vars) => dict[key].replace(/\{(\w+)\}/g, (_, k: string) => vars?.[k] ?? '');
}

const known = (t: Translate, key: string): string | null => (key in ko ? t(key as Key) : null);

export const groupLabel = (t: Translate, g: Group) => g.label ?? known(t, `group.${g.id}`) ?? g.id;
export const accountLabel = (t: Translate, id: string, a?: Account) =>
  a?.label ?? known(t, `account.${id}`) ?? id;
export const kindLabel = (t: Translate, kind: SessionKind) => t(`kind.${kind}`);
