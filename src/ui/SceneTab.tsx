import { useEffect } from 'react';
import type { SceneLibraryItem } from '../model/types';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary, useThumb } from './library';

/** 에셋 패널 씬 탭: 씬 검색기 열기 + 현재 씬 저장 + 최근 저장 씬 */
export function SceneTab() {
  const scenes = useLibrary((s) => s.scenes);
  const error = useLibrary((s) => s.error);
  const loadScenes = useLibrary((s) => s.loadScenes);
  const openBrowser = useStore((s) => s.openSceneBrowser);
  const setSaveOpen = useStore((s) => s.setSceneSaveOpen);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  const recent = (scenes ?? []).slice(0, 6);
  return (
    <>
      <div className="row" style={{ display: 'flex', gap: 6 }}>
        <button className="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openBrowser()} title="씬 검색기: 저장된 씬을 샷·앵글·인원·상황 태그로 걸러 불러오고 슬롯마다 캐릭터를 지정 (` 키)">
          <Icon name="search" /> 씬 검색기 <kbd>`</kbd>
        </button>
        <button className="icon" onClick={() => setSaveOpen(true)} title="현재 씬을 라이브러리에 저장(자동 태그 + 상황 태그 버튼)">
          <Icon name="bookmarkPlus" />
        </button>
      </div>
      <div className="panel-title" style={{ border: 'none', padding: '4px 0 0', minHeight: 0 }}>
        최근 저장 씬 {scenes ? <span className="muted">{scenes.length}</span> : null}
      </div>
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      {scenes && scenes.length === 0 && <div className="muted small" style={{ padding: '2px' }}>저장된 씬이 없습니다. 위의 책갈피 버튼(또는 원고뷰 아래의 같은 버튼)으로 현재 씬을 저장하세요. 씬은 모든 작품이 함께 씁니다.</div>}
      <div className="recent-grid">
        {recent.map((it) => (
          <SceneMini key={it.id} item={it} onClick={() => openBrowser(it.id)} />
        ))}
      </div>
    </>
  );
}

function SceneMini({ item, onClick }: { item: SceneLibraryItem; onClick: () => void }) {
  const url = useThumb(item.thumbnail);
  return (
    <div className="pose-card" onClick={onClick} title={`${item.name}\n검색기에서 열어 캐릭터를 지정하고 교체·추가`}>
      <div className="img">{url ? <img src={url} alt="" draggable={false} /> : <Icon name="gallery" size={22} className="muted" />}</div>
      <div className="cap">
        <b>{item.name}</b>
      </div>
    </div>
  );
}
