import type { Document } from '../state/store';
import type { BackendKind, StorageBackend } from './backend';
import { BrowserBackend } from './browserBackend';
import { FolderBackend, folderAccessSupported, forgetFolderHandle, loadFolderHandle, saveFolderHandle } from './folderBackend';
import { HybridBackend } from './remote/hybridBackend';
import { Repository } from './repository';

export type StorageStatus = { kind: BackendKind; label: string; pendingFolder: string | null; localKind: 'folder' | 'browser'; localLabel: string };

/**
 * 저장소 서비스. 앱은 이 객체만 쓴다.
 * - 처음 열 때 이전에 지정한 작업 폴더가 있으면 권한을 확인해 다시 연결한다(권한이 'prompt'면 버튼 한 번 필요)
 * - 폴더가 없으면 브라우저 내부 저장(IndexedDB)으로 동작한다
 * - 공유 저장소에 로그인하면 작품·공용은 공유로, 출력물은 그대로 로컬로 가는 혼합 백엔드가 된다
 */
class StorageService {
  private localBackend_: StorageBackend = new BrowserBackend();
  private remote_: StorageBackend | null = null;
  private backend_: StorageBackend = this.localBackend_;
  private repo = new Repository(this.backend_);
  private pendingHandle: FileSystemDirectoryHandle | null = null;

  get status(): StorageStatus {
    return {
      kind: this.backend_.kind,
      label: this.backend_.label,
      pendingFolder: this.pendingHandle?.name ?? null,
      localKind: this.localBackend_.kind === 'folder' ? 'folder' : 'browser',
      localLabel: this.localBackend_.label,
    };
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

  private rebuild(): void {
    this.backend_ = this.remote_ ? new HybridBackend(this.remote_, this.localBackend_) : this.localBackend_;
    this.repo = new Repository(this.backend_);
  }

  private useFolder(handle: FileSystemDirectoryHandle): void {
    this.localBackend_ = new FolderBackend(handle);
    this.pendingHandle = null;
    this.rebuild();
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
    this.localBackend_ = new BrowserBackend();
    this.pendingHandle = null;
    this.rebuild();
  }

  /** 공유 저장소 켜기(로그인 뒤): 작품·공용은 공유로, 출력물은 로컬로 */
  useRemote(remote: StorageBackend): void {
    this.remote_ = remote;
    this.rebuild();
  }

  /** 공유 저장소 끄기(로그아웃) */
  clearRemote(): void {
    this.remote_ = null;
    this.rebuild();
  }

  get remoteBackend(): StorageBackend | null {
    return this.remote_;
  }

  /** 로컬(작업 폴더 또는 브라우저) 백엔드. 올리기·내려받기용 */
  get localBackend(): StorageBackend {
    return this.localBackend_;
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

  /** 파일 단위 접근(출력물 보기 등) */
  get backend(): StorageBackend {
    return this.backend_;
  }
}

export const storage = new StorageService();
