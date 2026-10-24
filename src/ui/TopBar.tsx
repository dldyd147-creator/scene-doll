import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { storage } from '../storage';
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
      <label className="field">
        작품코드
        <input className="code" type="text" value={work.code} maxLength={3} onChange={(e) => setWorkCode(e.target.value)} spellCheck={false} />
      </label>
      <input className="name" type="text" value={work.name} onChange={(e) => setWorkName(e.target.value)} placeholder="작품명" spellCheck={false} />
      <label className="field">
        회차
        <input className="episode" type="number" min={1} max={999} value={episode.number} onChange={(e) => setEpisodeNumber(Number(e.target.value))} />
      </label>
      <div style={{ position: 'relative' }}>
        <button ref={openBtn} onClick={showOpenList}>
          열기…
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
        <span className="storage-chip folder" title="저장 위치: 지정한 작업 폴더 (탐색기에서 바로 보입니다)">
          📁 {folderName}
        </span>
      ) : (
        <span className="storage-chip" title="작업 폴더를 지정하기 전까지 브라우저 안에 저장합니다">
          브라우저 내부 저장
        </span>
      )}
      {pending && storageKind !== 'folder' && (
        <button className="primary" onClick={() => void reconnectWorkFolder()} title={`이전 작업 폴더(${pending})에 다시 접근 허용`}>
          폴더 다시 연결
        </button>
      )}
      {folderSupported() ? (
        <button onClick={() => void chooseWorkFolder()}>{storageKind === 'folder' ? '폴더 변경' : '작업 폴더 지정'}</button>
      ) : (
        <span className="muted small" title="크롬·엣지에서 열면 작업 폴더에 직접 저장할 수 있습니다">
          폴더 저장은 크롬·엣지 전용
        </span>
      )}
      {storageKind === 'folder' && (
        <button onClick={() => void useBrowserStorage()} title="작업 폴더 연결을 끊고 브라우저 내부 저장으로">
          연결 해제
        </button>
      )}
      <div className="sep" />
      <button onClick={() => void saveNow()} title="저장 (Ctrl+S)">
        저장
      </button>
      <span className={`save-state ${saveError ? 'error' : dirty ? 'dirty' : ''}`}>
        {saveError ? `저장 실패: ${saveError}` : dirty ? '변경됨' : lastSavedAt ? `저장됨 ${timeLabel(lastSavedAt)}` : ''}
      </span>
      <div className="sep" />
      <button onClick={() => setSettingsOpen(true)}>설정</button>
    </header>
  );
}
