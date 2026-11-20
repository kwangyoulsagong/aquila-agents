import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@xterm/xterm/css/xterm.css';
import '@design-system/tokens.css';
import '@design-system/components.css';
import './styles/app.css';
import App from './App';
import { followSystemTheme } from '@/shared/lib/theme';
import { api } from '@/shared/api';

followSystemTheme(); // before the first render: terminals read the tokens on mount
// Platform tokens (Windows caption-button room, T19).
document.documentElement.dataset.platform = api.platform.os;

createRoot(document.getElementById('root')!).render(<App />);
