import { describe, expect, it } from 'vitest';
import type { DollAnalysis } from './analyze';
import { placementLabel, refinePlacement } from './placement';

type P = Pick<DollAnalysis, 'xZone' | 'depthZone' | 'distance' | 'screenX' | 'relation' | 'colorName'>;

const doll = (colorName: string, xZone: DollAnalysis['xZone'], screenX: number, distance: number): P => ({ colorName, xZone, screenX, distance, depthZone: null, relation: null });

describe('인물 위치 관계', () => {
  it('나란히 앉은 두 인물(거리 차 2cm)은 앞뒤 없이 서로의 좌우로 적는다', () => {
    // 실제 검증 컷 006: 정면 투샷, 둘 다 화면 가운데 1/3 안
    const a = doll('노랑', '중앙', -0.15, 2.087);
    const b = doll('파랑', '중앙', 0.12, 2.072);
    refinePlacement([a, b]);
    expect([a.depthZone, b.depthZone]).toEqual([null, null]);
    expect(placementLabel(a)).toBe('중앙 (파랑 돌 왼쪽)');
    expect(placementLabel(b)).toBe('중앙 (노랑 돌 오른쪽)');
  });

  it('거리 차가 뚜렷하고 화면에서 겹치면 앞뒤만 적는다', () => {
    // 실제 검증 컷 005: 3/4 구도, 노랑이 뒤
    const a = doll('노랑', '중앙', -0.05, 2.0);
    const b = doll('파랑', '중앙', 0.02, 1.5);
    refinePlacement([a, b]);
    expect(placementLabel(a)).toBe('중앙 뒤');
    expect(placementLabel(b)).toBe('중앙 앞');
  });

  it('다른 칸에 있으면 칸 이름만, 먼 거리에서는 비율 기준(12%)으로 앞뒤를 가린다', () => {
    const a = doll('노랑', '왼쪽', -0.6, 5.0);
    const b = doll('파랑', '오른쪽', 0.6, 5.5); // 0.5m 차이 < 5m의 12%
    refinePlacement([a, b]);
    expect([placementLabel(a), placementLabel(b)]).toEqual(['왼쪽', '오른쪽']);
  });

  it('셋 이상이면 가까운 1/3은 앞, 먼 1/3은 뒤, 사이는 중간', () => {
    const a = doll('노랑', '왼쪽', -0.6, 2.0);
    const b = doll('파랑', '중앙', 0.0, 2.1);
    const c = doll('초록', '오른쪽', 0.6, 4.0);
    const d = doll('빨강', '오른쪽', 0.5, 3.0);
    refinePlacement([a, b, c, d]);
    expect([a.depthZone, b.depthZone, d.depthZone, c.depthZone]).toEqual(['앞', '앞', '중간', '뒤']);
    // 오른쪽 칸의 두 인물은 화면 간격 0.1 ≥ 0.08이라 좌우 관계도 붙는다
    expect(placementLabel(c)).toBe('오른쪽 뒤 (빨강 돌 오른쪽)');
    expect(placementLabel(d)).toBe('오른쪽 중간 (초록 돌 왼쪽)');
  });

  it('한 명이면 칸 이름만', () => {
    const a = doll('노랑', '중앙', 0, 3);
    a.depthZone = '앞';
    refinePlacement([a]);
    expect(placementLabel(a)).toBe('중앙');
  });
});
