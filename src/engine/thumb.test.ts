import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { thumbBendTarget } from './fingers';

describe('엄지 굽힘 방향', () => {
  it('엄지 뼈가 손바닥 법선과 나란해도 굽힘 축이 0이 되지 않는다', () => {
    const normal = new Vector3(0, -1, 0);
    const index = new Vector3(1, 0, 0);
    const thumb = new Vector3(0.1, -1, 0.3).normalize();
    const target = thumbBendTarget(normal, index, thumb);
    expect(new Vector3().crossVectors(thumb, target).length()).toBeGreaterThan(0.2);
    expect(target.length()).toBeCloseTo(1, 5);
  });
});
