import { splitPath, type StorageBackend } from './backend';
import { idbDelete, idbGet, idbPut, openDb } from './idb';

const HANDLE_DB = 'scene-doll-handles';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'workFolder';

export function folderAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function handleDb(): Promise<IDBDatabase> {
  return openDb(HANDLE_DB, 1, (db) => {
    if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
  });
}

export async function saveFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbPut(await handleDb(), HANDLE_STORE, handle, HANDLE_KEY);
}

export async function loadFolderHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idbGet<FileSystemDirectoryHandle>(await handleDb(), HANDLE_STORE, HANDLE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function forgetFolderHandle(): Promise<void> {
  await idbDelete(await handleDb(), HANDLE_STORE, HANDLE_KEY);
}

/**
 * 크롬·엣지의 폴더 접근 기능(File System Access API)으로 사용자가 지정한 작업 폴더에 직접 읽고 쓴다.
 * 저장된 파일은 탐색기에서 그대로 보인다.
 */
export class FolderBackend implements StorageBackend {
  readonly kind = 'folder' as const;

  constructor(private root: FileSystemDirectoryHandle) {}

  get label(): string {
    return this.root.name;
  }

  private async dir(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let d = this.root;
    for (const s of segments) {
      try {
        d = await d.getDirectoryHandle(s, { create });
      } catch {
        return null;
      }
    }
    return d;
  }

  async readText(path: string): Promise<string | null> {
    const { dirs, name } = splitPath(path);
    const d = await this.dir(dirs, false);
    if (!d) return null;
    try {
      const fh = await d.getFileHandle(name);
      return await (await fh.getFile()).text();
    } catch {
      return null;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.write(path, text);
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const { dirs, name } = splitPath(path);
    const d = await this.dir(dirs, false);
    if (!d) return null;
    try {
      const fh = await d.getFileHandle(name);
      return await (await fh.getFile()).arrayBuffer();
    } catch {
      return null;
    }
  }

  async writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    await this.write(path, data);
  }

  private async write(path: string, data: string | ArrayBuffer | Blob): Promise<void> {
    const { dirs, name } = splitPath(path);
    const d = await this.dir(dirs, true);
    if (!d) throw new Error(`폴더를 만들 수 없습니다: ${dirs.join('/')}`);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(data);
    } finally {
      await w.close();
    }
  }

  async list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    const segments = dir.split('/').filter(Boolean);
    const d = await this.dir(segments, false);
    if (!d) return [];
    const out: Array<{ name: string; kind: 'file' | 'directory' }> = [];
    for await (const [name, handle] of d.entries()) out.push({ name, kind: handle.kind });
    return out;
  }

  async remove(path: string): Promise<void> {
    const { dirs, name } = splitPath(path);
    const d = await this.dir(dirs, false);
    if (!d) return;
    try {
      await d.removeEntry(name, { recursive: true });
    } catch {
      /* 없으면 무시 */
    }
  }

  async exists(path: string): Promise<boolean> {
    const { dirs, name } = splitPath(path);
    const d = await this.dir(dirs, false);
    if (!d) return false;
    try {
      await d.getFileHandle(name);
      return true;
    } catch {
      try {
        await d.getDirectoryHandle(name);
        return true;
      } catch {
        return false;
      }
    }
  }
}
