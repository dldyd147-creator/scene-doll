import type { Document } from '../state/store';
import type { StorageBackend } from './backend';
import { BrowserBackend } from './browserBackend';
import { FolderBackend, folderAccessSupported, forgetFolderHandle, loadFolderHandle, saveFolderHandle } from './folderBackend';
import { Repository } from './repository';

export type StorageStatus = { kind: 'folder' | 'browser'; label: string; pendingFolder: string | null };

/**
 * 저장소 서비스. 앱은 이 객체만 쓴다.
 * - 처음 열 때 이전에 지정한 작업 폴더가 있으면 권한을 확인해 다시 연결한다(권한이 'prompt'면 버튼 한 번 필요)
 * - 폴더가 없으면 브라우저 내부 저장(IndexedDB)으로 동작한다
 */
class StorageService {
  private backend: StorageBackend = new BrowserBackend();
  private repo = new Repository(this.backend);
  private pendingHandle: FileSystemDirectoryHandle | null = null;

  get status(): StorageStatus {
    return { kind: this.backend.kind, label: this.backend.label, pendingFolder: this.pendingHandle?.name ?? null };
  }

  get supportsFolder(): boolean {
    return folderAccessSupported();
  }

  async init(): Promise<StorageStatus> {
    if (!folderAccessSupported()) return this.status;
    const handle = await loadFolderHandle();
    if (!handle) return this.status;
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') this.useFolder(handle);
      else this.pendingHandle = handle;
    } catch {
      this.pendingHandle = handle;
    }
    return this.status;
  }

  private useFolder(handle: FileSystemDirectoryHandle): void {
    this.backend = new FolderBackend(handle);
    this.repo = new Repository(this.backend);
    this.pendingHandle = null;
  }

  /** 이전 작업 폴더 다시 연결(사용자 클릭에서 호출해야 한다) */
  async reconnectFolder(): Promise<boolean> {
    if (!this.pendingHandle) return false;
    try {
      const perm = await this.pendingHandle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.useFolder(this.pendingHandle);
        return true;
      }
    } catch {
      /* 거부 */
    }
    return false;
  }

  /** 작업 폴더 고르기(사용자 클릭에서 호출) */
  async chooseFolder(): Promise<boolean> {
    if (!folderAccessSupported()) return false;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'scene-doll-work' });
      await saveFolderHandle(handle);
      this.useFolder(handle);
      return true;
    } catch {
      return false; // 취소
    }
  }

  async useBrowserStorage(): Promise<void> {
    await forgetFolderHandle().catch(() => undefined);
    this.backend = new BrowserBackend();
    this.repo = new Repository(this.backend);
    this.pendingHandle = null;
  }

  save(doc: Document): Promise<void> {
    return this.repo.saveDocument(doc);
  }

  load(code: string, episodeNo: number): Promise<Document | null> {
    return this.repo.loadDocument(code, episodeNo);
  }

  listWorks(): Promise<string[]> {
    return this.repo.listWorks();
  }

  listEpisodes(code: string): Promise<number[]> {
    return this.repo.listEpisodes(code);
  }

  get repository(): Repository {
    return this.repo;
  }
}

export const storage = new StorageService();
