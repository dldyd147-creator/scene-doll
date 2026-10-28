import type { StorageBackend } from './backend';
import type { SceneDollNative } from '../native';

/**
 * 데스크톱(Electron) 작업 폴더. 읽고 쓰기는 메인 프로세스가 Node fs로 한다(IPC).
 * 권한 확인·IndexedDB·핸들 저장이 필요 없고, 쓰기는 임시 파일 뒤 이름 바꾸기라 끊겨도 파일이 깨지지 않는다.
 */
export class ElectronBackend implements StorageBackend {
  readonly kind = 'folder' as const;

  constructor(
    private readonly api: SceneDollNative,
    private readonly folderLabel: string,
  ) {}

  get label(): string {
    return this.folderLabel;
  }

  readText(path: string): Promise<string | null> {
    return this.api.fs.readText(path);
  }

  writeText(path: string, text: string): Promise<void> {
    return this.api.fs.writeText(path, text);
  }

  readBinary(path: string): Promise<ArrayBuffer | null> {
    return this.api.fs.readBinary(path);
  }

  async writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    await this.api.fs.writeBinary(path, data instanceof Blob ? await data.arrayBuffer() : data);
  }

  list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    return this.api.fs.list(dir);
  }

  remove(path: string): Promise<void> {
    return this.api.fs.remove(path);
  }

  exists(path: string): Promise<boolean> {
    return this.api.fs.exists(path);
  }
}

/** 경로의 마지막 폴더 이름(윈도우 \ 또는 /) */
export function folderNameOf(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}
