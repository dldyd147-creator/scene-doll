import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { DollInstance, Gender, JointRotations, Quat } from '../model/types';
import { buildSkeleton, boneSpecs, EFFECTOR_NAMES, IK_CHAINS, proportionsFor, type BuiltSkeleton, type Proportions } from './skeleton';
import { dollHighlightMaterial, dollMaterial, handleMaterial, LAYER_HELPERS } from './materials';
import { mirrorJoints } from './mirror';
import { fromQuat, roundTo, toQuat } from './three-utils';

const IDENTITY = new Quaternion();
const _v = new Vector3();
const _box = new Box3();

/** 부위 메시 */
export interface DollPart extends Mesh {
  userData: { dollId: string; bone: string };
}

/** IK 핸들 메시 */
export interface DollHandle extends Mesh {
  userData: { dollId: string; effector: string };
}

/**
 * 코드로 만든 마네킹 돌.
 * - Mixamo 이름의 T포즈 뼈대 + 뼈마다 붙은 캡슐/타원체 부위(강체)
 * - 관절 회전은 '돌 공간, 휴식 자세 대비' 쿼터니언으로 읽고 쓴다
 * - 손·발 IK 핸들, 선택 관절 표시, 바닥 링은 scene에 직접 놓이는 helpers 그룹에 둔다(돌 스케일과 무관)
 */
export class DollRig {
  readonly root = new Group();
  readonly helpers = new Group();
  readonly skel: BuiltSkeleton;
  readonly parts: DollPart[] = [];
  readonly partsByBone = new Map<string, DollPart[]>();
  readonly handles = new Map<string, DollHandle>();
  readonly jointMarker: Mesh;
  readonly groundRing: Mesh;
  readonly proportions: Proportions;
  color: string;
  heightCm: number;
  shading = true;
  private baseMat: MeshToonMaterial;
  private hiMat: MeshToonMaterial;
  private highlighted: string | null = null;
  private handleRadius = 0.022;

  constructor(
    readonly id: string,
    readonly gender: Gender,
    color: string,
    heightCm: number,
  ) {
    this.color = color;
    this.heightCm = heightCm;
    this.proportions = proportionsFor(gender);
    this.skel = buildSkeleton(boneSpecs(this.proportions));
    this.root.name = `doll:${id}`;
    this.root.add(this.skel.root);
    this.baseMat = dollMaterial(color, true);
    this.hiMat = dollHighlightMaterial(color, true);
    this.buildParts();
    this.setHeight(heightCm);

    // 헬퍼: IK 핸들 4개, 선택 관절 표시, 바닥 링
    const handleGeo = new SphereGeometry(1, 16, 12);
    for (const name of EFFECTOR_NAMES) {
      const h = new Mesh(handleGeo, handleMaterial()) as unknown as DollHandle;
      h.userData = { dollId: id, effector: name };
      h.layers.set(LAYER_HELPERS);
      h.renderOrder = 10;
      h.scale.setScalar(this.handleRadius);
      this.handles.set(name, h);
      this.helpers.add(h);
    }
    this.jointMarker = new Mesh(
      new SphereGeometry(1, 12, 10),
      new MeshBasicMaterial({ color: '#ffffff', depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 }),
    );
    this.jointMarker.layers.set(LAYER_HELPERS);
    this.jointMarker.renderOrder = 11;
    this.jointMarker.scale.setScalar(0.014);
    this.jointMarker.visible = false;
    this.helpers.add(this.jointMarker);

    this.groundRing = new Mesh(
      new RingGeometry(0.24, 0.265, 48),
      new MeshBasicMaterial({ color: new Color(color), side: DoubleSide, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.groundRing.rotation.x = -Math.PI / 2;
    this.groundRing.layers.set(LAYER_HELPERS);
    this.groundRing.visible = false;
    this.helpers.add(this.groundRing);
    this.updateHelpers();
  }

  // ---------- 부위 메시 ----------

  private addPart(bone: string, geometry: BufferGeometry): void {
    const mesh = new Mesh(geometry, this.baseMat) as unknown as DollPart;
    mesh.userData = { dollId: this.id, bone };
    mesh.name = `part:${bone}`;
    this.skel.bones.get(bone)!.add(mesh);
    this.parts.push(mesh);
    const list = this.partsByBone.get(bone) ?? [];
    list.push(mesh);
    this.partsByBone.set(bone, list);
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

  // ---------- 모양 ----------

  setColor(hex: string): void {
    this.color = hex;
    this.baseMat.color.set(hex);
    this.hiMat.color.set(hex);
    (this.groundRing.material as MeshBasicMaterial).color.set(hex);
  }

  setHeight(cm: number): void {
    this.heightCm = cm;
    this.root.scale.setScalar(cm / 100);
  }

  setShading(on: boolean): void {
    if (this.shading === on) return;
    this.shading = on;
    const a = dollMaterial(this.color, on);
    const b = dollHighlightMaterial(this.color, on);
    this.baseMat.dispose();
    this.hiMat.dispose();
    this.baseMat = a;
    this.hiMat = b;
    for (const part of this.parts) part.material = part.userData.bone === this.highlighted ? b : a;
  }

  setHandleRadius(r: number): void {
    this.handleRadius = r;
    for (const h of this.handles.values()) h.scale.setScalar(r);
  }

  setHighlight(bone: string | null): void {
    if (this.highlighted === bone) return;
    if (this.highlighted) for (const m of this.partsByBone.get(this.highlighted) ?? []) m.material = this.baseMat;
    this.highlighted = bone;
    if (bone) for (const m of this.partsByBone.get(bone) ?? []) m.material = this.hiMat;
    this.jointMarker.visible = !!bone && this.skel.bones.has(bone);
  }

  setSelected(on: boolean): void {
    this.groundRing.visible = on;
  }

  // ---------- 관절 ----------

  /** 돌 공간 기준 뼈의 현재 회전 */
  private dollSpaceQuats(): Map<string, Quaternion> {
    const out = new Map<string, Quaternion>();
    for (const name of this.skel.order) {
      const bone = this.skel.bones.get(name)!;
      const parent = this.skel.specs.get(name)!.parent;
      const pq = parent ? out.get(parent)! : IDENTITY;
      out.set(name, pq.clone().multiply(bone.quaternion));
    }
    return out;
  }

  getJoints(): JointRotations {
    const out: JointRotations = {};
    const dq = this.dollSpaceQuats();
    for (const name of this.skel.order) {
      const rel = dq.get(name)!.clone().multiply(this.skel.rest.get(name)!.quat.clone().invert());
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      if (1 - rel.w > 1e-7) {
        out[name] = toQuat(rel).map((v) => roundTo(v, 5)) as Quat;
      }
    }
    return out;
  }

  setJoints(joints: JointRotations): void {
    const dq = new Map<string, Quaternion>();
    for (const name of this.skel.order) {
      const bone = this.skel.bones.get(name)!;
      const rest = this.skel.rest.get(name)!;
      const rel = joints[name] ? fromQuat(joints[name]).normalize() : IDENTITY;
      const desired = rel.clone().multiply(rest.quat);
      const parent = this.skel.specs.get(name)!.parent;
      const pq = parent ? dq.get(parent)! : IDENTITY;
      bone.quaternion.copy(pq.clone().invert().multiply(desired));
      dq.set(name, desired);
    }
    this.root.updateMatrixWorld(true);
  }

  private restLocalQuat(name: string): Quaternion {
    const rest = this.skel.rest.get(name)!;
    const parent = this.skel.specs.get(name)!.parent;
    if (!parent) return rest.quat.clone();
    return this.skel.rest.get(parent)!.quat.clone().invert().multiply(rest.quat);
  }

  /** 관절 초기화. recursive면 그 아래 뼈도 모두 */
  resetJoint(name: string, recursive: boolean): void {
    const bone = this.skel.bones.get(name);
    if (!bone) return;
    bone.quaternion.copy(this.restLocalQuat(name));
    if (recursive) {
      for (const child of this.skel.order) {
        if (this.skel.specs.get(child)!.parent === name) this.resetJoint(child, true);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  resetAll(): void {
    for (const name of this.skel.order) this.skel.bones.get(name)!.quaternion.copy(this.restLocalQuat(name));
    this.root.updateMatrixWorld(true);
  }

  mirror(): void {
    this.setJoints(mirrorJoints(this.getJoints()));
  }

  // ---------- 위치 ----------

  worldBounds(): Box3 {
    _box.makeEmpty();
    this.root.updateMatrixWorld(true);
    for (const part of this.parts) {
      part.geometry.computeBoundingBox();
      const bb = part.geometry.boundingBox!.clone().applyMatrix4(part.matrixWorld);
      _box.union(bb);
    }
    return _box.clone();
  }

  /** 가장 낮은 점을 바닥(y=0)에 붙인다 */
  snapToGround(): void {
    const b = this.worldBounds();
    if (b.isEmpty()) return;
    this.root.position.y -= b.min.y;
    this.root.updateMatrixWorld(true);
  }

  worldPos(bone: string, target = new Vector3()): Vector3 {
    const b = this.skel.bones.get(bone);
    if (!b) return target.set(0, 0, 0);
    return target.setFromMatrixPosition(b.matrixWorld);
  }

  /** 헬퍼(핸들·관절 표시·바닥 링) 위치를 뼈에 맞춘다. 매 프레임 호출 */
  updateHelpers(): void {
    for (const [name, h] of this.handles) {
      const chain = IK_CHAINS[name];
      this.worldPos(chain.end, _v);
      h.position.copy(_v);
    }
    if (this.highlighted && this.skel.bones.has(this.highlighted)) {
      this.worldPos(this.highlighted, _v);
      this.jointMarker.position.copy(_v);
    }
    this.groundRing.position.set(this.root.position.x, 0.003, this.root.position.z);
    const s = this.root.scale.x;
    this.groundRing.scale.setScalar(s);
  }

  // ---------- 직렬화 ----------

  applyInstance(inst: DollInstance): void {
    this.root.position.set(inst.position[0], inst.position[1], inst.position[2]);
    this.root.quaternion.set(inst.rotation[0], inst.rotation[1], inst.rotation[2], inst.rotation[3]);
    if (inst.heightCm !== this.heightCm) this.setHeight(inst.heightCm);
    if (inst.color.toLowerCase() !== this.color.toLowerCase()) this.setColor(inst.color);
    this.setJoints(inst.joints);
  }

  toInstance(base: DollInstance): DollInstance {
    const q = this.root.quaternion;
    return {
      ...base,
      heightCm: this.heightCm,
      color: this.color,
      position: [roundTo(this.root.position.x, 4), roundTo(this.root.position.y, 4), roundTo(this.root.position.z, 4)],
      rotation: [roundTo(q.x, 5), roundTo(q.y, 5), roundTo(q.z, 5), roundTo(q.w, 5)],
      joints: this.getJoints(),
    };
  }

  dispose(): void {
    for (const part of this.parts) part.geometry.dispose();
    this.baseMat.dispose();
    this.hiMat.dispose();
    for (const h of this.handles.values()) (h.material as MeshBasicMaterial).dispose();
    this.handles.values().next().value?.geometry.dispose();
    this.jointMarker.geometry.dispose();
    (this.jointMarker.material as MeshBasicMaterial).dispose();
    this.groundRing.geometry.dispose();
    (this.groundRing.material as MeshBasicMaterial).dispose();
    this.root.removeFromParent();
    this.helpers.removeFromParent();
  }
}
