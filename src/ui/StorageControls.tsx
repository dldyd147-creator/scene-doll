import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { chooseWorkFolder, folderSupported, pendingFolderName, reconnectWorkFolder, useBrowserStorage } from './save';

/** 작업 폴더 지정·재연결·해제. 상단 바와 시작 화면에서 같이 쓴다 */
export function StorageControls({ onChanged }: { onChanged?: () => void }) {
  const storageKind = useStore((s) => s.storageKind);
  const folderName = useStore((s) => s.folderName);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setPending(pendingFolderName()), 500);
    return () => window.clearInterval(t);
  }, []);

  const choose = async () => {
    if (await chooseWorkFolder()) onChanged?.();
  };
  const reconnect = async () => {
    if (await reconnectWorkFolder()) onChanged?.();
  };
  const toBrowser = async () => {
    await useBrowserStorage();
    onChanged?.();
  };

  return (
    <>
      {storageKind === 'folder' ? (
        <span className="storage-chip folder" title={`작업 폴더: ${folderName} · 파일은 탐색기에서 이 폴더 안에 보입니다 · 클릭: 폴더 변경`} onClick={() => void choose()}>
          <Icon name="folder" /> {folderName}
        </span>
      ) : pending ? (
        <button className="primary" onClick={() => void reconnect()} title={`이전 작업 폴더(${pending})에 다시 접근 허용`}>
          <Icon name="folder" /> {pending} 다시 연결
        </button>
      ) : folderSupported() ? (
        <button onClick={() => void choose()} title="작업 폴더를 지정하면 파일이 탐색기에 바로 보입니다. 지정 전에는 브라우저 안에 저장됩니다">
          <Icon name="folder" /> 작업 폴더
        </button>
      ) : (
        <span className="storage-chip" title="폴더 저장은 크롬·엣지에서만 됩니다. 지금은 브라우저 안에 저장합니다">
          브라우저 저장
        </span>
      )}
      {storageKind === 'folder' && (
        <button className="icon ghost" onClick={() => void toBrowser()} title="작업 폴더 연결 해제(브라우저 내부 저장으로)">
          <Icon name="close" size={14} />
        </button>
      )}
    </>
  );
}
