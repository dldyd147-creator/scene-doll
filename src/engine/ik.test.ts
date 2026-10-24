import { describe, expect, it } from 'vitest';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { applyTwoBone, hingeChainVector, hingeForward, solveHingeChain, solveTwoBone, type HingeChainInput } from './ik';
import { clampJointRotation, hingeCompose, limitFor } from './limits';

const deg = MathUtils.degToRad;

const arm = () => ({
  a: new Vector3(0, 1.4, 0),
  b: new Vector3(0.3, 1.4, 0),
  c: new Vector3(0.55, 1.4, 0),
  poleHint: new Vector3(0, -0.4, -1),
});

describe('solveTwoBone', () => {
  it('닿는 목표에 끝을 정확히 맞춘다', () => {
    const inp = { ...arm(), target: new Vector3(0.2, 1.1, 0.15) };
    const res = solveTwoBone(inp);
    const out = applyTwoBone(inp, res);
    expect(res.reachable).toBe(true);
    expect(out.c.distanceTo(inp.target)).toBeLessThan(1e-6);
    // 뼈 길이 보존
    expect(out.b.distanceTo(inp.a)).toBeCloseTo(0.3, 6);
    expect(out.c.distanceTo(out.b)).toBeCloseTo(0.25, 6);
  });

  it('닿지 않는 목표는 그 방향으로 최대로 뻗는다', () => {
    const inp = { ...arm(), target: new Vector3(2, 2, 0) };
    const res = solveTwoBone(inp);
    const out = applyTwoBone(inp, res);
    expect(res.reachable).toBe(false);
    const dir = inp.target.clone().sub(inp.a).normalize();
    const got = out.c.clone().sub(inp.a);
    expect(got.length()).toBeCloseTo(0.55, 3);
    expect(got.normalize().dot(dir)).toBeCloseTo(1, 4);
  });

  it('곧게 펴진 팔은 힌트 방향으로 굽는다', () => {
    const inp = { ...arm(), target: new Vector3(0.3, 1.4, 0) }; // 어깨 가까이 당김
    const res = solveTwoBone(inp);
    const out = applyTwoBone(inp, res);
    expect(out.c.distanceTo(inp.target)).toBeLessThan(1e-6);
    // 팔꿈치는 힌트(-Z, 약간 아래) 쪽으로
    expect(out.b.z).toBeLessThan(-0.05);
  });

  it('이미 굽은 팔은 기존 굽힘 평면을 유지한다(뒤집힘 없음)', () => {
    const inp = {
      a: new Vector3(0, 1.4, 0),
      b: new Vector3(0.2, 1.4, -0.2),
      c: new Vector3(0.45, 1.4, -0.2),
      target: new Vector3(0.3, 1.5, -0.1),
      poleHint: new Vector3(0, 0, 1), // 반대 힌트를 주어도
    };
    const res = solveTwoBone(inp);
    const out = applyTwoBone(inp, res);
    expect(out.c.distanceTo(inp.target)).toBeLessThan(1e-6);
    expect(out.b.z).toBeLessThan(0); // 팔꿈치가 여전히 -Z 쪽
  });
});

type ChainGeom = Omit<HingeChainInput, 'thetaCur' | 'tDir' | 'dist' | 'pole'>;

/** 실제 돌(MakeHuman 남, 175cm)의 왼다리 휴식 값: 뼈가 경첩 축(X)에 6° 기울어 있다 */
const KNEE: ChainGeom = {
  l1: 0.4257,
  l2: 0.439,
  u0: new Vector3(0.1015, -0.9915, 0.0809).normalize(),
  s0: new Vector3(0.1075, -0.9938, -0.0292).normalize(),
  axis: new Vector3(1, 0, 0),
  min: 0,
  max: deg(150),
};
const LEFT_ELBOW: ChainGeom = {
  l1: 0.255,
  l2: 0.269,
  u0: new Vector3(1, 0, 0),
  s0: new Vector3(1, 0, 0),
  axis: new Vector3(0, 1, 0),
  min: deg(-148),
  max: 0,
};

const forwardOf = (c: ChainGeom) => hingeForward(c.l1, c.l2, c.u0, c.s0, c.axis, c.min, c.max);

/** 결과를 적용했을 때 가운데 관절과 끝의 위치(위 뼈 시작 기준) */
function endOf(c: ChainGeom, upper: Quaternion, theta: number): { mid: Vector3; end: Vector3 } {
  const mid = c.u0.clone().multiplyScalar(c.l1).applyQuaternion(upper);
  const lower = c.s0.clone().applyQuaternion(new Quaternion().setFromAxisAngle(c.axis, theta)).applyQuaternion(upper).multiplyScalar(c.l2);
  return { mid, end: mid.clone().add(lower) };
}

describe('solveHingeChain', () => {
  it('골반이 내려앉으면 무릎이 경첩 둘레로만 굽어 발목이 제자리에 남는다', () => {
    const stand = hingeChainVector(KNEE.l1, KNEE.l2, KNEE.u0, KNEE.s0, KNEE.axis, 0);
    const target = stand.clone().add(new Vector3(0, 0.3, 0)); // 고관절이 30cm 내려감 = 발목이 고관절 기준 30cm 올라감
    const res = solveHingeChain({ ...KNEE, thetaCur: 0, tDir: target.clone().normalize(), dist: target.length(), pole: forwardOf(KNEE) });
    expect(res.reachable).toBe(true);
    const { mid, end } = endOf(KNEE, res.upper, res.theta);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    expect(res.theta).toBeGreaterThan(deg(80));
    expect(res.theta).toBeLessThan(deg(105));
    expect(mid.z).toBeGreaterThan(0.1); // 무릎은 앞(+Z)으로
    // 관절 한계 교정이 결과를 바꾸지 않는다(발이 미끄러지지 않는 조건)
    const J = hingeCompose(KNEE.s0, KNEE.axis, res.theta, 0);
    expect(clampJointRotation(J, KNEE.s0, limitFor('LeftLeg')!)).toBeNull();
  });

  it('같은 목표로 다시 풀면 위 뼈 회전이 그대로다(떨림·비틀림 누적 없음)', () => {
    const stand = hingeChainVector(KNEE.l1, KNEE.l2, KNEE.u0, KNEE.s0, KNEE.axis, 0);
    const target = stand.clone().add(new Vector3(0.05, 0.4, -0.1));
    const f0 = forwardOf(KNEE);
    const base = { ...KNEE, tDir: target.clone().normalize(), dist: target.length() };
    const r1 = solveHingeChain({ ...base, thetaCur: 0, pole: f0 });
    // 목표가 같으면 겨냥 회전은 항등이므로 pole은 지금 위 뼈의 '앞'
    const r2 = solveHingeChain({ ...base, thetaCur: r1.theta, pole: f0.clone().applyQuaternion(r1.upper) });
    expect(r2.theta).toBeCloseTo(r1.theta, 8);
    expect(r2.upper.angleTo(r1.upper)).toBeLessThan(1e-6);
  });

  it('닿지 않는 목표면 범위 안에서 최대로 펴고 그 방향을 가리킨다', () => {
    const tDir = new Vector3(0.3, -1, 0.2).normalize();
    const res = solveHingeChain({ ...KNEE, thetaCur: deg(40), tDir, dist: 2, pole: forwardOf(KNEE) });
    expect(res.reachable).toBe(false);
    expect(res.theta).toBeCloseTo(0, 6);
    const { end } = endOf(KNEE, res.upper, res.theta);
    expect(end.clone().normalize().dot(tDir)).toBeCloseTo(1, 6);
  });

  it('왼팔꿈치는 음의 각으로 굽고 팔꿈치가 pole 쪽으로 나온다', () => {
    const f0 = forwardOf(LEFT_ELBOW);
    expect(f0.z).toBeLessThan(-0.5); // 팔꿈치는 뒤(-Z)·바깥쪽(+X)으로 튀어나온다
    const target = new Vector3(0.1, -0.05, 0.3); // 손을 어깨 앞으로
    const res = solveHingeChain({ ...LEFT_ELBOW, thetaCur: 0, tDir: target.clone().normalize(), dist: target.length(), pole: f0 });
    expect(res.reachable).toBe(true);
    expect(res.theta).toBeLessThan(deg(-60));
    expect(res.theta).toBeGreaterThan(LEFT_ELBOW.min);
    const { mid, end } = endOf(LEFT_ELBOW, res.upper, res.theta);
    expect(end.distanceTo(target)).toBeLessThan(1e-6);
    const line = target.clone().normalize();
    const offset = mid.clone().sub(line.clone().multiplyScalar(mid.dot(line)));
    expect(offset.dot(f0)).toBeGreaterThan(0);
  });
});
