import { describe, expect, it } from 'vitest';
import { angleFromElevation, elevationDeg } from './angle';

describe('앵글 태그', () => {
  it('눈높이 ±15° 안은 아이레벨', () => {
    // 기본 카메라(높이 1.5m, 3.5m 앞)와 키 175cm 돌의 눈(약 1.65m): 거의 수평
    expect(angleFromElevation(elevationDeg({ x: 0, y: 1.5, z: 3.5 }, { x: 0, y: 1.65, z: 0 }))).toBe('eye');
    // 앉은 돌(눈 1.1m)을 1.5m에서 3.5m 앞에서 찍어도 하이앵글이 아니다(약 6.5°)
    expect(angleFromElevation(elevationDeg({ x: 0, y: 1.5, z: 3.5 }, { x: 0, y: 1.1, z: 0 }))).toBe('eye');
  });
  it('뚜렷하게 위·아래일 때만 하이·로우', () => {
    expect(angleFromElevation(elevationDeg({ x: 0, y: 4, z: 3 }, { x: 0, y: 1.6, z: 0 }))).toBe('high');
    expect(angleFromElevation(elevationDeg({ x: 0, y: 0.3, z: 2 }, { x: 0, y: 1.6, z: 0 }))).toBe('low');
  });
});
