import { splitPath, type StorageBackend } from './backend';
import { idbDelete, idbGet, idbKeys, idbPut, openDb } from './idb';

interface FileRecord {
  path: string;
  text?: string;
  bin?: ArrayBuffer;
  mtime: number;
}

const DB_NAME = 'scene-doll-files';
const STORE = 'files';

/**
 * 작업 폴더를 지정하지 않았을 때 쓰는 브라우저 내부 저장소(IndexedDB).
 * 경로를 키로 파일을 저장한다. 폴더 지정 전 체험용이며, 탐색기에서는 보이지 않는다.
 */
export class BrowserBackend implements StorageBackend {
  readonly kind = 'browser' as const;
  readonly label = '브라우저 내부 저장';
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = openDb(DB_NAME, 1, (db) => {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'path' });
    });
  }

  private norm(path: string): string {
    const { dirs, name } = splitPath(path);
    return [...dirs, name].join('/');
  }

  async readText(path: string): Promise<string | null> {
    const rec = await idbGet<FileRecord>(await this.dbPromise, STORE, this.norm(path));
    return rec?.text ?? null;
  }

  async writeText(path: string, text: string): Promise<void> {
    const rec: FileRecord = { path: this.norm(path), text, mtime: Date.now() };
    await idbPut(await this.dbPromise, STORE, rec);
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const rec = await idbGet<FileRecord>(await this.dbPromise, STORE, this.norm(path));
    return rec?.bin ?? null;
  }

  async writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    const bin = data instanceof Blob ? await data.arrayBuffer() : data;
    const rec: FileRecord = { path: this.norm(path), bin, mtime: Date.now() };
    await idbPut(await this.dbPromise, STORE, rec);
  }

  async list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    const prefix = this.norm(dir + '/x').slice(0, -1); // 'a/b/'
    const keys = (await idbKeys(await this.dbPromise, STORE, IDBKeyRange.bound(prefix, prefix + '￿'))) as string[];
    const out = new Map<string, 'file' | 'directory'>();
    for (const k of keys) {
      const rest = k.slice(prefix.length);
      const i = rest.indexOf('/');
      if (i < 0) out.set(rest, 'file');
      else out.set(rest.slice(0, i), 'directory');
    }
    return [...out.entries()].map(([name, kind]) => ({ name, kind }));
  }

  async remove(path: string): Promise<void> {
    const db = await this.dbPromise;
    const p = this.norm(path);
    await idbDelete(db, STORE, p);
    // 디렉터리라면 그 아래 전부
    const keys = (await idbKeys(db, STORE, IDBKeyRange.bound(p + '/', p + '/￿'))) as string[];
    for (const k of keys) await idbDelete(db, STORE, k);
  }

  async exists(path: string): Promise<boolean> {
    return (await idbGet<FileRecord>(await this.dbPromise, STORE, this.norm(path))) !== undefined;
  }
}
