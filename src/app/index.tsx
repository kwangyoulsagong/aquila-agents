import { createRoot } from 'react-dom/client';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@xterm/xterm/css/xterm.css';
import '@design-system/tokens.css';
import '@design-system/components.css';
import './styles/app.css';
import App from './App';

createRoot(document.getElementById('root')!).render(<App />);
