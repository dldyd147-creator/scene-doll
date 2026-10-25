// 소품(3단계)의 3D 객체: 기본 도형 또는 GLB를 돌과 같은 2단 셀 명암·외곽선으로 그린다.
// 손에 쥔 소품은 엔진이 매 프레임 손 뼈의 월드 변환(크기 제거) × 쥐기 오프셋으로 자리를 맞춘다.
import { Box3, BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshToonMaterial, Object3D, SphereGeometry, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { PropAsset, PropInstance } from '../model/types';
import { DEFAULT_PROP_COLOR } from '../model/props';
import { TOON_FLAT, TOON_TWO_STEP } from './materials';
import { outlineForMesh, outlineMaterial } from './overlays';

/** GLB 소품 템플릿(파싱된 씬). 저장소 바이트는 콜백으로 받아 한 번만 파싱한다 */
const templates = new Map<string, Object3D>();
const loading = new Map<string, Promise<Object3D>>();

export function propTemplateIfLoaded(asset: PropAsset): Object3D | null {
  return templates.get(asset.id) ?? null;
}

export function loadPropTemplate(asset: PropAsset, bytes: () => Promise<ArrayBuffer | null>): Promise<Object3D> {
  const hit = templates.get(asset.id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(asset.id);
  if (!p) {
    p = bytes()
      .then(async (buf) => {
        if (!buf) throw new Error('GLB 파일이 저장소에 없습니다');
        const gltf = await new GLTFLoader().parseAsync(buf, '');
        gltf.scene.updateMatrixWorld(true);
        templates.set(asset.id, gltf.scene);
        loading.delete(asset.id);
        return gltf.scene;
      })
      .catch((e: unknown) => {
        loading.delete(asset.id);
        throw e;
      });
    loading.set(asset.id, p);
  }
  return p;
}

export function forgetPropTemplate(id: string): void {
  templates.delete(id);
}

/** 바닥에 놓을 때의 기준 높이. 기본 도형은 원점이 중심이라 높이의 절반, GLB는 모델 좌표 그대로 */
export function propRestHeight(asset: PropAsset): number {
  return asset.model.kind === 'primitive' ? asset.model.size[1] / 2 : 0;
}

const SELECT_EMISSIVE = new Color('#5a4300');
const NO_EMISSIVE = new Color('#000000');

export class PropObject {
  readonly root = new Group();
  readonly pickTargets: Object3D[] = [];
  /** 컷의 인스턴스 데이터(엔진이 반영한 최신 값) */
  inst: PropInstance;
  /** 기즈모·드래그·G/R로 움직이는 중: 인스턴스 값으로 되돌리지 않는다 */
  live = false;
  /** inst가 바뀌어 자리를 다시 맞춰야 함 */
  dirty = true;
  private materials: MeshToonMaterial[] = [];
  private outlineMat = outlineMaterial(0.004);
  private outlineMeshes: Mesh[] = [];
  private ownGeometries: BufferGeometry[] = [];
  private shading = true;

  constructor(
    readonly id: string,
    readonly asset: PropAsset,
    inst: PropInstance,
    template: Object3D | null,
  ) {
    this.inst = inst;
    this.root.name = `prop:${id}`;
    this.root.userData.propId = id;
    if (asset.model.kind === 'primitive') this.buildPrimitive(asset.model.shape, asset.model.size, asset.color ?? DEFAULT_PROP_COLOR);
    else if (template) this.buildFromTemplate(template, asset.color);
  }

  private addMesh(geometry: BufferGeometry, color: string, name: string): Mesh {
    const mat = new MeshToonMaterial({ color: new Color(color), gradientMap: TOON_TWO_STEP });
    const mesh = new Mesh(geometry, mat);
    mesh.name = name;
    mesh.userData.propId = this.id;
    this.materials.push(mat);
    this.outlineMeshes.push(outlineForMesh(mesh, this.outlineMat));
    this.pickTargets.push(mesh);
    return mesh;
  }

  private buildPrimitive(shape: 'box' | 'cylinder' | 'sphere', size: [number, number, number], color: string): void {
    let geometry: BufferGeometry;
    if (shape === 'sphere') geometry = new SphereGeometry(size[0] / 2, 24, 16);
    else if (shape === 'cylinder') geometry = new CylinderGeometry(size[0] / 2, size[0] / 2, size[1], 24);
    else geometry = new BoxGeometry(size[0], size[1], size[2]);
    this.ownGeometries.push(geometry);
    this.root.add(this.addMesh(geometry, color, `prop-${shape}`));
  }

  private buildFromTemplate(template: Object3D, color: string | undefined): void {
    const clone = template.clone(true);
    const meshes: Mesh[] = [];
    clone.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    for (const m of meshes) {
      const orig = Array.isArray(m.material) ? m.material[0] : m.material;
      const origColor = (orig as { color?: Color } | undefined)?.color;
      const mat = new MeshToonMaterial({ color: color ? new Color(color) : origColor ? origColor.clone() : new Color(DEFAULT_PROP_COLOR), gradientMap: TOON_TWO_STEP });
      m.material = mat;
      m.userData.propId = this.id;
      this.materials.push(mat);
      this.outlineMeshes.push(outlineForMesh(m, this.outlineMat));
      this.pickTargets.push(m);
    }
    this.root.add(clone);
  }

  setSelected(on: boolean): void {
    for (const m of this.materials) m.emissive.copy(on ? SELECT_EMISSIVE : NO_EMISSIVE);
  }

  /** 출력 패스용: 색을 잠시 바꾼다(null이면 원래 색으로) */
  setColorOverride(hex: string | null): void {
    for (const m of this.materials) {
      if (hex) {
        if (!m.userData.baseColor) m.userData.baseColor = m.color.getHex();
        m.color.set(hex);
      } else if (m.userData.baseColor !== undefined) {
        m.color.setHex(m.userData.baseColor as number);
        delete m.userData.baseColor;
      }
    }
  }

  /** 출력 패스용: 메시 재질을 잠시 바꾼다. 돌려준 함수로 되돌린다 */
  swapMaterials(material: Mesh['material']): () => void {
    const saved = this.pickTargets.map((o) => [o as Mesh, (o as Mesh).material] as const);
    for (const [m] of saved) m.material = material;
    return () => {
      for (const [m, mat] of saved) m.material = mat;
    };
  }

  get baseColor(): string {
    return this.asset.color ?? DEFAULT_PROP_COLOR;
  }

  setShading(on: boolean): void {
    if (this.shading === on) return;
    this.shading = on;
    for (const m of this.materials) {
      m.gradientMap = on ? TOON_TWO_STEP : TOON_FLAT;
      m.needsUpdate = true;
    }
  }

  setOutline(on: boolean): void {
    for (const m of this.outlineMeshes) m.visible = on;
  }

  worldBounds(): Box3 {
    this.root.updateMatrixWorld(true);
    return new Box3().setFromObject(this.root);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    this.outlineMat.dispose();
    for (const g of this.ownGeometries) g.dispose();
  }
}
