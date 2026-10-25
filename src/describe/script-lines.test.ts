import { describe, expect, it } from 'vitest';
import { cutBlock } from './text';
import type { CutAnalysis } from './analyze';
import { createCut } from '../model/defaults';

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
