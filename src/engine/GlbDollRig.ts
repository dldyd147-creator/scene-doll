import { Bone, Box3, Object3D, SkinnedMesh, Vector3, type Intersection, type Sphere } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { DollAsset } from '../model/types';
import { DollRig, type CrosshairSpec } from './DollRig';
import { outlineForSkinned, outlineMaterial } from './overlays';
import { skeletonFromHierarchy, type BuiltSkeleton } from './skeleton';
import type { DollTemplate } from './dollTemplates';

interface BodyMeasure {
  headMin: Vector3;
  headMax: Vector3;
  /** 뼈 이름 → 정면(최대 z) */
  frontZ: Record<string, number>;
  /** 골반 아래(가랑이) 높이 */
  crotchY: number;
}

const measureCache = new Map<string, BodyMeasure>();

/**
 * 바인드 자세 정점을 뼈 가중치로 나눠 머리 상자·몸통 정면 깊이를 잰다(템플릿당 한 번).
 * 정점 좌표는 아마추어(=돌) 공간이다.
 */
function measureBody(assetId: string, mesh: SkinnedMesh, skel: BuiltSkeleton): BodyMeasure {
  const cached = measureCache.get(assetId);
  if (cached) return cached;
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const boneNames = mesh.skeleton.bones.map((b) => b.name);
  const headMin = new Vector3(Infinity, Infinity, Infinity);
  const headMax = new Vector3(-Infinity, -Infinity, -Infinity);
  const frontZ: Record<string, number> = {};
  let crotchY = Infinity;
  const torsoBones = new Set(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck']);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    let best = -1;
    let bestW = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bestW) {
        bestW = w;
        best = si.getComponent(i, k);
      }
    }
    if (best < 0) continue;
    const name = boneNames[best];
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (name === 'Head' || name === 'HeadTop_End') {
      headMin.min(v);
      headMax.max(v);
    } else if (torsoBones.has(name)) {
      if (Math.abs(v.x) < 0.035) frontZ[name] = Math.max(frontZ[name] ?? -Infinity, v.z);
      if (name === 'Hips' && Math.abs(v.x) < 0.02) crotchY = Math.min(crotchY, v.y);
    }
  }
  if (!Number.isFinite(headMin.x)) {
    const h = skel.rest.get('Head')?.pos ?? new Vector3(0, 1.5, 0);
    headMin.set(h.x - 0.08, h.y, h.z - 0.09);
    headMax.set(h.x + 0.08, h.y + 0.22, h.z + 0.1);
  }
  if (!Number.isFinite(crotchY)) crotchY = (skel.rest.get('Hips')?.pos.y ?? 1) - 0.15;
  const m = { headMin, headMax, frontZ, crotchY };
  measureCache.set(assetId, m);
  return m;
}

/**
 * GLB 스킨 메시 돌(MakeHuman 등). 템플릿을 복제해 쓰고, 관절 조작은 DollRig 공통 로직을 그대로 쓴다.
 * 부위 선택은 맞은 삼각형의 스킨 가중치가 가장 큰 뼈로 판정한다.
 */
export class GlbDollRig extends DollRig {
  readonly pickTargets: Object3D[];
  private readonly mesh: SkinnedMesh;
  private outlineMat = outlineMaterial(0.0055);

  constructor(id: string, asset: DollAsset, template: DollTemplate, color: string, heightCm: number) {
    const clone = SkeletonUtils.clone(template.scene);
    const meshes: SkinnedMesh[] = [];
    const roots: Bone[] = [];
    clone.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
      if ((o as Bone).isBone && !(o.parent as Bone | null)?.isBone) roots.push(o as Bone);
    });
    if (!meshes.length || !roots.length) throw new Error(`GLB에 스킨 메시 또는 뼈대가 없습니다: ${asset.glbPath}`);
    const skel = skeletonFromHierarchy(roots[0], asset.boneMap);
    super(id, asset.gender, asset.id, color, heightCm, skel, template.unitHeight, clone);
    this.mesh = meshes[0];
    this.pickTargets = meshes.map((m) => {
      m.material = this.baseMat;
      m.frustumCulled = false;
      m.userData = { dollId: id };
      // 휴식 자세 기준 바운딩 박스로 레이캐스트를 거르면 포즈를 바꾼 뒤 팔다리를 못 집는다
      m.geometry.boundingBox = null;
      this.outlineMeshes.push(outlineForSkinned(m, this.outlineMat, m.parent ?? clone));
      return m;
    });
    clone.updateMatrixWorld(true);
    this.buildGlbCrosshair(measureBody(asset.id, this.mesh, skel));
    this.setHeight(heightCm);
  }

  private buildGlbCrosshair(m: BodyMeasure): void {
    const y = (b: string) => this.skel.rest.get(b)?.pos.y ?? 0;
    const has = (b: string) => this.skel.bones.has(b);
    const center = new Vector3(0, (m.headMin.y + m.headMax.y) / 2, (m.headMin.z + m.headMax.z) / 2);
    const radii = new Vector3((m.headMax.x - m.headMin.x) / 2, (m.headMax.y - m.headMin.y) / 2, (m.headMax.z - m.headMin.z) / 2);
    const torso: CrosshairSpec['torso'] = [];
    const seg = (bone: string, child: string, fromY?: number) => {
      if (!has(bone) || !has(child)) return;
      const z = m.frontZ[bone] ?? m.frontZ.Spine1 ?? 0.1;
      torso.push({ bone, from: new Vector3(0, fromY ?? y(bone), z), to: new Vector3(0, y(child), z) });
    };
    seg('Spine2', 'Neck');
    seg('Spine1', 'Spine2');
    seg('Spine', 'Spine1');
    seg('Hips', 'Spine', m.crotchY + 0.03);
    this.buildCrosshair({ head: { bone: 'Head', center, radii }, torso, lift: 0.012 });
  }

  boneFromHit(hit: Intersection): string | null {
    const face = hit.face;
    const mesh = hit.object as SkinnedMesh;
    if (!face || !mesh.isSkinnedMesh) return null;
    const g = mesh.geometry;
    const si = g.getAttribute('skinIndex');
    const sw = g.getAttribute('skinWeight');
    if (!si || !sw) return null;
    const acc = new Map<number, number>();
    for (const vi of [face.a, face.b, face.c]) {
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(vi, k);
        if (w <= 0) continue;
        const bi = si.getComponent(vi, k);
        acc.set(bi, (acc.get(bi) ?? 0) + w);
      }
    }
    let best = -1;
    let bestW = 0;
    for (const [bi, w] of acc) {
      if (w > bestW) {
        bestW = w;
        best = bi;
      }
    }
    const bone = mesh.skeleton.bones[best];
    return bone && this.skel.bones.has(bone.name) ? bone.name : null;
  }

  override prepareForPick(): void {
    // 스킨 메시의 바운딩 구를 현재 자세로 다시 계산하게 한다(three.js가 레이캐스트 때 계산)
    for (const m of this.pickTargets) (m as unknown as { boundingSphere: Sphere | null }).boundingSphere = null;
  }

  protected bodyBounds(): Box3 {
    this.mesh.computeBoundingBox();
    return this.mesh.boundingBox!.clone().applyMatrix4(this.mesh.matrixWorld);
  }

  protected highlightParts(): void {
    /* 스킨 메시는 부위별 재질 교체가 없다. 선택 관절 표시(흰 점)로 대신한다 */
  }

  override dispose(): void {
    this.outlineMat.dispose();
    super.dispose();
  }
}
