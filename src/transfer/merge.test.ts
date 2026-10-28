import { describe, expect, it } from 'vitest';
import { decideFile, isSafePath, ownerOf, packageWins, renameWorkPath, rewriteWorkCodeJson, suggestCode } from './merge';

describe('경로 검증', () => {
  it('상위 이동·절대 경로·역슬래시를 거부한다', () => {
    expect(isSafePath('작품/ACS/작품.json')).toBe(true);
    expect(isSafePath('../x')).toBe(false);
    expect(isSafePath('작품/../x')).toBe(false);
    expect(isSafePath('/etc/passwd')).toBe(false);
    expect(isSafePath('C:/x')).toBe(false);
    expect(isSafePath('a\\b')).toBe(false);
    expect(isSafePath('a//b')).toBe(false);
  });
});

describe('주인 파일', () => {
  it('썸네일·GLB·레퍼런스·컷 썸네일은 주인 JSON을 따른다', () => {
    expect(ownerOf('공용/씬/s1.png')).toBe('공용/씬/s1.json');
    expect(ownerOf('공용/소품/p1.glb')).toBe('공용/소품/p1.json');
    expect(ownerOf('작품/ACS/캐릭터/c1/레퍼런스/a.png')).toBe('작품/ACS/캐릭터/c1.json');
    expect(ownerOf('작품/ACS/회차/001/썸네일/002.png')).toBe('작품/ACS/회차/001/컷/002.json');
    expect(ownerOf('생성/ACS/001/002/cand_1.png')).toBeNull();
    expect(ownerOf('작품/ACS/작품.json')).toBeNull();
  });
});

describe('합치기 승패', () => {
  const old = { exists: true, updatedAt: '2026-01-01T00:00:00.000Z' };
  const mid = { exists: true, updatedAt: '2026-06-01T00:00:00.000Z' };
  it('updatedAt이 새로운 쪽이 이긴다', () => {
    expect(packageWins(mid, old, 'merge')).toBe(true);
    expect(packageWins(old, mid, 'merge')).toBe(false);
  });
  it('같거나 한쪽이 없으면 기존 유지', () => {
    expect(packageWins(old, old, 'merge')).toBe(false);
    expect(packageWins({ exists: true }, old, 'merge')).toBe(false);
    expect(packageWins(old, { exists: true }, 'merge')).toBe(false);
  });
  it('기존에 없으면 항상 가져온다, 덮어쓰기는 항상 패키지, 건너뛰기는 항상 기존', () => {
    expect(packageWins(old, { exists: false }, 'merge')).toBe(true);
    expect(packageWins(old, mid, 'overwrite')).toBe(true);
    expect(packageWins(mid, old, 'skip')).toBe(false);
  });
  it('보조 파일은 주인의 승패를 따르고, 주인 없는 이진 파일은 기존 유지', () => {
    const bin = { exists: true };
    expect(decideFile(bin, bin, 'merge', true)).toBe('copy-newer');
    expect(decideFile(bin, bin, 'merge', false)).toBe('keep');
    expect(decideFile(bin, bin, 'merge', undefined)).toBe('keep');
    expect(decideFile(bin, bin, 'overwrite', undefined)).toBe('copy-overwrite');
    expect(decideFile(bin, { exists: false }, 'merge', undefined)).toBe('copy-new');
    expect(decideFile(bin, { exists: false }, 'merge', false)).toBe('keep');
  });
});

describe('둘 다 남기기', () => {
  it('경로의 작품 코드만 바꾼다', () => {
    expect(renameWorkPath('작품/ACS/작품.json', 'ACS', 'ACT')).toBe('작품/ACT/작품.json');
    expect(renameWorkPath('생성/ACS/001/002/cand_1.png', 'ACS', 'ACT')).toBe('생성/ACT/001/002/cand_1.png');
    expect(renameWorkPath('공용/씬/ACS.json', 'ACS', 'ACT')).toBe('공용/씬/ACS.json');
  });
  it('JSON의 작품 코드·경로 문자열을 바꾼다', () => {
    const w = JSON.parse(rewriteWorkCodeJson(JSON.stringify({ code: 'ACS', name: '작품' }), 'ACS', 'ACT'));
    expect(w.code).toBe('ACT');
    const cut = JSON.parse(rewriteWorkCodeJson(JSON.stringify({ number: 1, generatedImages: ['생성/ACS/001/001/cand_1.png'] }), 'ACS', 'ACT'));
    expect(cut.generatedImages[0]).toBe('생성/ACT/001/001/cand_1.png');
    const ch = JSON.parse(rewriteWorkCodeJson(JSON.stringify({ id: 'c1', workCode: 'ACS' }), 'ACS', 'ACT'));
    expect(ch.workCode).toBe('ACT');
  });
  it('쓰이지 않은 코드를 제안한다', () => {
    expect(suggestCode('ACS', new Set(['ACS']))).toBe('ACA');
    expect(suggestCode('ACS', new Set(['ACS', 'ACA', 'ACB']))).toBe('ACC');
  });
});
