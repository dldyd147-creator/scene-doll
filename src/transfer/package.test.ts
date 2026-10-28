import { describe, expect, it } from 'vitest';
import { MemoryBackend } from '../storage/memoryBackend';
import { applyImport, buildPackage, defaultChoices, openPackage, summarizePackage } from './package';

const png = (n: number): ArrayBuffer => new Uint8Array([137, 80, 78, 71, n, n, n]).buffer;
const j = (v: unknown): string => JSON.stringify(v);

async function seed(b: MemoryBackend, stamp: string, tag: string): Promise<void> {
  await b.writeText('작품/ACS/작품.json', j({ code: 'ACS', name: `작품${tag}`, updatedAt: stamp }));
  await b.writeText('작품/ACS/캐릭터/c1.json', j({ id: 'c1', workCode: 'ACS', name: `이름${tag}`, temporary: false, updatedAt: stamp }));
  await b.writeText('작품/ACS/캐릭터/tmp.json', j({ id: 'tmp', workCode: 'ACS', temporary: true, updatedAt: stamp }));
  await b.writeBinary('작품/ACS/캐릭터/c1/레퍼런스/front.png', png(tag === 'A' ? 1 : 2));
  await b.writeText('작품/ACS/회차/001/회차.json', j({ workCode: 'ACS', number: 1, updatedAt: stamp }));
  await b.writeText('작품/ACS/회차/001/컷/001.json', j({ number: 1, updatedAt: stamp, tag }));
  await b.writeBinary('작품/ACS/회차/001/썸네일/001.png', png(tag === 'A' ? 3 : 4));
  await b.writeText('공용/씬/s1.json', j({ id: 's1', name: `씬${tag}`, updatedAt: stamp }));
  await b.writeBinary('공용/씬/s1.png', png(tag === 'A' ? 5 : 6));
  await b.writeBinary('생성/ACS/001/001/cand_1.png', png(7));
  await b.writeText('생성/연결설정.json', j({ genToken: 'SECRET-TOKEN' }));
  await b.writeBinary('출력/ACS/001/ACS_001_001.png', png(8));
}

describe('이동 패키지 왕복', () => {
  it('내보내기 요약·제외 파일·옵션', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-02-01T00:00:00.000Z', 'A');
    const { data, manifest } = await buildPackage(a, { works: ['ACS'], shared: true, generated: false, output: false });
    expect(manifest.works[0]).toMatchObject({ code: 'ACS', name: '작품A', episodes: 1, characters: 1 });
    expect(manifest.shared.scenes).toBe(1);
    const pkg = openPackage(data);
    expect([...pkg.files.keys()].some((p) => p.startsWith('생성/') || p.startsWith('출력/'))).toBe(false);
    expect([...pkg.files.keys()].some((p) => p.includes('연결설정'))).toBe(false);
    const withAll = openPackage((await buildPackage(a, { works: ['ACS'], shared: false, generated: true, output: true })).data);
    expect(withAll.files.has('생성/ACS/001/001/cand_1.png')).toBe(true);
    expect(withAll.files.has('출력/ACS/001/ACS_001_001.png')).toBe(true);
    expect(withAll.files.has('공용/씬/s1.json')).toBe(false);
    expect([...withAll.files.values()].every((v) => !new TextDecoder().decode(v).includes('SECRET-TOKEN'))).toBe(true);
  });

  it('빈 폴더로 불러오면 전부 추가되고 내용이 같다', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-02-01T00:00:00.000Z', 'A');
    const pkg = openPackage((await buildPackage(a, { works: ['ACS'], shared: true, generated: true, output: true })).data);
    const b = new MemoryBackend();
    const sum = await summarizePackage(b, pkg);
    expect(sum.works[0].conflict).toBe(false);
    expect(sum.characters).toBe(1);
    const res = await applyImport(b, pkg, { choices: defaultChoices(sum, new Set()), shared: true });
    expect(res.added).toBe(pkg.files.size);
    expect(await b.readText('작품/ACS/캐릭터/c1.json')).toBe(await a.readText('작품/ACS/캐릭터/c1.json'));
    expect(new Uint8Array((await b.readBinary('공용/씬/s1.png'))!)).toEqual(new Uint8Array(png(5)));
  });

  it('합치기: 새로운 쪽이 이기고 보조 파일이 따라간다', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-06-01T00:00:00.000Z', 'A'); // 패키지(새로움)
    const b = new MemoryBackend();
    await seed(b, '2026-01-01T00:00:00.000Z', 'B'); // 기존(오래됨)
    const pkg = openPackage((await buildPackage(a, { works: ['ACS'], shared: true, generated: false, output: false })).data);
    const sum = await summarizePackage(b, pkg);
    expect(sum.works[0].conflict).toBe(true);
    await applyImport(b, pkg, { choices: { ACS: { policy: 'merge' } }, shared: true });
    expect(JSON.parse((await b.readText('작품/ACS/작품.json'))!).name).toBe('작품A');
    expect(new Uint8Array((await b.readBinary('공용/씬/s1.png'))!)).toEqual(new Uint8Array(png(5)));
    expect(new Uint8Array((await b.readBinary('작품/ACS/캐릭터/c1/레퍼런스/front.png'))!)).toEqual(new Uint8Array(png(1)));
  });

  it('합치기: 기존이 더 새로우면 유지한다', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-01-01T00:00:00.000Z', 'A');
    const b = new MemoryBackend();
    await seed(b, '2026-06-01T00:00:00.000Z', 'B');
    const pkg = openPackage((await buildPackage(a, { works: ['ACS'], shared: true, generated: false, output: false })).data);
    const res = await applyImport(b, pkg, { choices: { ACS: { policy: 'merge' } }, shared: true });
    expect(JSON.parse((await b.readText('작품/ACS/작품.json'))!).name).toBe('작품B');
    expect(new Uint8Array((await b.readBinary('공용/씬/s1.png'))!)).toEqual(new Uint8Array(png(6)));
    expect(res.kept).toBeGreaterThan(0);
  });

  it('건너뛰기·덮어쓰기', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-01-01T00:00:00.000Z', 'A');
    const pkg = openPackage((await buildPackage(a, { works: ['ACS'], shared: false, generated: false, output: false })).data);
    const b = new MemoryBackend();
    await seed(b, '2026-06-01T00:00:00.000Z', 'B');
    const skip = await applyImport(b, pkg, { choices: { ACS: { policy: 'skip' } }, shared: false });
    expect(skip.skippedWorks).toEqual(['ACS']);
    expect(JSON.parse((await b.readText('작품/ACS/작품.json'))!).name).toBe('작품B');
    await applyImport(b, pkg, { choices: { ACS: { policy: 'overwrite' } }, shared: false });
    expect(JSON.parse((await b.readText('작품/ACS/작품.json'))!).name).toBe('작품A');
  });

  it('둘 다 남기기: 새 코드로 경로·JSON이 바뀌고 기존은 그대로', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-01-01T00:00:00.000Z', 'A');
    const pkg = openPackage((await buildPackage(a, { works: ['ACS'], shared: false, generated: true, output: false })).data);
    const b = new MemoryBackend();
    await seed(b, '2026-06-01T00:00:00.000Z', 'B');
    const res = await applyImport(b, pkg, { choices: { ACS: { policy: 'rename', newCode: 'ACT' } }, shared: false });
    expect(res.renamed).toEqual([{ from: 'ACS', to: 'ACT' }]);
    const w = JSON.parse((await b.readText('작품/ACT/작품.json'))!);
    expect(w).toMatchObject({ code: 'ACT', name: '작품A' });
    expect(JSON.parse((await b.readText('작품/ACT/캐릭터/c1.json'))!).workCode).toBe('ACT');
    expect(await b.exists('생성/ACT/001/001/cand_1.png')).toBe(true);
    expect(JSON.parse((await b.readText('작품/ACS/작품.json'))!).name).toBe('작품B');
  });

  it('이미 있는 코드로 바꾸기·형식 오류는 거부', async () => {
    const a = new MemoryBackend();
    await seed(a, '2026-01-01T00:00:00.000Z', 'A');
    const pkg = openPackage((await buildPackage(a, { works: ['ACS'], shared: false, generated: false, output: false })).data);
    const b = new MemoryBackend();
    await seed(b, '2026-06-01T00:00:00.000Z', 'B');
    await expect(applyImport(b, pkg, { choices: { ACS: { policy: 'rename', newCode: 'ACS' } }, shared: false })).rejects.toThrow();
    expect(() => openPackage(new Uint8Array([1, 2, 3]))).toThrow();
  });
});
