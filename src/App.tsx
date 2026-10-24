import { useEngine } from './ui/useEngine';
import { useShortcuts } from './ui/useShortcuts';
import { useAutosave } from './ui/useAutosave';
import { TopBar } from './ui/TopBar';
import { CutList } from './ui/CutList';
import { ManuscriptColumn } from './ui/ManuscriptColumn';
import { WorkView } from './ui/WorkView';
import { AssetPanel } from './ui/AssetPanel';
import { StatusBar } from './ui/StatusBar';
import { SettingsDialog } from './ui/SettingsDialog';

export default function App() {
  const engine = useEngine();
  useShortcuts(engine);
  useAutosave();
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <CutList />
        <ManuscriptColumn engine={engine} />
        <WorkView engine={engine} />
        <AssetPanel />
      </div>
      <StatusBar />
      <SettingsDialog />
    </div>
  );
}
