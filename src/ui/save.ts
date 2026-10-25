import { storage } from '../storage';
import { useStore } from '../state/store';
import { createCut, createEpisode, createWork } from '../model/defaults';
import { useLibrary } from './library';

let saving: Promise<boolean> | null = null;
const LAST_KEY = 'scene-doll.last-opened';

/** 문서와 바뀐 썸네일을 저장소에 쓴다. 동시에 두 번 돌지 않는다 */
export function saveNow(): Promise<boolean> {
  if (saving) return saving;
  saving = (async () => {
    const s = useStore.getState();
    try {
      await storage.save(s.snapshotDocument());
      if (s.thumbnailDirty.length || s.thumbnailsRenumbered) {
        await storage.repository.saveThumbnails(s.work.code, s.episode.number, s.thumbnails, s.thumbnailDirty, s.thumbnailsRenumbered);
        useStore.getState().markThumbnailsSaved();
      }
      useStore.getState().markSaved();
      return true;
    } catch (e) {
      useStore.getState().setSaveError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

function syncStorageState(): void {
  const st = storage.status;
  useStore.getState().setStorage(st.kind, st.kind === 'folder' ? st.label : null);
}

/** 앱 시작: 저장소 연결. 문서는 열지 않고 시작 화면(작품 관리)을 보여 준다 */
export async function initStorage(): Promise<void> {
  await storage.init();
  syncStorageState();
  useStore.getState().setScreen('start');
}

/** 마지막으로 연 작품·회차(시작 화면에서 먼저 보여 주기용) */
export function lastOpened(): { code: string; episode: number } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as { code: string; episode: number }) : null;
  } catch {
    return null;
  }
}

function rememberOpened(code: string, episode: number): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ code, episode }));
  } catch {
    /* 무시 */
  }
}

/** 작품·회차 열기 → 편집 화면. 없으면 create=true일 때 새로 만든다 */
export async function openDocument(code: string, episodeNo: number, create: boolean): Promise<'loaded' | 'created' | 'missing'> {
  const doc = await storage.load(code, episodeNo).catch(() => null);
  if (doc) {
    const thumbs = await storage.repository.loadThumbnails(code, episodeNo, doc.cuts.map((c) => c.number)).catch(() => ({}));
    useStore.getState().loadDocument(doc, thumbs);
    useStore.getState().setScreen('editor');
    rememberOpened(code, episodeNo);
    return 'loaded';
  }
  if (!create) return 'missing';
  const work = (await storage.repository.loadWork(code).catch(() => null)) ?? createWork(code, code);
  useStore.getState().loadDocument({ work, episode: createEpisode(code, episodeNo), cuts: [createCut(1)], characters: await storage.repository.loadCharacters(code).catch(() => []) });
  useStore.getState().setScreen('editor');
  rememberOpened(code, episodeNo);
  return 'created';
}

/** 편집 화면 → 시작 화면(작품 관리). 바뀐 것은 먼저 저장한다 */
export async function goToStart(): Promise<void> {
  if (useStore.getState().dirty) await saveNow();
  useStore.getState().select({ dollId: null, bone: null });
  useStore.getState().setScreen('start');
}

/** 캐릭터 관리에서 고친 뒤 편집 중인 문서의 캐릭터를 저장소에서 다시 읽는다 */
export async function reloadCharacters(): Promise<void> {
  const s = useStore.getState();
  const chars = await storage.repository.loadCharacters(s.work.code).catch(() => null);
  if (chars) useStore.getState().setCharacters(chars);
}

/** 저장소가 바뀐 뒤: 편집 중이면 같은 작품·회차를 새 저장소에서 다시 연다(없으면 지금 문서를 그대로 저장). 공용 라이브러리 캐시도 비운다 */
async function afterStorageChange(): Promise<void> {
  syncStorageState();
  useLibrary.getState().reset();
  const s = useStore.getState();
  if (s.screen !== 'editor') return;
  const result = await openDocument(s.work.code, s.episode.number, false);
  if (result === 'missing') await saveNow();
}

export async function chooseWorkFolder(): Promise<boolean> {
  const ok = await storage.chooseFolder();
  if (ok) await afterStorageChange();
  return ok;
}

export async function reconnectWorkFolder(): Promise<boolean> {
  const ok = await storage.reconnectFolder();
  if (ok) await afterStorageChange();
  return ok;
}

export async function useBrowserStorage(): Promise<void> {
  await storage.useBrowserStorage();
  await afterStorageChange();
}

export function pendingFolderName(): string | null {
  return storage.status.pendingFolder;
}

export function folderSupported(): boolean {
  return storage.supportsFolder;
}
