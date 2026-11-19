// UI strings in Korean and English. Shared by main (notifications) and renderer.
// Add a key to BOTH languages — the `satisfies` check fails the typecheck if one is missing.
import type { Account, Group, Language, SessionKind } from '../api/types';

const ko = {
  'action.openClaude': 'Claude 열기',
  'action.openCodex': 'Codex 열기',
  'action.closeSession': '세션 닫기',
  'action.openConfig': '설정 파일 열기',
  'action.switchLanguage': 'English',
  'action.closePane': '분할 닫기',
  'pane.empty': '빈 화면',
  'empty.pickProject': '왼쪽에서 프로젝트를 고르세요',
  'account.title': 'Claude 계정',
  'account.shared': '공용',
  'account.personal': '개인',
  'action.close': '닫기',
  'setup.button': '{account} 설정',
  'setup.title': '{account} 계정 설정',
  'setup.intro': '{dir}에 Claude 로그인을 따로 만들어요. 열리는 Claude 세션에서 로그인하세요.',
  'setup.introShared': 'Claude 세션을 열어 로그인하세요.',
  'setup.dirReady': '폴더 있음 · {dir}',
  'setup.dirMissing': '폴더 없음 · {dir}',
  'setup.loggedIn': '로그인됨',
  'setup.loggedOut': '로그인 필요',
  'setup.start': '폴더 만들고 로그인',
  'setup.login': 'Claude 열어서 로그인',
  'setup.shellTitle': '터미널에서도 {name} 쓰기',
  'setup.shellPreview': '미리보기',
  'setup.shellWillAdd': '{rc} 끝에 이 줄을 추가해요:',
  'setup.shellAdd': '{rc}에 추가',
  'setup.shellDefined': '{name}은(는) 이미 셸에 있어요. 아무것도 바꾸지 않아요.',
  'setup.shellAdded': '추가했어요. 새 터미널부터 쓸 수 있어요.',
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
  'action.closeSession': 'Close session',
  'action.openConfig': 'Open settings file',
  'action.switchLanguage': '한국어',
  'action.closePane': 'Close pane',
  'pane.empty': 'Empty pane',
  'empty.pickProject': 'Pick a project on the left',
  'account.title': 'Claude account',
  'account.shared': 'Shared',
  'account.personal': 'Personal',
  'action.close': 'Close',
  'setup.button': 'Set up {account}',
  'setup.title': 'Set up {account} account',
  'setup.intro': 'Creates a separate Claude login in {dir}. Log in in the Claude session that opens.',
  'setup.introShared': 'Open a Claude session and log in.',
  'setup.dirReady': 'Folder exists · {dir}',
  'setup.dirMissing': 'No folder yet · {dir}',
  'setup.loggedIn': 'Logged in',
  'setup.loggedOut': 'Not logged in',
  'setup.start': 'Create folder and log in',
  'setup.login': 'Open Claude and log in',
  'setup.shellTitle': 'Use {name} in your terminal too',
  'setup.shellPreview': 'Preview',
  'setup.shellWillAdd': 'Adds this line to the end of {rc}:',
  'setup.shellAdd': 'Add to {rc}',
  'setup.shellDefined': '{name} is already defined in your shell. Nothing will change.',
  'setup.shellAdded': 'Added. Works in new terminals.',
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
