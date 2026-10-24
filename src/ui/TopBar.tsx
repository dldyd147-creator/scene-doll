import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { storage } from '../storage';
import { Icon } from './icons';
import { chooseWorkFolder, folderSupported, openDocument, pendingFolderName, reconnectWorkFolder, saveNow, useBrowserStorage } from './save';

function timeLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function TopBar() {
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const storageKind = useStore((s) => s.storageKind);
  const folderName = useStore((s) => s.folderName);
  const dirty = useStore((s) => s.dirty);
  const lastSavedAt = useStore((s) => s.lastSavedAt);
  const saveError = useStore((s) => s.saveError);
  const setWorkCode = useStore((s) => s.setWorkCode);
  const setWorkName = useStore((s) => s.setWorkName);
  const setEpisodeNumber = useStore((s) => s.setEpisodeNumber);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const setGalleryOpen = useStore((s) => s.setGalleryOpen);
  const setExportOpen = useStore((s) => s.setExportOpen);
  const [pending, setPending] = useState<string | null>(null);
  const [openList, setOpenList] = useState<Array<{ code: string; episodes: number[] }> | null>(null);
  const openBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setPending(pendingFolderName()), 500);
    return () => window.clearInterval(t);
  }, []);

  const showOpenList = async () => {
    if (openList) {
      setOpenList(null);
      return;
    }
    const codes = await storage.listWorks().catch(() => [] as string[]);
    const list = [] as Array<{ code: string; episodes: number[] }>;
    for (const code of codes) list.push({ code, episodes: await storage.listEpisodes(code).catch(() => [] as number[]) });
    setOpenList(list);
  };

  const open = async (code: string, ep: number) => {
    setOpenList(null);
    if (useStore.getState().dirty) await saveNow();
    await openDocument(code, ep, true);
  };

  const newEpisode = async () => {
    setOpenList(null);
    const s = useStore.getState();
    if (s.dirty) await saveNow();
    const eps = await storage.listEpisodes(s.work.code).catch(() => [] as number[]);
    const next = (eps.length ? Math.max(...eps) : s.episode.number) + 1;
    await openDocument(s.work.code, next, true);
    await saveNow();
  };

  return (
    <header className="topbar">
      <div className="brand">
        씬 <span>돌</span>
      </div>
      <div className="sep" />
      <input className="code" type="text" value={work.code} maxLength={3} onChange={(e) => setWorkCode(e.target.value)} spellCheck={false} title="작품코드(영문 대문자 3자)" />
      <input className="name" type="text" value={work.name} onChange={(e) => setWorkName(e.target.value)} placeholder="작품명" spellCheck={false} title="작품명" />
      <label className="field" title="회차">
        <Icon name="cut" />
        <input className="episode" type="number" min={1} max={999} value={episode.number} onChange={(e) => setEpisodeNumber(Number(e.target.value))} />
      </label>
      <div style={{ position: 'relative' }}>
        <button ref={openBtn} className="icon" onClick={showOpenList} title="저장된 작품·회차 열기">
          <Icon name="folderOpen" />
        </button>
        {openList && (
          <div className="popover" style={{ left: 0 }}>
            <div className="muted small">저장소에 있는 작품·회차</div>
            {openList.length === 0 && <div className="muted small">저장된 작품이 없습니다. 저장(Ctrl+S)하면 여기에 나타납니다.</div>}
            {openList.map((w) => (
              <div key={w.code}>
                <div className="small" style={{ padding: '4px 8px', fontWeight: 600 }}>
                  {w.code}
                </div>
                {w.episodes.map((ep) => (
                  <div key={ep} className="item" onClick={() => open(w.code, ep)}>
                    <span>{ep}화</span>
                    <span className="muted small">열기</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="item" onClick={newEpisode}>
              <span>+ {work.code} 새 회차</span>
            </div>
          </div>
        )}
      </div>
      <div className="grow" />

      {storageKind === 'folder' ? (
        <span className="storage-chip folder" title={`작업 폴더: ${folderName} · 파일은 탐색기에서 이 폴더 안에 보입니다 · 클릭: 폴더 변경`} onClick={() => void chooseWorkFolder()}>
          <Icon name="folder" /> {folderName}
        </span>
      ) : pending ? (
        <button className="primary" onClick={() => void reconnectWorkFolder()} title={`이전 작업 폴더(${pending})에 다시 접근 허용`}>
          <Icon name="folder" /> {pending} 다시 연결
        </button>
      ) : folderSupported() ? (
        <button onClick={() => void chooseWorkFolder()} title="작업 폴더를 지정하면 파일이 탐색기에 바로 보입니다. 지정 전에는 브라우저 안에 저장됩니다">
          <Icon name="folder" /> 작업 폴더
        </button>
      ) : (
        <span className="storage-chip" title="폴더 저장은 크롬·엣지에서만 됩니다. 지금은 브라우저 안에 저장합니다">
          브라우저 저장
        </span>
      )}
      {storageKind === 'folder' && (
        <button className="icon ghost" onClick={() => void useBrowserStorage()} title="작업 폴더 연결 해제(브라우저 내부 저장으로)">
          <Icon name="close" size={14} />
        </button>
      )}
      <div className="sep" />
      <button className="icon" onClick={() => void saveNow()} title="저장 (Ctrl+S)">
        <Icon name="save" />
      </button>
      <span className={`save-state ${saveError ? 'error' : dirty ? 'dirty' : ''}`} title={saveError ?? undefined}>
        {saveError ? '저장 실패' : dirty ? '변경됨' : lastSavedAt ? timeLabel(lastSavedAt) : ''}
      </span>
      <button className="icon" onClick={() => setExportOpen(true)} title="회차 일괄 출력(PNG + 설명 텍스트)">
        <Icon name="export" />
      </button>
      <button className="icon" onClick={() => setGalleryOpen(true)} title="출력물 보기(출력 폴더의 PNG·설명 텍스트)">
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
