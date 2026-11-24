import { lazyComponent } from '@/shared/lib/lazyComponent';
export const ExtensionPanel = lazyComponent(() => import('./ui/ExtensionPanel'));
export { default as ExtensionChips } from './ui/ExtensionChips';
export const NewExtensionDialog = lazyComponent(() => import('./ui/NewExtensionDialog'));
export { useExtensions, extensionCommands } from './model/useExtensions';
