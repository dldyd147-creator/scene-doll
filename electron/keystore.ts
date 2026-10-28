/**
 * API 키 보관소. 키는 OS(윈도우 계정 DPAPI, Electron safeStorage)로 암호화한 바이트만 userData의 keys.json에 둔다.
 * 평문 키는 이 모듈 안에서 복호화해 어댑터 호출에 넘길 때만 메모리에 있고, 렌더러·로그·작업 폴더·깃에는 어떤 형태로도 나가지 않는다.
 * 암호화를 쓸 수 없으면(isEncryptionAvailable false) 저장을 거부한다 — 평문 저장으로 물러나지 않는다.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CryptoLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export interface KeyStore {
  status(): Promise<{ available: boolean; ids: string[] }>;
  set(id: string, key: string): Promise<{ ok: true } | { ok: false; reason: string }>;
  clear(id: string): Promise<void>;
  /** 메인 프로세스 안에서만 쓴다. 없으면 null */
  get(id: string): Promise<string | null>;
}

type Stored = Record<string, string>;

export function createKeyStore(dir: string, crypto: CryptoLike): KeyStore {
  const file = path.join(dir, 'keys.json');
  const read = async (): Promise<Stored> => {
    try {
      const v = JSON.parse(await fs.readFile(file, 'utf8')) as Stored;
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  };
  const write = async (s: Stored): Promise<void> => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(s), 'utf8');
  };
  return {
    async status() {
      return { available: crypto.isEncryptionAvailable(), ids: Object.keys(await read()) };
    },
    async set(id, key) {
      if (!crypto.isEncryptionAvailable()) return { ok: false, reason: '이 PC에서 윈도우 계정 암호화를 쓸 수 없어 키를 저장하지 않았습니다' };
      if (!/^[\w.-]{1,64}$/.test(id)) return { ok: false, reason: '항목 id가 올바르지 않습니다' };
      const s = await read();
      s[id] = crypto.encryptString(key).toString('base64');
      await write(s);
      return { ok: true };
    },
    async clear(id) {
      const s = await read();
      if (id in s) {
        delete s[id];
        await write(s);
      }
    },
    async get(id) {
      const s = await read();
      if (!s[id] || !crypto.isEncryptionAvailable()) return null;
      try {
        return crypto.decryptString(Buffer.from(s[id], 'base64'));
      } catch {
        return null; // 다른 윈도우 계정/PC에서 복사한 파일 등 — 복호화 불가
      }
    },
  };
}
