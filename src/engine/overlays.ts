import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  SkinnedMesh,
  SRGBColorSpace,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { LAYER_HELPERS } from './materials';

// ---------- 외곽선 ----------

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

// ---------- 제어점(화면 고정 크기 점) ----------

function markerTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  draw(ctx, s);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

let circleTex: CanvasTexture | null = null;
let squareTex: CanvasTexture | null = null;
let ringTex: CanvasTexture | null = null;

/** 흰 원 + 짙은 테두리(IK 핸들·관절점). 흰 부분은 정점 색으로 물든다 */
export function circleTexture(): CanvasTexture {
  if (!circleTex) {
    circleTex = markerTexture((ctx, s) => {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = s * 0.11;
      ctx.strokeStyle = '#1d1f26';
      ctx.stroke();
    });
  }
  return circleTex;
}

/** 모서리 둥근 사각(골반·이동 핸들) */
export function squareTexture(): CanvasTexture {
  if (!squareTex) {
    squareTex = markerTexture((ctx, s) => {
      const r = s * 0.14;
      const a = s * 0.14;
      const b = s - a;
      ctx.beginPath();
      ctx.moveTo(a + r, a);
      ctx.arcTo(b, a, b, b, r);
      ctx.arcTo(b, b, a, b, r);
      ctx.arcTo(a, b, a, a, r);
      ctx.arcTo(a, a, b, a, r);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = s * 0.11;
      ctx.strokeStyle = '#1d1f26';
      ctx.stroke();
    });
  }
  return squareTex;
}

/** 속이 빈 링(선택 관절 표시) */
export function ringTexture(): CanvasTexture {
  if (!ringTex) {
    ringTex = markerTexture((ctx, s) => {
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.16;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2);
      ctx.lineWidth = s * 0.05;
      ctx.strokeStyle = '#1d1f26';
      ctx.stroke();
    });
  }
  return ringTex;
}

/** 화면 픽셀 크기가 일정한 점 집합. 위치·색은 setMarker로 바꾼다 */
export class MarkerPoints {
  readonly points: Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly colAttr: BufferAttribute;
  private readonly color = new Color();

  constructor(
    readonly count: number,
    sizePx: number,
    texture: CanvasTexture,
    renderOrder = 20,
  ) {
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3).fill(1);
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.positions, 3);
    this.colAttr = new BufferAttribute(this.colors, 3);
    this.posAttr.setUsage(35048); // DynamicDrawUsage
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    // 깊이 검사를 켜서 몸 뒤에 가려진 제어점은 보이지 않게 한다(위치는 카메라 쪽으로 조금 당겨 몸 안의 관절도 앞에서는 보이게)
    const m = new PointsMaterial({ size: sizePx, sizeAttenuation: false, map: texture, transparent: true, alphaTest: 0.2, depthTest: true, depthWrite: false, vertexColors: true });
    this.points = new Points(g, m);
    this.points.layers.set(LAYER_HELPERS);
    this.points.renderOrder = renderOrder;
    this.points.frustumCulled = false;
  }

  get size(): number {
    return (this.points.material as PointsMaterial).size;
  }

  setSize(px: number): void {
    (this.points.material as PointsMaterial).size = px;
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.posAttr.needsUpdate = true;
  }

  setColor(i: number, hex: string): void {
    this.color.set(hex);
    this.colors[i * 3] = this.color.r;
    this.colors[i * 3 + 1] = this.color.g;
    this.colors[i * 3 + 2] = this.color.b;
    this.colAttr.needsUpdate = true;
  }

  /** 범위 밖으로 숨기기(개수를 줄일 수 없어 멀리 보낸다) */
  hide(i: number): void {
    this.setPosition(i, 0, -1e6, 0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}
