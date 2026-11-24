// Link suggestions (T68): suggested connections with accept / reject, rule proposals, and the settings dialog
// (AI extraction per source, rules). The graph panel and the note editor show `LinkSuggestions` for one node.
import { lazyComponent } from '@/shared/lib/lazyComponent';
export const LinkSuggestions = lazyComponent(() => import('./ui/LinkSuggestions'));
export type { LinkSuggestionsProps } from './ui/LinkSuggestions';
export const LinkSettingsDialog = lazyComponent(() => import('./ui/LinkSettingsDialog'));
