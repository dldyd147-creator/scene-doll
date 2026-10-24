import { useEffect } from 'react';
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
import { ExportDialog } from './ui/ExportDialog';
import { HelpDialog } from './ui/HelpDialog';
import { OutputGallery } from './ui/OutputGallery';
import { StartScreen } from './ui/StartScreen';
import { CharacterManager } from './ui/CharacterManager';
import { useStore } from './state/store';

export default function App() {
  const engine = useEngine();
  useShortcuts(engine);
  useAutosave();
  const theme = useStore((s) => s.settings.theme);
  const screen = useStore((s) => s.screen);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <>
      {screen === 'start' ? (
        <StartScreen />
      ) : (
        <div className="app">
          <TopBar />
          <div className="main">
            <CutList />
            <ManuscriptColumn engine={engine} />
            <WorkView engine={engine} />
            <AssetPanel />
          </div>
          <StatusBar />
          <ExportDialog engine={engine} />
          <OutputGallery />
        </div>
      )}
      <SettingsDialog />
      <HelpDialog />
      <CharacterManager />
    </>
  );
}
