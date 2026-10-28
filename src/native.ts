/**
 * 데스크톱(Electron) 연결부. preload가 window.sceneDollNative를 노출하면 데스크톱, 없으면 웹 배포판이다.
 * 화면 코드는 이 파일의 타입만 알고 Electron을 직접 import하지 않는다.
 */
export interface NativeGenImage {
  name: string;
  data: ArrayBuffer;
  mime: string;
}

export interface NativeGenRequest {
  /** 취소용 식별자 */
  requestId: string;
  /** 목록 항목 id (메인 프로세스가 키를 찾는 열쇠) */
  apiId: string;
  service: string;
  model: string;
  baseUrl?: string;
  prompt: string;
  images: NativeGenImage[];
  size: string;
  n: number;
  quality: string;
  inputFidelity?: 'high' | 'low';
}

export type NativeGenResponse =
  | { ok: true; images: ArrayBuffer[]; mime: string; model: string; usage?: Record<string, unknown>; costCredits?: number }
  | { ok: false; kind: string; message: string };

export interface NativeKeyStatus {
  /** OS 암호화(DPAPI)를 쓸 수 있는가 */
  available: boolean;
  /** 키가 저장된 항목 id들 */
  ids: string[];
}

export interface SceneDollNative {
  version: string;
  workDir: {
    get(): Promise<string | null>;
    suggest(): Promise<string>;
    /** 폴더 선택 창 → 고르면 경로(작업 폴더로 지정됨), 취소하면 null */
    choose(): Promise<string | null>;
    reveal(): Promise<void>;
  };
  fs: {
    readText(path: string): Promise<string | null>;
    writeText(path: string, text: string): Promise<void>;
    readBinary(path: string): Promise<ArrayBuffer | null>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>>;
    remove(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
  };
  keys: {
    status(): Promise<NativeKeyStatus>;
    set(apiId: string, key: string): Promise<{ ok: true } | { ok: false; reason: string }>;
    clear(apiId: string): Promise<void>;
  };
  generate: {
    run(req: NativeGenRequest): Promise<NativeGenResponse>;
    cancel(requestId: string): Promise<void>;
  };
  dialog: {
    /** 저장 대화상자 → 저장한 경로(취소는 null) */
    saveFile(defaultName: string, data: ArrayBuffer, filterName: string, ext: string): Promise<string | null>;
    openFile(filterName: string, ext: string): Promise<{ name: string; data: ArrayBuffer } | null>;
  };
}

declare global {
  interface Window {
    sceneDollNative?: SceneDollNative;
  }
}

export const native: SceneDollNative | null = typeof window !== 'undefined' ? (window.sceneDollNative ?? null) : null;
export const isDesktop = native !== null;
