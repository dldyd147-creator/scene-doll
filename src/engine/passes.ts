// 출력 묶음(4단계): 선화·깊이·색 마스크 패스에 쓰는 재질.
import { Box3, Matrix4, PerspectiveCamera, ShaderMaterial, Vector3 } from 'three';

export type RenderPass = 'line' | 'depth' | 'mask';

export const PASS_SUFFIX: Record<RenderPass, string> = { line: 'line', depth: 'depth', mask: 'mask' };
export const PASS_LABEL: Record<RenderPass, string> = { line: '선화', depth: '깊이', mask: '색 마스크' };

const DEPTH_VERT = `
#include <common>
#include <skinning_pars_vertex>
varying float vDepth;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vDepth = -mvPosition.z;
}
`;

const DEPTH_FRAG = `
uniform float uNear;
uniform float uFar;
varying float vDepth;
void main() {
  float d = clamp((vDepth - uNear) / max(uFar - uNear, 1e-4), 0.0, 1.0);
  float v = 1.0 - d;
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

/** 선형 깊이(가까울수록 밝게)를 그리는 재질. 스킨 메시도 지원한다 */
export function depthMaterial(near: number, far: number): ShaderMaterial {
  return new ShaderMaterial({ vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG, uniforms: { uNear: { value: near }, uFar: { value: far } } });
}

const _corner = new Vector3();
const _inv = new Matrix4();

/** 상자들의 카메라 공간 깊이 범위(가까운 거리, 먼 거리). 비어 있으면 카메라 기본값 */
export function depthRange(camera: PerspectiveCamera, boxes: Box3[]): { near: number; far: number } {
  camera.updateMatrixWorld(true);
  _inv.copy(camera.matrixWorld).invert();
  let near = Infinity;
  let far = -Infinity;
  for (const b of boxes) {
    if (b.isEmpty()) continue;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(_inv);
      const d = -_corner.z;
      near = Math.min(near, d);
      far = Math.max(far, d);
    }
  }
  if (!Number.isFinite(near) || !Number.isFinite(far) || far - near < 0.05) return { near: 0.5, far: 10 };
  const pad = (far - near) * 0.05;
  return { near: Math.max(camera.near, near - pad), far: far + pad };
}
