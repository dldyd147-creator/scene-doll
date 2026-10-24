import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { applyTwoBone, solveTwoBone } from './ik';

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
