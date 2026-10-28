import { splitPath, type StorageBackend } from './backend';

/** 메모리 백엔드: 시험과 이동 패키지 점검용. 경로 문자열을 키로 쓴다 */
export class MemoryBackend implements StorageBackend {
  readonly kind = 'browser' as const;
  readonly label = '메모리';
  readonly texts = new Map<string, string>();
  readonly bins = new Map<string, ArrayBuffer>();

  private key(path: string): string {
    const { dirs, name } = splitPath(path);
    return [...dirs, name].join('/');
  }

  async readText(path: string): Promise<string | null> {
    return this.texts.get(this.key(path)) ?? null;
  }

  async writeText(path: string, text: string): Promise<void> {
    this.texts.set(this.key(path), text);
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    return this.bins.get(this.key(path)) ?? null;
  }

  async writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    this.bins.set(this.key(path), data instanceof Blob ? await data.arrayBuffer() : data.slice(0));
  }

  async list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    const prefix = this.key(dir);
    const base = prefix ? `${prefix}/` : '';
    const seen = new Map<string, 'file' | 'directory'>();
    for (const k of [...this.texts.keys(), ...this.bins.keys()]) {
      if (!k.startsWith(base)) continue;
      const rest = k.slice(base.length);
      const slash = rest.indexOf('/');
      if (slash < 0) seen.set(rest, 'file');
      else seen.set(rest.slice(0, slash), 'directory');
    }
    return [...seen].map(([name, kind]) => ({ name, kind }));
  }

  async remove(path: string): Promise<void> {
    const k = this.key(path);
    this.texts.delete(k);
    this.bins.delete(k);
    for (const m of [this.texts, this.bins]) for (const key of [...m.keys()]) if (key.startsWith(`${k}/`)) m.delete(key);
  }

  async exists(path: string): Promise<boolean> {
    const k = this.key(path);
    if (this.texts.has(k) || this.bins.has(k)) return true;
    return (await this.list(path)).length > 0;
  }
}
