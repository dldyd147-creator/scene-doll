import { Bone, Box3, BufferAttribute, Object3D, SkinnedMesh, Vector3, type Intersection, type Sphere } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { DollAsset } from '../model/types';
import { DollRig } from './DollRig';
import type { LineParams } from './materials';
import { outlineForSkinned, outlineMaterial } from './overlays';
import { skeletonFromHierarchy, type BuiltSkeleton } from './skeleton';
import type { DollTemplate } from './dollTemplates';

interface BodyMeasure {
  headMin: Vector3;
  headMax: Vector3;
  /** 골반 아래(가랑이) 높이 */
  crotchY: number;
  neckY: number;
}

const measureCache = new Map<string, BodyMeasure>();

/**
 * 바인드 자세 정점을 뼈 가중치로 나눠 머리 상자·가랑이 높이를 재고, 십자선용 영역 속성(aRegion: 머리 가중치, 몸통 가중치)을
 * 지오메트리에 붙인다(템플릿당 한 번, 복제본은 지오메트리를 공유한다). 정점 좌표는 아마추어(=돌) 공간이다.
 */
function measureBody(assetId: string, mesh: SkinnedMesh, skel: BuiltSkeleton): BodyMeasure {
  const cached = measureCache.get(assetId);
  if (cached) return cached;
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const boneNames = mesh.skeleton.bones.map((b) => b.name);
  const headSet = new Set(['Head', 'HeadTop_End']);
  const torsoSet = new Set(['Hips', 'Spine', 'Spine1', 'Spine2']);
  const headMin = new Vector3(Infinity, Infinity, Infinity);
  const headMax = new Vector3(-Infinity, -Infinity, -Infinity);
  let crotchY = Infinity;
  const region = new Float32Array(pos.count * 2);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    let headW = 0;
    let torsoW = 0;
    let best = -1;
    let bestW = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      const name = boneNames[si.getComponent(i, k)];
      if (headSet.has(name)) headW += w;
      if (torsoSet.has(name)) torsoW += w;
      if (w > bestW) {
        bestW = w;
        best = si.getComponent(i, k);
      }
    }
    region[i * 2] = headW;
    region[i * 2 + 1] = torsoW;
    if (best < 0) continue;
    const name = boneNames[best];
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    if (headSet.has(name)) {
      headMin.min(v);
      headMax.max(v);
    } else if (name === 'Hips' && Math.abs(v.x) < 0.02) {
      crotchY = Math.min(crotchY, v.y);
    }
  }
  g.setAttribute('aRegion', new BufferAttribute(region, 2));
  if (!Number.isFinite(headMin.x)) {
    const h = skel.rest.get('Head')?.pos ?? new Vector3(0, 1.5, 0);
    headMin.set(h.x - 0.08, h.y, h.z - 0.09);
    headMax.set(h.x + 0.08, h.y + 0.22, h.z + 0.1);
  }
  if (!Number.isFinite(crotchY)) crotchY = (skel.rest.get('Hips')?.pos.y ?? 1) - 0.15;
  const neckY = skel.rest.get('Neck')?.pos.y ?? headMin.y - 0.05;
  const m = { headMin, headMax, crotchY, neckY };
  measureCache.set(assetId, m);
  return m;
}

function lineParamsFor(m: BodyMeasure): LineParams {
  return {
    headZ: (m.headMin.z + m.headMax.z) / 2,
    headHalfW: (m.headMax.x - m.headMin.x) / 2,
    eyeY: m.headMin.y + 0.5 * (m.headMax.y - m.headMin.y),
    torsoY: [m.crotchY + 0.03, m.neckY],
  };
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
    clone.updateMatrixWorld(true);
    const measure = measureBody(asset.id, meshes[0], skel);
    super(id, asset.gender, asset.id, color, heightCm, skel, template.unitHeight, clone, lineParamsFor(measure));
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
    this.setHeight(heightCm);
  }

  protected boneFromHitRaw(hit: Intersection): string | null {
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
    /* 스킨 메시는 부위별 재질 교체가 없다. 선택 관절 링으로 대신한다 */
  }

  override dispose(): void {
    this.outlineMat.dispose();
    super.dispose();
  }
}
