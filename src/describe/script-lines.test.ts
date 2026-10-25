import { describe, expect, it } from 'vitest';
import { cutBlock, passName } from './text';

describe('출력 묶음 파일 이름', () => {
  it('선화·깊이·색 마스크', () => {
    expect(passName('ACS', 12, 45, 'line')).toBe('ACS_012_045_line.png');
    expect(passName('ACS', 1, 3, 'depth')).toBe('ACS_001_003_depth.png');
    expect(passName('ACS', 1, 3, 'mask')).toBe('ACS_001_003_mask.png');
  });
});
import type { CutAnalysis } from './analyze';
import { createCut } from '../model/defaults';
import { createPrimitiveProp } from '../model/props';

describe('설명 텍스트: 소품', () => {
  it('손에 쥔 소품은 인물 줄에, 자유 배치는 소품 줄에', () => {
    const cut = createCut(2);
    cut.props.push(
      { id: 'p1', propId: 'sword', position: [0, 0, 0], rotation: [0, 0, 0, 1], attachedTo: { dollInstanceId: 'd1', hand: 'right' } },
      { id: 'p2', propId: 'cup', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { id: 'p3', propId: 'unknown', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    );
    const props = [createPrimitiveProp('검', 'box', [0.05, 0.9, 0.01], { id: 'sword' }), createPrimitiveProp('컵', 'cylinder', [0.08, 0.1, 0.08], { id: 'cup' })];
    const a: CutAnalysis = {
      count: 1,
      shot: 'full',
      angle: 'eye',
      camera: { height: 1.5, focal: 50, pitch: 0, distance: 3.5 },
      dolls: [{ id: 'd1', characterId: 'c', name: '주인공', color: '#F5C518', colorName: '노랑', inFrame: true, shot: 'full', projectedHeight: 1, xZone: '중앙', depthZone: null, facing: '정면', stance: '서 있음', stanceConj: '서서', phrases: ['오른팔 들어 올림'], distance: 3 }],
    };
    const lines = cutBlock(a, cut, 'ACS', 1, props).split('\n');
    expect(lines[1]).toBe('노랑 주인공: 중앙 · 정면 · 서서 오른팔 들어 올림 · 오른손에 검');
    expect(lines[2]).toBe('소품: 컵, 소품');
    expect(lines[3].startsWith('카메라:')).toBe(true);
  });
});

describe('설명 텍스트: 글콘티 대사·지문 줄', () => {
  it('대사는 줄마다, 지문은 한 줄로, 메모보다 앞에', () => {
    const cut = { ...createCut(3), memo: '검 강조' };
    cut.dialogue = [
      { speaker: '주인공', text: '여기가 어디지?', position: 'top' },
      { speaker: '', text: '…', position: 'top' },
      { speaker: '히로인', text: '   ', position: 'top' },
    ];
    cut.scriptNote = '복도.\n  두리번거린다  ';
    const a: CutAnalysis = { count: 0, shot: 'full', angle: 'eye', camera: { height: 1.5, focal: 50, pitch: 0, distance: 3.5 }, dolls: [] };
    const lines = cutBlock(a, cut, 'ACS', 1).split('\n');
    expect(lines.slice(1)).toEqual(['카메라: 높이 1.5m · 50mm · 수평 · 거리 3.5m', '대사(주인공): 여기가 어디지?', '대사: …', '지문: 복도. / 두리번거린다', '메모: 검 강조']);
  });

  it('대사·지문이 없으면 줄이 생기지 않는다', () => {
    const a: CutAnalysis = { count: 0, shot: 'full', angle: 'eye', camera: { height: 1.5, focal: 50, pitch: 0, distance: 3.5 }, dolls: [] };
    expect(cutBlock(a, createCut(1), 'ACS', 1).split('\n')).toHaveLength(2);
  });
});
