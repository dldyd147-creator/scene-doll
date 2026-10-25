import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { boneFrame, gripToWorld, worldToGrip } from './propMath';

describe('소품 쥐기 좌표 변환', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2); // 뼈가 +Y 대신 -X를 가리킴
  const boneWorld = new Matrix4().compose(new Vector3(1, 1.4, 0.2), q, new Vector3(1.1, 1.1, 1.1)); // 돌 키 스케일 1.1

  it('뼈 크기는 버리고 위치·회전만 쓴다', () => {
    const f = boneFrame(boneWorld);
    expect(f.position.toArray().map((v) => +v.toFixed(5))).toEqual([1, 1.4, 0.2]);
    expect(f.quaternion.angleTo(q)).toBeLessThan(1e-6);
  });

  it('로컬 → 월드: 손가락 쪽 7cm는 뼈 방향(-X)으로 7cm', () => {
    const w = gripToWorld(boneWorld, { position: [0, 0.07, 0], rotation: [0, 0, 0, 1] });
    expect(w.position.toArray().map((v) => +v.toFixed(5))).toEqual([0.93, 1.4, 0.2]);
    expect(w.quaternion.angleTo(q)).toBeLessThan(1e-6);
  });

  it('월드 → 로컬 → 월드 왕복', () => {
    const pos = new Vector3(0.8, 1.5, 0.35);
    const rot = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.6);
    const grip = worldToGrip(boneWorld, pos, rot);
    expect(grip.rotation[3]).toBeGreaterThanOrEqual(0);
    const back = gripToWorld(boneWorld, grip);
    expect(back.position.distanceTo(pos)).toBeLessThan(1e-3);
    expect(back.quaternion.angleTo(rot)).toBeLessThan(1e-3);
  });
});
