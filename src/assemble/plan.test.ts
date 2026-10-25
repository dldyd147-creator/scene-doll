import { describe, expect, it } from 'vitest';
import type { Cut } from '../model/types';
import { planExport } from './plan';

const cut = (n: number, confirmed = true): Cut => ({ number: n, confirmed, generatedImages: [] }) as unknown as Cut;

describe('원고 내보내기 계획', () => {
  it('그림이 있는 컷만 내보내고, 대표 후보가 아닌 그림·빠진 컷은 경고한다', () => {
    const p = planExport([cut(1), cut(2), cut(3, false), cut(4), cut(5)], { 1: 'generated', 2: 'output', 3: 'none', 4: 'none', 5: 'generated' }, [5]);
    expect(p.items.map((i) => i.number)).toEqual([1, 2]);
    expect(p.warnings).toHaveLength(3);
    expect(p.warnings[0]).toContain('확정 컷 PNG');
    expect(p.warnings[1]).toContain('뺐습니다');
    expect(p.warnings[2]).toContain('파란 칸');
  });
});
