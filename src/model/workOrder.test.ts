import { describe, expect, it } from 'vitest';
import { moveWork, sortWorks } from './workOrder';
import type { Work } from './types';

const w = (code: string, order?: number) => ({ code, order }) as Work;

describe('작품 순서', () => {
  it('order 순, 없는 작품은 뒤에서 코드 순', () => {
    const list = [w('CCC'), w('BBB', 1), w('AAA'), w('DDD', 0)];
    expect(sortWorks(list, (x) => x).map((x) => x.code)).toEqual(['DDD', 'BBB', 'AAA', 'CCC']);
  });
  it('한 칸 옮기면 전부 새 order를 받는다', () => {
    expect(moveWork(['A', 'B', 'C'], 'C', -1)).toEqual([
      { code: 'A', order: 0 },
      { code: 'C', order: 1 },
      { code: 'B', order: 2 },
    ]);
    expect(moveWork(['A', 'B'], 'A', -1)).toBeNull();
    expect(moveWork(['A', 'B'], 'B', 1)).toBeNull();
    expect(moveWork(['A', 'B'], 'Z', 1)).toBeNull();
  });
});
