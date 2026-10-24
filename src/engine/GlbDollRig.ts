import { Bone, Box3, Object3D, SkinnedMesh, type Intersection, type Sphere } from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { DollAsset } from '../model/types';
import { DollRig } from './DollRig';
import { skeletonFromHierarchy } from './skeleton';
import type { DollTemplate } from './dollTemplates';

/**
 * GLB 스킨 메시 돌(MakeHuman 등). 템플릿을 복제해 쓰고, 관절 조작은 DollRig 공통 로직을 그대로 쓴다.
 * 부위 선택은 맞은 삼각형의 스킨 가중치가 가장 큰 뼈로 판정한다.
 */
export class GlbDollRig extends DollRig {
  readonly pickTargets: Object3D[];
  private readonly mesh: SkinnedMesh;

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
    this.mesh.material = this.baseMat;
    this.mesh.frustumCulled = false;
    this.mesh.userData = { dollId: id };
    this.pickTargets = meshes.map((m) => {
      m.material = this.baseMat;
      m.frustumCulled = false;
      m.userData = { dollId: id };
      // 휴식 자세 기준 바운딩 박스로 레이캐스트를 거르면 포즈를 바꾼 뒤 팔다리를 못 집는다
      m.geometry.boundingBox = null;
      return m;
    });
    this.setHeight(heightCm);
  }

  override prepareForPick(): void {
    // 스킨 메시의 바운딩 구를 현재 자세로 다시 계산하게 한다(three.js가 레이캐스트 때 계산)
    for (const m of this.pickTargets) (m as unknown as { boundingSphere: Sphere | null }).boundingSphere = null;
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

  protected bodyBounds(): Box3 {
    this.mesh.computeBoundingBox();
    return this.mesh.boundingBox!.clone().applyMatrix4(this.mesh.matrixWorld);
  }

  protected highlightParts(): void {
    /* 스킨 메시는 부위별 재질 교체가 없다. 선택 관절 표시(흰 점)로 대신한다 */
  }
}
