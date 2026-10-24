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
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { DollInstance, Gender, JointRotations, Quat } from '../model/types';
import { EFFECTOR_NAMES, IK_CHAINS, type BuiltSkeleton } from './skeleton';
import { dollHighlightMaterial, dollMaterial, handleMaterial, LAYER_HELPERS, TOON_FLAT, TOON_TWO_STEP } from './materials';
import { mirrorJoints } from './mirror';
import { makePolyline } from './overlays';
import { fromQuat, roundTo, toQuat } from './three-utils';

const IDENTITY = new Quaternion();
const _v = new Vector3();

/** IK 핸들 메시 */
export interface DollHandle extends Mesh {
  userData: { dollId: string; effector: string };
}

/** 십자선을 그리기 위한 몸 치수(돌 공간, 휴식 자세) */
export interface CrosshairSpec {
  head: { bone: string; center: Vector3; radii: Vector3 };
  /** 몸통 정중선 조각: 뼈와 돌 공간 시작·끝점 */
  torso: Array<{ bone: string; from: Vector3; to: Vector3 }>;
  /** 표면에서 띄우는 거리 */
  lift: number;
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
  outline = true;
  crosshair = true;
  protected baseMat: MeshToonMaterial;
  protected hiMat: MeshToonMaterial;
  protected highlighted: string | null = null;
  protected outlineMeshes: Object3D[] = [];
  protected crosshairLines: Line2[] = [];
  private restFrames = new Map<string, Object3D>();
  private handleRadius = 0.022;

  /** 레이캐스트 대상 메시들. userData.dollId가 있어야 한다 */
  abstract readonly pickTargets: Object3D[];
  /** 레이캐스트 결과 → 그 부위를 움직이는 뼈 이름 */
  abstract boneFromHit(hit: Intersection): string | null;
  /** 몸 메시의 월드 바운딩 박스 */
  protected abstract bodyBounds(): Box3;
  /** 부위 강조(지원하는 돌만) */
  protected abstract highlightParts(bone: string | null): void;
  /** 레이캐스트 직전 호출: 자세가 바뀐 메시의 바운딩을 갱신할 기회 */
  prepareForPick(): void {}

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

  setOutline(on: boolean): void {
    this.outline = on;
    for (const m of this.outlineMeshes) m.visible = on;
  }

  setCrosshair(on: boolean): void {
    this.crosshair = on;
    for (const l of this.crosshairLines) l.visible = on;
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

  // ---------- 십자선 ----------

  /** 뼈에 붙되 축은 돌 공간(휴식 자세)과 같은 보조 좌표계 */
  protected restFrame(bone: string): Object3D | null {
    const b = this.skel.bones.get(bone);
    if (!b) return null;
    let f = this.restFrames.get(bone);
    if (!f) {
      f = new Object3D();
      f.name = `frame:${bone}`;
      f.quaternion.copy(this.skel.rest.get(bone)!.quat).invert();
      b.add(f);
      this.restFrames.set(bone, f);
    }
    return f;
  }

  /** 머리 십자선(얼굴 중심 세로선·눈높이 가로선)과 몸통 정중선을 만든다 */
  protected buildCrosshair(spec: CrosshairSpec): void {
    const { head, torso, lift } = spec;
    const headFrame = this.restFrame(head.bone);
    if (headFrame) {
      const origin = this.skel.rest.get(head.bone)!.pos;
      const c = head.center.clone().sub(origin);
      const r = head.radii;
      const face: Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = -0.92 + (1.84 * i) / 16;
        face.push(new Vector3(c.x, c.y + r.y * t, c.z + (r.z + lift) * Math.sqrt(Math.max(0, 1 - t * t))));
      }
      const eyes: Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const s = -0.88 + (1.76 * i) / 12;
        eyes.push(new Vector3(c.x + r.x * s, c.y + r.y * 0.04, c.z + (r.z + lift) * Math.sqrt(Math.max(0, 1 - s * s))));
      }
      for (const pts of [face, eyes]) {
        const line = makePolyline(pts);
        headFrame.add(line);
        this.crosshairLines.push(line);
      }
    }
    for (const seg of torso) {
      const f = this.restFrame(seg.bone);
      if (!f) continue;
      const origin = this.skel.rest.get(seg.bone)!.pos;
      const a = seg.from.clone().sub(origin);
      const b = seg.to.clone().sub(origin);
      a.z += lift;
      b.z += lift;
      const line = makePolyline([a, b]);
      f.add(line);
      this.crosshairLines.push(line);
    }
    this.setCrosshair(this.crosshair);
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
      // 0.25° 미만은 휴식 자세로 본다(GLB 뼈대의 부동소수점 노이즈가 관절값으로 남지 않게)
      if (1 - rel.w > 2.5e-6) {
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

  /** 돌 공간에서 이 뼈가 휴식 자세 대비 얼마나 돌았는지(월드 회전 아님) */
  jointDelta(name: string): Quaternion {
    const dq = this.dollSpaceQuats().get(name);
    if (!dq) return new Quaternion();
    return dq.multiply(this.skel.rest.get(name)!.quat.clone().invert());
  }

  /** 뼈의 현재 월드 방향: 휴식 자세에서 돌 공간 dir이던 방향이 지금 어디를 보는지 */
  boneWorldDirection(name: string, restDir: Vector3, target = new Vector3()): Vector3 {
    const b = this.skel.bones.get(name);
    if (!b) return target.copy(restDir);
    b.getWorldQuaternion(_q2);
    const restQ = this.skel.rest.get(name)!.quat;
    return target.copy(restDir).applyQuaternion(restQ.clone().invert()).applyQuaternion(_q2);
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
    for (const l of this.crosshairLines) l.geometry.dispose();
    this.root.removeFromParent();
    this.helpers.removeFromParent();
  }
}

const _q2 = new Quaternion();
