import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { angleAbout, armSide } from './bodyPose';

describe('bodyPose', () => {
  it('angleAbout은 한 축 둘레 회전각을 돌려준다(부호 포함)', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5);
    expect(angleAbout(q, 'x')).toBeCloseTo(0.5, 5);
    const n = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.3);
    expect(angleAbout(n, 'z')).toBeCloseTo(-0.3, 5);
    expect(angleAbout(n, 'x')).toBeCloseTo(0, 5);
  });
  it('w가 음수인 같은 회전도 같은 각을 낸다', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
    const flipped = new Quaternion(-q.x, -q.y, -q.z, -q.w);
    expect(angleAbout(flipped, 'x')).toBeCloseTo(0.4, 5);
  });
  it('armSide는 팔이 있는 쪽 부호를 정한다', () => {
    expect(armSide(0.2, 0.05, 'right')).toBe(1);
    expect(armSide(-0.2, -0.05, 'left')).toBe(-1);
    expect(armSide(0, 0, 'left')).toBe(1);
  });
});
