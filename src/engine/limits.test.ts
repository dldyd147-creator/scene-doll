import { describe, expect, it } from 'vitest';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { clampJointRotation, hingeCompose, hingeDecompose, limitFor, swingTwist } from './limits';

const deg = MathUtils.degToRad;

describe('관절 한계', () => {
  it('스윙·트위스트 분해가 원래 회전을 복원한다', () => {
    const axis = new Vector3(1, 0, 0);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(40)).multiply(new Quaternion().setFromAxisAngle(axis, deg(30)));
    const { swing, twist, twistAngle } = swingTwist(q, axis);
    expect(twistAngle).toBeCloseTo(deg(30), 5);
    const back = swing.clone().multiply(twist);
    expect(back.angleTo(q)).toBeLessThan(1e-6);
  });

  it('무릎은 경첩 밖 성분을 지우고 범위 안으로 넣는다', () => {
    const limit = limitFor('LeftLeg')!;
    const boneDir = new Vector3(0, -1, 0);
    // 옆으로 40° 벌어진(불가능한) 무릎
    const J = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), deg(40));
    const fixed = clampJointRotation(J, boneDir, limit)!;
    expect(fixed).not.toBeNull();
    const dir = boneDir.clone().applyQuaternion(fixed);
    expect(Math.abs(dir.x)).toBeLessThan(1e-6); // 경첩(X축) 둘레 회전만 남아 옆으로 벌어지지 않는다
  });

  it('무릎은 뒤로만 굽는다(앞으로 꺾이면 0으로)', () => {
    const limit = limitFor('RightLeg')!;
    const boneDir = new Vector3(0, -1, 0);
    const forward = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), deg(-30)); // 앞으로 꺾임
    const fixed = clampJointRotation(forward, boneDir, limit)!;
    const dir = boneDir.clone().applyQuaternion(fixed);
    expect(dir.z).toBeCloseTo(0, 5);
    const back = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), deg(90)); // 뒤로 90°는 허용
    expect(clampJointRotation(back, boneDir, limit)).toBeNull();
  });

  it('팔꿈치는 좌우가 반대 부호로 앞으로 굽는다', () => {
    const left = limitFor('LeftForeArm')!;
    const right = limitFor('RightForeArm')!;
    const lDir = new Vector3(1, 0, 0);
    const rDir = new Vector3(-1, 0, 0);
    const lBend = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(-90));
    const rBend = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(90));
    expect(lDir.clone().applyQuaternion(lBend).z).toBeGreaterThan(0.99);
    expect(rDir.clone().applyQuaternion(rBend).z).toBeGreaterThan(0.99);
    expect(clampJointRotation(lBend, lDir, left)).toBeNull();
    expect(clampJointRotation(rBend, rDir, right)).toBeNull();
    // 반대로 꺾으면 0으로 돌아온다
    const lWrong = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(40));
    const fixed = clampJointRotation(lWrong, lDir, left)!;
    expect(lDir.clone().applyQuaternion(fixed).angleTo(lDir)).toBeLessThan(1e-4);
  });

  it('경첩 축에 비스듬한 실제 무릎 뼈: 순수 경첩 굽힘은 그대로 두고 비틀림만 한계로', () => {
    const limit = limitFor('LeftLeg')!; // 경첩 X [0,150], 비틀림 10
    const s0 = new Vector3(0.1075, -0.9938, -0.0292).normalize();
    const axis = new Vector3(1, 0, 0);
    const bent = hingeCompose(s0, axis, deg(92), deg(5));
    const d0 = hingeDecompose(bent, s0, axis);
    expect(d0.theta).toBeCloseTo(deg(92), 6);
    expect(d0.phi).toBeCloseTo(deg(5), 6);
    expect(d0.offAxis).toBeLessThan(1e-6);
    expect(clampJointRotation(bent, s0, limit)).toBeNull();
    const twisted = hingeCompose(s0, axis, deg(92), deg(15));
    const fixed = clampJointRotation(twisted, s0, limit)!;
    expect(fixed).not.toBeNull();
    const d = hingeDecompose(fixed, s0, axis);
    expect(d.theta).toBeCloseTo(deg(92), 5);
    expect(d.phi).toBeCloseTo(deg(10), 5);
    expect(d.offAxis).toBeLessThan(1e-6);
    expect(clampJointRotation(fixed, s0, limit)).toBeNull(); // 다시 교정해도 바뀌지 않는다
  });

  it('원뿔 한계와 트위스트 한계', () => {
    const limit = limitFor('Head')!; // cone 40, twist 45
    const dir = new Vector3(0, 1, 0);
    const tooFar = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), deg(70));
    const fixed = clampJointRotation(tooFar, dir, limit)!;
    expect(dir.clone().applyQuaternion(fixed).angleTo(dir)).toBeCloseTo(deg(40), 4);
    const tooTwisted = new Quaternion().setFromAxisAngle(dir, deg(80));
    const fixedTwist = clampJointRotation(tooTwisted, dir, limit)!;
    expect(swingTwist(fixedTwist, dir).twistAngle).toBeCloseTo(deg(45), 4);
    expect(clampJointRotation(new Quaternion().setFromAxisAngle(dir, deg(20)), dir, limit)).toBeNull();
  });
});
