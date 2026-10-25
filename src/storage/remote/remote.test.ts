import { describe, expect, it } from 'vitest';
import type { StorageBackend } from '../backend';
import { HybridBackend, isRemotePath } from './hybridBackend';
import { canTake, episodeLockPath, isStale } from './locks';
import { childrenOf } from './remoteBackend';
import { copyTree, isTextPath, walk } from './sync';
import { isEmail } from './members';

/** 시험용 메모리 백엔드 */
class MemoryBackend implements StorageBackend {
  readonly kind = 'browser' as const;
  readonly label = 'memory';
  texts = new Map<string, string>();
  bins = new Map<string, ArrayBuffer>();
  async readText(p: string) {
    return this.texts.get(p) ?? null;
  }
  async writeText(p: string, t: string) {
    this.texts.set(p, t);
  }
  async readBinary(p: string) {
    return this.bins.get(p) ?? null;
  }
  async writeBinary(p: string, d: ArrayBuffer | Blob) {
    this.bins.set(p, d instanceof Blob ? await d.arrayBuffer() : d);
  }
  async list(dir: string) {
    return childrenOf([...this.texts.keys(), ...this.bins.keys()], dir);
  }
  async remove(p: string) {
    for (const k of [...this.texts.keys()]) if (k === p || k.startsWith(p + '/')) this.texts.delete(k);
    for (const k of [...this.bins.keys()]) if (k === p || k.startsWith(p + '/')) this.bins.delete(k);
  }
  async exists(p: string) {
    return this.texts.has(p) || this.bins.has(p) || [...this.texts.keys(), ...this.bins.keys()].some((k) => k.startsWith(p + '/'));
  }
}

describe('공유 저장소 경로', () => {
  it('평평한 경로 목록에서 바로 아래 항목을 만든다', () => {
    const paths = ['작품/ACS/작품.json', '작품/ACS/회차/001/회차.json', '작품/ACS/회차/001/컷/001.json', '작품/TST/작품.json', '공용/씬/a.json'];
    expect(childrenOf(paths, '작품').map((c) => `${c.kind}:${c.name}`).sort()).toEqual(['directory:ACS', 'directory:TST']);
    expect(childrenOf(paths, '작품/ACS').map((c) => `${c.kind}:${c.name}`).sort()).toEqual(['directory:회차', 'file:작품.json']);
    expect(childrenOf(paths, '작품/ACS/회차/001/컷')).toEqual([{ name: '001.json', kind: 'file' }]);
    expect(childrenOf(paths, '없음')).toEqual([]);
  });

  it('작품·공용은 공유로, 출력·패키지·생성은 로컬로 간다', () => {
    expect(isRemotePath('작품/ACS/작품.json')).toBe(true);
    expect(isRemotePath('작품')).toBe(true);
    expect(isRemotePath('공용/씬/x.json')).toBe(true);
    expect(isRemotePath('출력/ACS/001/a.png')).toBe(false);
    expect(isRemotePath('패키지/ACS/001/회차.json')).toBe(false);
    expect(isRemotePath('생성/ACS/001/001/cand_1.png')).toBe(false);
  });

  it('혼합 백엔드는 경로에 따라 나눠 쓴다', async () => {
    const remote = new MemoryBackend();
    const local = new MemoryBackend();
    const h = new HybridBackend(remote, local);
    await h.writeText('작품/ACS/작품.json', '{}');
    await h.writeText('출력/ACS/001/ACS_001.md', '# md');
    expect(remote.texts.has('작품/ACS/작품.json')).toBe(true);
    expect(local.texts.has('작품/ACS/작품.json')).toBe(false);
    expect(local.texts.has('출력/ACS/001/ACS_001.md')).toBe(true);
    expect(await h.readText('출력/ACS/001/ACS_001.md')).toBe('# md');
    expect((await h.list('작품')).map((c) => c.name)).toEqual(['ACS']);
  });
});

describe('회차 잠금', () => {
  const lock = (userId: string, ageMs: number) => ({ path: episodeLockPath('ACS', 12), userId, userEmail: null, lockedAt: new Date(Date.now() - ageMs).toISOString(), heartbeatAt: new Date(Date.now() - ageMs).toISOString() });

  it('경로는 작품/코드/회차/번호', () => {
    expect(episodeLockPath('ACS', 12)).toBe('작품/ACS/회차/012');
  });

  it('비었거나 내 것이거나 죽은 잠금은 잡을 수 있다', () => {
    expect(canTake(null, 'me')).toBe(true);
    expect(canTake(lock('me', 1000), 'me')).toBe(true);
    expect(canTake(lock('other', 1000), 'me')).toBe(false);
    expect(canTake(lock('other', 6 * 60_000), 'me')).toBe(true);
    expect(isStale(lock('other', 4 * 60_000))).toBe(false);
    expect(isStale({ heartbeatAt: 'not a date' })).toBe(true);
  });
});

describe('올리기·내려받기', () => {
  it('텍스트와 이진을 구분해 폴더째 복사하고 있는 것은 건너뛴다', async () => {
    const src = new MemoryBackend();
    const dst = new MemoryBackend();
    await src.writeText('작품/ACS/작품.json', '{"code":"ACS"}');
    await src.writeText('작품/ACS/캐릭터/c1.json', '{}');
    await src.writeBinary('작품/ACS/캐릭터/c1/레퍼런스/face.png', new Uint8Array([1, 2, 3]).buffer);
    await dst.writeText('작품/ACS/작품.json', 'old');
    expect(isTextPath('a/b.json')).toBe(true);
    expect(isTextPath('a/b.png')).toBe(false);
    expect((await walk(src, '작품/ACS')).length).toBe(3);
    const p = await copyTree(src, dst, '작품/ACS');
    expect(p.copied).toBe(2);
    expect(p.skipped).toBe(1);
    expect(p.failed).toEqual([]);
    expect(await dst.readText('작품/ACS/작품.json')).toBe('old');
    expect(new Uint8Array((await dst.readBinary('작품/ACS/캐릭터/c1/레퍼런스/face.png'))!)).toEqual(new Uint8Array([1, 2, 3]));
    const p2 = await copyTree(src, dst, '작품/ACS', { overwrite: true });
    expect(p2.copied).toBe(3);
    expect(await dst.readText('작품/ACS/작품.json')).toBe('{"code":"ACS"}');
  });
});

describe('구성원', () => {
  it('이메일 꼴만 추가 버튼이 켜진다(앞뒤 공백은 무시)', () => {
    expect(isEmail(' a@b.co ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.d')).toBe(false);
    expect(isEmail('')).toBe(false);
  });
});
