import { lazyComponent } from '@/shared/lib/lazyComponent';
export { useManageProjects, type ManageDialog, type ManageProjects } from './model/useManageProjects';
export const ManageProjectsDialog = lazyComponent(() => import('./ui/ManageProjectsDialog'));
export type { RenderFigma } from './ui/ProjectSettingsDialog';
