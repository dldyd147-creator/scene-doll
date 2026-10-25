import { storage } from '../storage';
import { initShare, lockEpisode, unlockEpisode } from '../storage/remote/service';
import { useStore } from '../state/store';
import { createCut, createEpisode, createWork } from '../model/defaults';

let saving: Promise<boolean> | null = null;
const LAST_KEY = 'scene-doll.last-opened';

/** 문서와 바뀐 썸네일을 저장소에 쓴다. 동시에 두 번 돌지 않는다. 보기 전용 회차는 쓰지 않는다 */
export function saveNow(): Promise<boolean> {
  if (saving) return saving;
  if (useStore.getState().readOnly) return Promise.resolve(false);
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
  // 공유 저장소에 로그인한 동안에도 상단 칩은 로컬(작업 폴더/브라우저) 쪽을 보여 준다. 공유 상태는 공유 칩이 따로 보여 준다
  const kind = st.kind === 'remote' ? st.localKind : st.kind;
  useStore.getState().setStorage(kind, kind === 'folder' ? st.localLabel : null);
}

/** 앱 시작: 저장소 연결(공유 저장소 세션이 남아 있으면 되살림). 문서는 열지 않고 시작 화면(작품 관리)을 보여 준다 */
export async function initStorage(): Promise<void> {
  await storage.init();
  await initShare().catch(() => undefined);
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

/** 이 회차 출력 폴더의 PNG 수를 세어 둔다(출력물 보기 아이콘 색) */
export async function refreshOutputCount(): Promise<void> {
  const s = useStore.getState();
  const files = await storage.backend.list(storage.repository.outputFolder(s.work.code, s.episode.number)).catch(() => []);
  useStore.getState().setOutputCount(files.filter((f) => f.kind === 'file' && f.name.endsWith('.png')).length);
}

/**
 * 작품·회차 열기 → 편집 화면. 없으면 create=true일 때 새로 만든다.
 * 공유 저장소에 로그인한 상태면 회차 잠금을 먼저 잡고, 남이 쥐고 있으면 보기 전용으로 연다
 */
export async function openDocument(code: string, episodeNo: number, create: boolean): Promise<'loaded' | 'created' | 'missing'> {
  const doc = await storage.load(code, episodeNo).catch(() => null);
  if (!doc && !create) return 'missing';
  const lock = await lockEpisode(code, episodeNo);
  const st = useStore.getState();
  if (doc) {
    const thumbs = await storage.repository.loadThumbnails(code, episodeNo, doc.cuts.map((c) => c.number)).catch(() => ({}));
    st.loadDocument(doc, thumbs);
  } else {
    const work = (await storage.repository.loadWork(code).catch(() => null)) ?? createWork(code, code);
    st.loadDocument({ work, episode: createEpisode(code, episodeNo), cuts: [createCut(1)], characters: await storage.repository.loadCharacters(code).catch(() => []) });
  }
  st.setReadOnly(!lock.mine);
  st.setScreen('editor');
  rememberOpened(code, episodeNo);
  void refreshOutputCount();
  if (!lock.mine) st.setStatusHint(`보기 전용: ${lock.holder?.userEmail ?? '다른 사람'}이(가) 이 회차를 작업 중입니다. 저장·확정이 막힙니다`);
  return doc ? 'loaded' : 'created';
}

/** 편집 화면 → 시작 화면(작품 관리). 바뀐 것은 먼저 저장하고 회차 잠금을 푼다 */
export async function goToStart(): Promise<void> {
  const s = useStore.getState();
  if (s.dirty && !s.readOnly) await saveNow();
  await unlockEpisode();
  useStore.getState().setReadOnly(false);
  useStore.getState().select({ dollId: null, bone: null });
  useStore.getState().setScreen('start');
}

/** 캐릭터 관리에서 고친 뒤 편집 중인 문서의 캐릭터를 저장소에서 다시 읽는다 */
export async function reloadCharacters(): Promise<void> {
  const s = useStore.getState();
  const chars = await storage.repository.loadCharacters(s.work.code).catch(() => null);
  if (chars) useStore.getState().setCharacters(chars);
}

/** 저장소가 바뀐 뒤: 편집 중이면 같은 작품·회차를 새 저장소에서 다시 연다(없으면 지금 문서를 그대로 저장) */
async function afterStorageChange(): Promise<void> {
  syncStorageState();
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
