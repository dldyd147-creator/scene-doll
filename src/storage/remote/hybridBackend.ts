import type { StorageBackend } from '../backend';

/** 공유 저장소로 가는 경로. 그 밖(출력/, 패키지/, 생성/)은 각자 로컬에 남는다 */
export const REMOTE_PREFIXES = ['작품/', '공용/'];

export function isRemotePath(path: string): boolean {
  const p = path.replace(/^\/+/, '');
  return REMOTE_PREFIXES.some((pre) => p === pre.slice(0, -1) || p.startsWith(pre));
}

/**
 * 로그인했을 때 쓰는 백엔드: 작품·공용은 공유 저장소에, 출력물·패키지·생성 결과는 로컬(작업 폴더/브라우저)에.
 * 기획서대로 출력 PNG는 올리지 않는다.
 */
export class HybridBackend implements StorageBackend {
  readonly kind = 'remote' as const;

  constructor(
    readonly remote: StorageBackend,
    readonly local: StorageBackend,
  ) {}

  get label(): string {
    return this.remote.label;
  }

  private pick(path: string): StorageBackend {
    return isRemotePath(path) ? this.remote : this.local;
  }

  readText(path: string): Promise<string | null> {
    return this.pick(path).readText(path);
  }

  writeText(path: string, text: string): Promise<void> {
    return this.pick(path).writeText(path, text);
  }

  readBinary(path: string): Promise<ArrayBuffer | null> {
    return this.pick(path).readBinary(path);
  }

  writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    return this.pick(path).writeBinary(path, data);
  }

  list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    return this.pick(dir).list(dir);
  }

  remove(path: string): Promise<void> {
    return this.pick(path).remove(path);
  }

  exists(path: string): Promise<boolean> {
    return this.pick(path).exists(path);
  }
}
