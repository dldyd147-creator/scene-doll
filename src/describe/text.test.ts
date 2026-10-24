import { describe, expect, it } from 'vitest';
import { cutBlock, episodeHeader, formatAspect, pngName } from './text';
import { facingLabel, type CutAnalysis } from './analyze';
import { createCut, createEpisode, createWork } from '../model/defaults';

describe('설명 텍스트', () => {
  it('파일 이름과 화면비 표기', () => {
    expect(pngName('ACS', 12, 45)).toBe('ACS_012_045.png');
    expect(formatAspect(1.5)).toBe('1:1.5');
    expect(formatAspect(1)).toBe('1:1');
    expect(formatAspect(1.333)).toBe('1:1.33');
  });

  it('8방위 향함', () => {
    expect(facingLabel(0)).toBe('정면');
    expect(facingLabel(90)).toBe('오른쪽 향함');
    expect(facingLabel(-90)).toBe('왼쪽 향함');
    expect(facingLabel(180)).toBe('뒷모습');
    expect(facingLabel(-180)).toBe('뒷모습');
    expect(facingLabel(40)).toBe('오른쪽 반측면');
  });

  it('컷 블록 형식', () => {
    const cut = { ...createCut(45), aspect: 1.5, memo: '검을 쥔 손을 강조' };
    cut.camera = { ...cut.camera, position: [0, 0.9, 3.2], pitch: 15, focalLength: 35 };
    const a: CutAnalysis = {
      count: 2,
      shot: 'full',
      angle: 'low',
      camera: { height: 0.9, focal: 35, pitch: 15, distance: 3.2 },
      dolls: [
        { id: 'a', characterId: 'c1', name: 'A캐릭터', color: '#F5C518', colorName: '노랑', inFrame: true, shot: 'full', projectedHeight: 1.5, xZone: '중앙', depthZone: '앞', facing: '정면', stance: '서 있음', stanceConj: '서서', phrases: ['오른팔 들어 올림'], distance: 3.2 },
        { id: 'b', characterId: 'c2', name: 'B캐릭터', color: '#2F6FEB', colorName: '파랑', inFrame: true, shot: 'full', projectedHeight: 1.1, xZone: '왼쪽', depthZone: '뒤', facing: '왼쪽 향함', stance: '서 있음', stanceConj: '서서', phrases: [], distance: 4.5 },
      ],
    };
    const text = cutBlock(a, cut, 'ACS', 12);
    expect(text).toBe(
      [
        '## 045 · ACS_012_045.png · 1:1.5 · 로우앵글 · 풀샷 · 2인',
        '노랑 A캐릭터: 중앙 앞 · 정면 · 서서 오른팔 들어 올림',
        '파랑 B캐릭터: 왼쪽 뒤 · 왼쪽 향함 · 서 있음',
        '카메라: 높이 0.9m · 35mm · 올려봄 15° · 거리 3.2m',
        '메모: 검을 쥔 손을 강조',
      ].join('\n'),
    );
  });

  it('머리말에 등장 캐릭터만 색 대응표로', () => {
    const work = createWork('ACS', '아카데미에서 살아남기');
    const ep = createEpisode('ACS', 12);
    const cut = createCut(1);
    cut.dolls.push({ id: 'd1', characterId: 'c1', dollId: 'mannequin_m', heightCm: 175, color: '#F5C518', position: [0, 0, 0], rotation: [0, 0, 0, 1], joints: {} });
    const chars = [
      { id: 'c1', workCode: 'ACS', name: 'A캐릭터', color: '#F5C518', info: { gender: 'male' as const }, appearanceTags: ['검은 단발', '교복'], heightCm: 175, dollId: 'mannequin_m', referenceImages: [], temporary: false },
      { id: 'c2', workCode: 'ACS', name: 'B캐릭터', color: '#2F6FEB', info: { gender: 'female' as const }, appearanceTags: [], heightCm: 162, dollId: 'mannequin_f', referenceImages: [], temporary: true },
    ];
    const head = episodeHeader(work, ep, [cut], chars, 1024);
    expect(head).toContain('# ACS 012 — 컷 설명 (총 1컷)');
    expect(head).toContain('- 노랑 = A캐릭터 · 검은 단발, 교복 · 레퍼런스 없음');
    expect(head).not.toContain('B캐릭터');
  });
});
