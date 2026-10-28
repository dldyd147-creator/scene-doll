import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKeyStore, type CryptoLike } from './keystore';
import { createWorkFs, PathError } from './workFs';
import { runGeneration } from './generate';

let dir = '';
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenedoll-test-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('작업 폴더 입출력', () => {
  it('한글 경로로 쓰고 읽고 목록·삭제', async () => {
    const w = createWorkFs(dir);
    await w.writeText('작품/ACS/작품.json', '{"a":1}');
    await w.writeBinary('작품/ACS/회차/001/썸네일/001.png', new Uint8Array([1, 2, 3]));
    expect(await w.readText('작품/ACS/작품.json')).toBe('{"a":1}');
    expect(Array.from((await w.readBinary('작품/ACS/회차/001/썸네일/001.png'))!)).toEqual([1, 2, 3]);
    expect(await w.readText('없음.json')).toBeNull();
    expect((await w.list('작품/ACS')).map((e) => `${e.name}:${e.kind}`).sort()).toEqual(['작품.json:file', '회차:directory']);
    expect(await w.list('없는폴더')).toEqual([]);
    expect(await w.exists('작품/ACS')).toBe(true);
    await w.remove('작품/ACS');
    expect(await w.exists('작품/ACS')).toBe(false);
  });
  it('덮어쓰기 뒤 임시 파일이 남지 않는다', async () => {
    const w = createWorkFs(dir);
    await w.writeText('a.json', '1');
    await w.writeText('a.json', '2');
    expect(await w.readText('a.json')).toBe('2');
    expect((await w.list('')).map((e) => e.name)).toEqual(['a.json']);
  });
  it('작업 폴더 밖 경로를 거부한다', async () => {
    const w = createWorkFs(dir);
    await expect(w.readText('../x')).rejects.toBeInstanceOf(PathError);
    await expect(w.writeText('a/../../x', 't')).rejects.toBeInstanceOf(PathError);
    await expect(w.writeText('C:/x', 't')).rejects.toBeInstanceOf(PathError);
    await expect(w.writeText('\\\\서버\\공유', 't')).rejects.toBeInstanceOf(PathError);
    await expect(w.remove('')).rejects.toBeInstanceOf(PathError);
  });
});

// 가짜 암호화(실제는 윈도우 DPAPI): 글자를 뒤집고 접두를 붙여 평문과 달라 보이게 한다
const fakeCrypto = (available = true): CryptoLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`ENC:${[...s].reverse().join('')}`),
  decryptString: (b) => [...b.toString().slice(4)].reverse().join(''),
});

describe('키 보관소', () => {
  it('저장한 키는 평문으로 파일에 남지 않고, 메인에서만 복호화된다', async () => {
    const ks = createKeyStore(dir, fakeCrypto());
    expect(await ks.set('bfl-flux3', 'bfl-SECRET-KEY-12345')).toEqual({ ok: true });
    const file = await fs.readFile(path.join(dir, 'keys.json'), 'utf8');
    expect(file).not.toContain('SECRET');
    expect(file).not.toContain('bfl-SECRET');
    expect(await ks.get('bfl-flux3')).toBe('bfl-SECRET-KEY-12345');
    expect((await ks.status()).ids).toEqual(['bfl-flux3']);
    expect(JSON.stringify(await ks.status())).not.toContain('SECRET');
    await ks.clear('bfl-flux3');
    expect(await ks.get('bfl-flux3')).toBeNull();
    expect((await ks.status()).ids).toEqual([]);
  });
  it('암호화를 쓸 수 없으면 저장을 거부한다(평문으로 물러나지 않음)', async () => {
    const ks = createKeyStore(dir, fakeCrypto(false));
    const r = await ks.set('x', 'abcdefgh12345');
    expect(r.ok).toBe(false);
    await expect(fs.access(path.join(dir, 'keys.json'))).rejects.toThrow();
  });
  it('복호화가 안 되는 파일은 키 없음으로 본다', async () => {
    const ks = createKeyStore(dir, fakeCrypto());
    await fs.writeFile(path.join(dir, 'keys.json'), JSON.stringify({ a: 'zzzz' }));
    const broken: CryptoLike = { ...fakeCrypto(), decryptString: () => { throw new Error('bad'); } };
    expect(await createKeyStore(dir, broken).get('a')).toBeNull();
    expect((await ks.status()).ids).toEqual(['a']);
  });
});

describe('생성 IPC', () => {
  it('키가 없으면 설정 안내, 있으면 어댑터를 부르고 오류 문구에서 키를 지운다', async () => {
    const ks = createKeyStore(dir, fakeCrypto());
    const req = { requestId: 'r1', apiId: 'venice-flux3', service: 'venice', model: 'flux-3-image-edit', prompt: 'p', images: [{ name: 'a.png', data: new Uint8Array([1]).buffer, mime: 'image/png' }], size: '1024x1024', n: 1, quality: 'auto' };
    const none = await runGeneration(req, ks);
    expect(none).toMatchObject({ ok: false, kind: 'config' });
    await ks.set('venice-flux3', 'venice-SECRET-9999');
    const leaky = (async () => new Response('bad key venice-SECRET-9999', { status: 401 })) as typeof fetch;
    const r = await runGeneration(req, ks, leaky);
    expect(r).toMatchObject({ ok: false, kind: 'auth' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
    const good = (async () => new Response(new Uint8Array([5, 6]), { headers: { 'Content-Type': 'image/png' } })) as typeof fetch;
    const ok = await runGeneration(req, ks, good);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(new Uint8Array(ok.images[0])).toEqual(new Uint8Array([5, 6]));
  });
});
