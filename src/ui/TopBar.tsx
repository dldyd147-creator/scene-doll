import { useStore } from '../state/store';
import { Icon } from './icons';
import { goToStart, saveNow } from './save';
import { StorageControls } from './StorageControls';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TopBar() {
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const dirty = useStore((s) => s.dirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const saveError = useStore((s) => s.saveError);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const setGalleryOpen = useStore((s) => s.setGalleryOpen);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const setCharacterManagerFor = useStore((s) => s.setCharacterManagerFor);
  const outputCount = useStore((s) => s.outputCount);

  const openCharacters = async () => {
    if (useStore.getState().dirty) await saveNow();
    setCharacterManagerFor(work.code);
  };

  return (
    <header className="topbar">
      <div className="brand">
        씬 <span>돌</span>
      </div>
      <div className="sep" />
      <button onClick={() => void goToStart()} title="작품 관리로 돌아가기(저장됨). 작품·회차를 고르거나 캐릭터를 등록합니다">
        <Icon name="home" /> 작품 관리
      </button>
      <span className="doc-label" title={`작품 ${work.code} · ${work.name} · ${episode.number}화`}>
        <b>{work.name}</b> <span className="muted">{work.code}</span> · {episode.number}화{episode.title ? ` ${episode.title}` : ''}
      </span>
      <button className="icon" onClick={() => void openCharacters()} title="이 작품의 캐릭터 관리(설명·레퍼런스·돌 지정)">
        <Icon name="user" />
      </button>
      <div className="grow" />

      <StorageControls />
      <div className="sep" />
      <button className="icon" onClick={() => void saveNow()} title="저장 (Ctrl+S)">
        <Icon name="save" />
      </button>
      <span className={`save-state ${saveError ? 'error' : dirty ? 'dirty' : ''}`} title={saveError ?? undefined}>
        {saveError ? '저장 실패' : dirty ? '변경됨' : lastSavedAt ? timeLabel(lastSavedAt) : ''}
      </span>
      <button className="icon" onClick={() => setExportOpen(true)} title="회차 일괄 출력(PNG + 설명 텍스트 + AI 전달 패키지)">
        <Icon name="export" />
      </button>
      <button className={`icon ${outputCount ? 'has-output' : ''}`} onClick={() => setGalleryOpen(true)} title={outputCount ? `출력물 보기: 이 회차에 출력된 컷 PNG ${outputCount}장` : '출력물 보기: 이 회차에는 아직 출력물이 없습니다'}>
        <Icon name="gallery" />
      </button>
      <div className="sep" />
      <button className="icon" onClick={() => setSettingsOpen(true)} title="설정">
        <Icon name="settings" />
      </button>
      <button className="icon" onClick={() => setHelpOpen(true)} title="도움말: 조작법과 단축키">
        <Icon name="help" />
      </button>
    </header>
  );
}
