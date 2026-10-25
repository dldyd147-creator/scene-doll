/**
 * 저장소 백엔드 인터페이스.
 * 화면·3D·데이터 구조는 이 인터페이스만 알고, 실제 저장 방식(작업 폴더 / 브라우저 내부 / 서버리스)은 구현이 정한다.
 * 경로는 '/'로 구분한 상대 경로(예: 작품/ACS/작품.json).
 */
export type BackendKind = 'folder' | 'browser' | 'remote';

export interface StorageBackend {
  readonly kind: BackendKind;
  readonly label: string;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer | null>;
  writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void>;
  /** 디렉터리의 바로 아래 항목 이름들(없으면 빈 배열) */
  list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter((p) => p.length > 0);
  const name = parts.pop() ?? '';
  return { dirs: parts, name };
}

export const pad3 = (n: number): string => String(n).padStart(3, '0');
