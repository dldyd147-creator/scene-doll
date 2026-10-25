import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { depthRange } from './passes';

describe('깊이 범위', () => {
  it('카메라 앞 상자들의 거리 범위에 여유를 둔다', () => {
    const cam = new PerspectiveCamera(45, 1, 0.1, 100);
    cam.position.set(0, 1.5, 3.5);
    cam.lookAt(0, 1, 0);
    const near = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 1.8, 0.2));
    const far = new Box3(new Vector3(0.5, 0, -2.2), new Vector3(1.1, 1.8, -1.8));
    const r = depthRange(cam, [near, far]);
    expect(r.near).toBeGreaterThan(2.5);
    expect(r.near).toBeLessThan(3.5);
    expect(r.far).toBeGreaterThan(5);
    expect(r.far).toBeLessThan(7);
  });

  it('상자가 없으면 기본값', () => {
    expect(depthRange(new PerspectiveCamera(), [])).toEqual({ near: 0.5, far: 10 });
  });
});
