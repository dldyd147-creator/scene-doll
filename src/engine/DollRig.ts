import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import type { DollInstance, Gender, JointRotations, Quat } from '../model/types';
import { EFFECTOR_NAMES, IK_CHAINS, type BuiltSkeleton } from './skeleton';
import { dollHighlightMaterial, dollMaterial, handleMaterial, LAYER_HELPERS, TOON_FLAT, TOON_TWO_STEP } from './materials';
import { mirrorJoints } from './mirror';
import { fromQuat, roundTo, toQuat } from './three-utils';

const IDENTITY = new Quaternion();
const _v = new Vector3();

/** IK 핸들 메시 */
export interface DollHandle extends Mesh {
  userData: { dollId: string; effector: string };
}

/**
 * 돌의 공통 뼈대 조작·직렬화·헬퍼.
 * 몸(메시)은 하위 클래스가 붙인다: 코드 마네킹(MannequinRig), GLB 스킨 메시(GlbDollRig).
 * - 관절 회전은 '돌 공간, 휴식 자세 대비' 쿼터니언으로 읽고 쓴다
 * - 손·발 IK 핸들, 선택 관절 표시, 바닥 링은 scene에 직접 놓이는 helpers 그룹에 둔다(돌 스케일과 무관)
 */
export abstract class DollRig {
  readonly root = new Group();
  readonly helpers = new Group();
  readonly handles = new Map<string, DollHandle>();
  readonly jointMarker: Mesh;
  readonly groundRing: Mesh;
  color: string;
  heightCm: number;
  shading = true;
  protected baseMat: MeshToonMaterial;
  protected hiMat: MeshToonMaterial;
  protected highlighted: string | null = null;
  private handleRadius = 0.022;

  /** 레이캐스트 대상 메시들. userData.dollId가 있어야 한다 */
  abstract readonly pickTargets: Object3D[];
  /** 레이캐스트 결과 → 그 부위를 움직이는 뼈 이름 */
  abstract boneFromHit(hit: Intersection): string | null;
  /** 몸 메시의 월드 바운딩 박스 */
  protected abstract bodyBounds(): Box3;
  /** 부위 강조(지원하는 돌만) */
  protected abstract highlightParts(bone: string | null): void;

  protected constructor(
    readonly id: string,
    readonly gender: Gender,
    readonly dollId: string,
    color: string,
    heightCm: number,
    readonly skel: BuiltSkeleton,
    /** root 스케일이 1일 때의 키. 마네킹은 1.0(비율 단위), GLB는 미터 단위 실제 키 */
    readonly unitHeight: number,
    /** 몸 메시·뼈대가 들어 있는 객체. null이면 뼈대 루트 자체 */
    bodyRoot: Object3D | null,
  ) {
    this.color = color;
    this.heightCm = heightCm;
    this.root.name = `doll:${id}`;
    this.root.add(bodyRoot ?? skel.root);
    this.baseMat = dollMaterial(color, true);
    this.hiMat = dollHighlightMaterial(color, true);

    const handleGeo = new SphereGeometry(1, 16, 12);
    for (const name of EFFECTOR_NAMES) {
      if (!skel.bones.has(IK_CHAINS[name].end)) continue;
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
    this.root.scale.setScalar(cm / 100 / this.unitHeight);
    this.root.updateMatrixWorld(true);
  }

  setShading(on: boolean): void {
    if (this.shading === on) return;
    this.shading = on;
    for (const m of [this.baseMat, this.hiMat]) {
      m.gradientMap = on ? TOON_TWO_STEP : TOON_FLAT;
      m.needsUpdate = true;
    }
  }

  setHandleRadius(r: number): void {
    this.handleRadius = r;
    for (const h of this.handles.values()) h.scale.setScalar(r);
  }

  setHighlight(bone: string | null): void {
    if (this.highlighted === bone) return;
    this.highlighted = bone;
    this.highlightParts(bone);
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
      const parent = this.skel.parents.get(name) ?? null;
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
      const parent = this.skel.parents.get(name) ?? null;
      const pq = parent ? dq.get(parent)! : IDENTITY;
      bone.quaternion.copy(pq.clone().invert().multiply(desired));
      dq.set(name, desired);
    }
    this.root.updateMatrixWorld(true);
  }

  private restLocalQuat(name: string): Quaternion {
    const rest = this.skel.rest.get(name)!;
    const parent = this.skel.parents.get(name) ?? null;
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
        if (this.skel.parents.get(child) === name) this.resetJoint(child, true);
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
    this.root.updateMatrixWorld(true);
    return this.bodyBounds();
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
      this.worldPos(IK_CHAINS[name].end, _v);
      h.position.copy(_v);
    }
    if (this.highlighted && this.skel.bones.has(this.highlighted)) {
      this.worldPos(this.highlighted, _v);
      this.jointMarker.position.copy(_v);
    }
    this.groundRing.position.set(this.root.position.x, 0.003, this.root.position.z);
    this.groundRing.scale.setScalar(Math.max(0.5, this.heightCm / 175));
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
