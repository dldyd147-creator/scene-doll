import { storage } from '../storage';
import { useStore } from '../state/store';
import { createCut, createEpisode, createWork } from '../model/defaults';

export async function saveNow(): Promise<boolean> {
  const s = useStore.getState();
  try {
    await storage.save(s.snapshotDocument());
    useStore.getState().markSaved();
    return true;
  } catch (e) {
    useStore.getState().setSaveError(e instanceof Error ? e.message : String(e));
    return false;
  }
}

function syncStorageState(): void {
  const st = storage.status;
  useStore.getState().setStorage(st.kind, st.kind === 'folder' ? st.label : null);
}

/** 앱 시작: 저장소 연결 후 현재 작품·회차 문서가 있으면 불러온다 */
export async function initStorage(): Promise<void> {
  await storage.init();
  syncStorageState();
  const s = useStore.getState();
  await openDocument(s.work.code, s.episode.number, false);
}

/** 작품·회차 열기. 없으면 create=true일 때 새로 만든다 */
export async function openDocument(code: string, episodeNo: number, create: boolean): Promise<'loaded' | 'created' | 'missing'> {
  const doc = await storage.load(code, episodeNo).catch(() => null);
  if (doc) {
    useStore.getState().loadDocument(doc);
    return 'loaded';
  }
  if (!create) return 'missing';
  const work = (await storage.repository.loadWork(code).catch(() => null)) ?? createWork(code, code);
  useStore.getState().loadDocument({ work, episode: createEpisode(code, episodeNo), cuts: [createCut(1)], characters: [] });
  return 'created';
}

export async function chooseWorkFolder(): Promise<boolean> {
  const ok = await storage.chooseFolder();
  if (ok) {
    syncStorageState();
    const s = useStore.getState();
    const result = await openDocument(s.work.code, s.episode.number, false);
    if (result === 'missing') await saveNow();
  }
  return ok;
}

export async function reconnectWorkFolder(): Promise<boolean> {
  const ok = await storage.reconnectFolder();
  if (ok) {
    syncStorageState();
    const s = useStore.getState();
    await openDocument(s.work.code, s.episode.number, false);
  }
  return ok;
}

export async function useBrowserStorage(): Promise<void> {
  await storage.useBrowserStorage();
  syncStorageState();
}

export function pendingFolderName(): string | null {
  return storage.status.pendingFolder;
}

export function folderSupported(): boolean {
  return storage.supportsFolder;
}
