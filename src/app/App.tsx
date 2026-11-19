import { useEffect } from 'react';
import { WorkspacePage } from '@/pages/workspace';
import { usePowerSaver } from '@/shared/lib/usePowerSaver';

export default function App() {
  const saver = usePowerSaver();
  // `components.css` stops looping animations under `[data-power='saver']`.
  useEffect(() => {
    if (saver) document.documentElement.dataset.power = 'saver';
    else delete document.documentElement.dataset.power;
  }, [saver]);
  return <WorkspacePage />;
}
