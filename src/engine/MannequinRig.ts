import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Matrix4, Mesh, MeshToonMaterial, Object3D, SphereGeometry, type Intersection } from 'three';
import type { DollAsset } from '../model/types';
import { DollRig } from './DollRig';
import { outlineForMesh, outlineMaterial } from './overlays';
import { buildSkeleton, boneSpecs, proportionsFor, type BuiltSkeleton, type Proportions } from './skeleton';

/** 부위 메시 */
export interface DollPart extends Mesh {
  userData: { dollId: string; bone: string };
}

const _box = new Box3();

/** 십자선이 그려지는 부위: 머리(얼굴선), 몸통(정중선) */
const LINE_PARTS: Record<string, [number, number]> = { Head: [1, 0], Spine2: [0, 1], Spine1: [0, 1], Spine: [0, 1], Hips: [0, 1] };

function lineParamsFor(skel: BuiltSkeleton, p: Proportions) {
  const y = (b: string) => skel.rest.get(b)!.pos.y;
  return {
    headZ: 0.008,
    headHalfW: p.headRx,
    eyeY: y('Head') + p.headRy,
    eyeZ: 0.008 + p.headRz,
    torsoY: [y('Hips') - 0.01 - p.pelvisRy * 0.85, y('Neck')] as [number, number],
  };
}

/**
 * 코드로 만든 캡슐 마네킹(단순 돌). Mixamo 이름의 T포즈 뼈대에 뼈마다 캡슐/타원체/상자(강체)를 붙인다.
 * 높이 1.0 비율 단위로 만들고 root 스케일로 키를 맞춘다.
 */
export class MannequinRig extends DollRig {
  readonly pickTargets: Object3D[] = [];
  readonly parts: DollPart[] = [];
  readonly partsByBone = new Map<string, DollPart[]>();
  readonly proportions: Proportions;
  private outlineMat = outlineMaterial(0.0032);
  /** 부위별 재질(십자선 부위는 뼈 휴식 행렬이 다른 전용 재질) */
  private partMats = new Map<string, { base: MeshToonMaterial; hi: MeshToonMaterial }>();

  constructor(id: string, asset: DollAsset, color: string, heightCm: number) {
    const proportions = proportionsFor(asset.gender);
    const skel = buildSkeleton(boneSpecs(proportions));
    super(id, asset.gender, asset.id, color, heightCm, skel, 1, null, lineParamsFor(skel, proportions));
    this.proportions = proportions;
    this.buildParts();
    this.setHeight(heightCm);
  }

  private addPart(bone: string, geometry: BufferGeometry): void {
    let mats = { base: this.baseMat, hi: this.hiMat };
    const region = LINE_PARTS[bone];
    if (region) {
      const rest = this.skel.rest.get(bone)!;
      const restMatrix = new Matrix4().compose(rest.pos, rest.quat, new Object3D().scale);
      mats = this.newMaterials(restMatrix);
      const n = geometry.getAttribute('position').count;
      const arr = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        arr[i * 2] = region[0];
        arr[i * 2 + 1] = region[1];
      }
      geometry.setAttribute('aRegion', new BufferAttribute(arr, 2));
    }
    this.partMats.set(bone, mats);
    const mesh = new Mesh(geometry, mats.base) as unknown as DollPart;
    mesh.userData = { dollId: this.id, bone };
    mesh.name = `part:${bone}`;
    this.skel.bones.get(bone)!.add(mesh);
    this.parts.push(mesh);
    this.pickTargets.push(mesh);
    const list = this.partsByBone.get(bone) ?? [];
    list.push(mesh);
    this.partsByBone.set(bone, list);
    this.outlineMeshes.push(outlineForMesh(mesh, this.outlineMat));
  }

  private buildParts(): void {
    const p = this.proportions;
    const len = (b: string) => this.skel.rest.get(b)!.length;
    const capsule = (r: number, L: number, zScale = 1) => {
      const g = new CapsuleGeometry(r, L, 6, 16);
      g.translate(0, L / 2, 0);
      if (zScale !== 1) g.scale(1, 1, zScale);
      return g;
    };
    const ellipsoid = (rx: number, ry: number, rz: number, cx: number, cy: number, cz: number) => {
      const g = new SphereGeometry(1, 24, 16);
      g.scale(rx, ry, rz);
      g.translate(cx, cy, cz);
      return g;
    };
    const box = (sx: number, sy: number, sz: number, cx: number, cy: number, cz: number) => {
      const g = new BoxGeometry(sx, sy, sz, 1, 1, 1);
      g.translate(cx, cy, cz);
      return g;
    };

    this.addPart('Hips', ellipsoid(p.pelvisRx, p.pelvisRy, p.pelvisRz, 0, -0.01, 0));
    this.addPart('Spine', capsule(p.waistR, len('Spine'), p.waistZ));
    this.addPart('Spine1', capsule((p.waistR + p.chestRx) * 0.48, len('Spine1'), 0.85));
    this.addPart('Spine2', ellipsoid(p.chestRx, p.chestRy, p.chestRz, 0, 0.012, 0));
    this.addPart('Neck', capsule(p.neckR, len('Neck')));
    this.addPart('Head', ellipsoid(p.headRx, p.headRy, p.headRz, 0, p.headRy, 0.008));

    for (const s of ['Left', 'Right'] as const) {
      this.addPart(`${s}Shoulder`, capsule(p.clavicleR, len(`${s}Shoulder`)));
      this.addPart(`${s}Arm`, capsule(p.upperArmR, len(`${s}Arm`)));
      this.addPart(`${s}ForeArm`, capsule(p.foreArmR, len(`${s}ForeArm`)));
      this.addPart(`${s}Hand`, ellipsoid(p.handT, p.hand / 2, p.handW / 2, 0, p.hand / 2, 0));
      this.addPart(`${s}UpLeg`, capsule(p.thighR, len(`${s}UpLeg`)));
      this.addPart(`${s}Leg`, capsule(p.calfR, len(`${s}Leg`)));
      const footL = len(`${s}Foot`);
      this.addPart(`${s}Foot`, box(p.footW, footL + p.heel, p.footH, 0, (footL - p.heel) / 2, -p.footH / 2 - 0.006));
      const toeL = len(`${s}ToeBase`);
      this.addPart(`${s}ToeBase`, box(p.footW * 0.95, toeL + 0.01, p.footH * 0.6, 0, toeL / 2, -0.001));
    }
  }

  protected boneFromHitRaw(hit: Intersection): string | null {
    const ud = hit.object.userData as Partial<DollPart['userData']>;
    return ud.bone ?? null;
  }

  protected bodyBounds(): Box3 {
    _box.makeEmpty();
    for (const part of this.parts) {
      part.geometry.computeBoundingBox();
      _box.union(part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld));
    }
    return _box.clone();
  }

  protected highlightParts(bone: string | null): void {
    for (const part of this.parts) {
      const mats = this.partMats.get(part.userData.bone)!;
      part.material = part.userData.bone === bone ? mats.hi : mats.base;
    }
  }

  override dispose(): void {
    for (const part of this.parts) part.geometry.dispose();
    this.outlineMat.dispose();
    super.dispose();
  }
}
