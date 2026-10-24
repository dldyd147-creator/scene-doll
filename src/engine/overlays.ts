import { BackSide, BufferGeometry, Mesh, MeshBasicMaterial, Object3D, SkinnedMesh, Vector3, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/** 십자선용 굵은 선 재질(화면 픽셀 두께). 렌더 전 setLineResolution으로 해상도를 맞춘다 */
export const CROSSHAIR_MATERIAL = new LineMaterial({ color: 0x151515, linewidth: 2.5, worldUnits: false, depthTest: true, depthWrite: true });

export function setLineResolution(width: number, height: number): void {
  CROSSHAIR_MATERIAL.resolution.set(width, height);
}

/** 꺾은선 하나(십자선 요소) */
export function makePolyline(points: Vector3[]): Line2 {
  const g = new LineGeometry();
  const flat: number[] = [];
  for (const p of points) flat.push(p.x, p.y, p.z);
  g.setPositions(flat);
  const line = new Line2(g, CROSSHAIR_MATERIAL);
  line.computeLineDistances();
  line.frustumCulled = false;
  line.renderOrder = 2; // 몸 메시 뒤에 그려 깊이 비교가 바르게 되게
  return line;
}

/**
 * 외곽선 재질: 뒷면만 그리는 검정 재질에 법선 방향 두께를 더한다(인버티드 헐).
 * 스킨 메시에서는 스키닝 전에(바인드 자세 기준) 밀어낸다.
 */
export function outlineMaterial(thickness: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color: 0x000000, side: BackSide });
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uOutline = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uOutline;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += normal * uOutline;');
  };
  m.customProgramCacheKey = () => `outline`;
  return m;
}

/** 강체 부위용 외곽선: 같은 지오메트리를 자식으로 */
export function outlineForMesh(part: Mesh, material: Material): Mesh {
  const o = new Mesh(part.geometry as BufferGeometry, material);
  o.name = `outline:${part.name}`;
  o.renderOrder = -1;
  part.add(o);
  return o;
}

/** 스킨 메시용 외곽선: 같은 스켈레톤에 묶은 복제 */
export function outlineForSkinned(mesh: SkinnedMesh, material: Material, parent: Object3D): SkinnedMesh {
  const o = new SkinnedMesh(mesh.geometry, material);
  o.name = `outline:${mesh.name}`;
  o.position.copy(mesh.position);
  o.quaternion.copy(mesh.quaternion);
  o.scale.copy(mesh.scale);
  o.frustumCulled = false;
  o.renderOrder = -1;
  parent.add(o);
  o.bind(mesh.skeleton, mesh.bindMatrix);
  return o;
}
