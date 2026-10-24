import { Box3, Color, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, Object3D, Quaternion, RingGeometry, Vector3, type Intersection } from 'three';
import type { DollInstance, Gender, JointRotations, Quat } from '../model/types';
import { drivenParent, EFFECTOR_NAMES, IK_CHAINS, isDrivenBone, type BuiltSkeleton } from './skeleton';
import { createDollMaterials, createLineUniforms, HANDLE_COLOR, HANDLE_DIM_COLOR, JOINT_COLOR, LAYER_HELPERS, SELECTED_JOINT_COLOR, TOON_FLAT, TOON_TWO_STEP, type LineParams, type LineUniforms } from './materials';
import { mirrorJoints } from './mirror';
import { circleTexture, MarkerPoints, ringTexture, squareTexture } from './overlays';
import { clampJointRotation, limitFor, swingTwist } from './limits';
import { fromQuat, roundTo, toQuat } from './three-utils';

const IDENTITY = new Quaternion();
const _v = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();

/** 관절점을 찍을 뼈(IK 끝점 손·발은 핸들이 따로 있다) */
const JOINT_DOT_BONES = [
  'Head',
  'Neck',
  'Spine2',
  'Spine1',
  'Spine',
  'LeftShoulder',
  'LeftArm',
  'LeftForeArm',
  'LeftUpLeg',
  'LeftLeg',
  'LeftToeBase',
  'RightShoulder',
  'RightArm',
  'RightForeArm',
  'RightUpLeg',
  'RightLeg',
  'RightToeBase',
];

export type MarkerState = 'normal' | 'hover' | 'active';

/**
 * 돌의 공통 뼈대 조작·직렬화·제어점.
 * 몸(메시)은 하위 클래스가 붙인다: 코드 마네킹(MannequinRig), GLB 스킨 메시(GlbDollRig).
 * - 관절 회전은 '돌 공간, 휴식 자세 대비' 쿼터니언으로 읽고 쓴다
 * - 제어점(손·발 IK 핸들, 골반 핸들, 관절점, 선택 관절 링)은 화면 픽셀 크기가 일정한 점으로 그린다
 * - 트위스트 뼈(…Twist)는 저장하지 않고 팔다리 회전에서 자동으로 구동한다
 */
export abstract class DollRig {
  readonly root = new Group();
  readonly helpers = new Group();
  readonly groundRing: Mesh;
  color: string;
  heightCm: number;
  shading = true;
  outline = true;
  crosshair = true;
  selected = false;
  protected materials: MeshToonMaterial[] = [];
  protected baseMat!: MeshToonMaterial;
  protected hiMat!: MeshToonMaterial;
  protected lineUniforms: LineUniforms;
  protected highlighted: string | null = null;
  protected outlineMeshes: Object3D[] = [];
  /** 구동(트위스트) 뼈 */
  readonly drivenBones: string[];
  /** 관절점을 찍는 뼈(이 뼈대에 있는 것만) */
  readonly jointDotBones: string[];
  readonly effectors: string[];
  private ikMarkers: MarkerPoints;
  private hipMarker: MarkerPoints;
  private jointMarkers: MarkerPoints;
  private selectedMarker: MarkerPoints;
  private markerScale = 1;

  /** 레이캐스트 대상 메시들. userData.dollId가 있어야 한다 */
  abstract readonly pickTargets: Object3D[];
  /** 레이캐스트 결과 → 그 부위를 움직이는 뼈 이름 */
  protected abstract boneFromHitRaw(hit: Intersection): string | null;
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
    lineParams: LineParams,
  ) {
    this.color = color;
    this.heightCm = heightCm;
    this.root.name = `doll:${id}`;
    this.root.add(bodyRoot ?? skel.root);
    this.lineUniforms = createLineUniforms(lineParams);
    const mats = this.newMaterials();
    this.baseMat = mats.base;
    this.hiMat = mats.hi;
    this.drivenBones = skel.order.filter((n) => isDrivenBone(n) && skel.bones.has(drivenParent(n)));
    this.jointDotBones = JOINT_DOT_BONES.filter((n) => skel.bones.has(n));
    this.effectors = EFFECTOR_NAMES.filter((n) => skel.bones.has(IK_CHAINS[n].end));

    this.ikMarkers = new MarkerPoints(Math.max(1, this.effectors.length), 15, circleTexture(), 22);
    this.hipMarker = new MarkerPoints(1, 16, squareTexture(), 21);
    this.jointMarkers = new MarkerPoints(Math.max(1, this.jointDotBones.length), 8, circleTexture(), 20);
    this.selectedMarker = new MarkerPoints(1, 20, ringTexture(), 23);
    for (let i = 0; i < this.effectors.length; i++) this.ikMarkers.setColor(i, HANDLE_COLOR);
    this.hipMarker.setColor(0, HANDLE_COLOR);
    for (let i = 0; i < this.jointDotBones.length; i++) this.jointMarkers.setColor(i, JOINT_COLOR);
    this.selectedMarker.setColor(0, SELECTED_JOINT_COLOR);
    this.jointMarkers.points.visible = false;
    this.selectedMarker.points.visible = false;
    this.helpers.add(this.ikMarkers.points, this.hipMarker.points, this.jointMarkers.points, this.selectedMarker.points);

    this.groundRing = new Mesh(
      new RingGeometry(0.24, 0.27, 48),
      new MeshBasicMaterial({ color: new Color(color), side: DoubleSide, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.groundRing.rotation.x = -Math.PI / 2;
    this.groundRing.layers.set(LAYER_HELPERS);
    this.groundRing.visible = false;
    this.helpers.add(this.groundRing);
  }

  /** 재질 한 쌍을 만든다(restMatrix: 마네킹 부위처럼 정점이 뼈 로컬일 때 돌 공간으로 옮기는 행렬) */
  protected newMaterials(restMatrix?: Matrix4): { base: MeshToonMaterial; hi: MeshToonMaterial } {
    const set = createDollMaterials(this.color, this.shading, this.lineUniforms, restMatrix);
    this.materials.push(set.base, set.hi);
    return set;
  }

  // ---------- 모양 ----------

  setColor(hex: string): void {
    this.color = hex;
    for (const m of this.materials) m.color.set(hex);
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
    for (const m of this.materials) {
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
    this.lineUniforms.uLineOn.value = on ? 1 : 0;
  }

  /** 십자선 두께(px). 출력 해상도에 맞춰 바꾼다 */
  setLinePx(px: number): void {
    this.lineUniforms.uLinePx.value = px;
  }

  /** 제어점 크기 배율 */
  setMarkerScale(mult: number): void {
    this.markerScale = mult;
    this.ikMarkers.setSize(15 * mult);
    this.hipMarker.setSize(16 * mult);
    this.jointMarkers.setSize(8 * mult);
    this.selectedMarker.setSize(20 * mult);
  }

  get markerScaleValue(): number {
    return this.markerScale;
  }

  setHighlight(bone: string | null): void {
    if (this.highlighted === bone) return;
    this.highlighted = bone;
    this.highlightParts(bone);
    this.selectedMarker.points.visible = !!bone && this.skel.bones.has(bone);
  }

  setSelected(on: boolean): void {
    this.selected = on;
    this.groundRing.visible = on;
    this.jointMarkers.points.visible = on;
    for (let i = 0; i < this.effectors.length; i++) this.ikMarkers.setColor(i, on ? HANDLE_COLOR : HANDLE_DIM_COLOR);
    this.hipMarker.setColor(0, on ? HANDLE_COLOR : HANDLE_DIM_COLOR);
  }

  setEffectorState(name: string, state: MarkerState): void {
    const i = this.effectors.indexOf(name);
    if (i < 0) return;
    this.ikMarkers.setColor(i, state === 'active' ? '#ffb020' : state === 'hover' ? '#ffe08a' : this.selected ? HANDLE_COLOR : HANDLE_DIM_COLOR);
  }

  setHipState(state: MarkerState): void {
    this.hipMarker.setColor(0, state === 'active' ? '#ffb020' : state === 'hover' ? '#ffe08a' : this.selected ? HANDLE_COLOR : HANDLE_DIM_COLOR);
  }

  /** 레이캐스트 결과 → 뼈 이름(트위스트 뼈는 그 팔다리로) */
  boneFromHit(hit: Intersection): string | null {
    const b = this.boneFromHitRaw(hit);
    return b && isDrivenBone(b) ? drivenParent(b) : b;
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

  /** 모든 뼈의 '휴식 대비 돌 공간 회전' */
  jointDeltas(): Map<string, Quaternion> {
    const dq = this.dollSpaceQuats();
    const out = new Map<string, Quaternion>();
    for (const name of this.skel.order) out.set(name, dq.get(name)!.clone().multiply(this.skel.rest.get(name)!.quat.clone().invert()));
    return out;
  }

  jointDelta(name: string): Quaternion {
    return this.jointDeltas().get(name) ?? new Quaternion();
  }

  /** 뼈 하나의 '휴식 대비 돌 공간 회전'을 R로 맞춘다(자식은 따라 움직인다) */
  setJointDelta(name: string, R: Quaternion): void {
    const bone = this.skel.bones.get(name);
    if (!bone) return;
    const parent = this.skel.parents.get(name) ?? null;
    let pq = IDENTITY;
    if (parent) {
      const dq = this.dollSpaceQuats();
      pq = dq.get(parent)!;
    }
    const desired = R.clone().multiply(this.skel.rest.get(name)!.quat);
    bone.quaternion.copy(pq.clone().invert().multiply(desired));
    bone.updateWorldMatrix(false, true);
  }

  getJoints(): JointRotations {
    const out: JointRotations = {};
    const deltas = this.jointDeltas();
    for (const name of this.skel.order) {
      if (isDrivenBone(name)) continue;
      const rel = deltas.get(name)!;
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      // 0.25° 미만은 휴식 자세로 본다(GLB 뼈대의 부동소수점 노이즈가 관절값으로 남지 않게)
      if (1 - rel.w > 2.5e-6) out[name] = toQuat(rel).map((v) => roundTo(v, 5)) as Quat;
    }
    return out;
  }

  setJoints(joints: JointRotations): void {
    const dq = new Map<string, Quaternion>();
    for (const name of this.skel.order) {
      const bone = this.skel.bones.get(name)!;
      const rest = this.skel.rest.get(name)!;
      const rel = joints[name] && !isDrivenBone(name) ? fromQuat(joints[name]).normalize() : IDENTITY;
      const desired = rel.clone().multiply(rest.quat);
      const parent = this.skel.parents.get(name) ?? null;
      const pq = parent ? dq.get(parent)! : IDENTITY;
      bone.quaternion.copy(pq.clone().invert().multiply(desired));
      dq.set(name, desired);
    }
    this.root.updateMatrixWorld(true);
    this.updateDriven();
  }

  /**
   * 트위스트 뼈 구동.
   * ArmTwist·UpLegTwist: 그 팔다리 자신의 비틀림의 −50%(어깨·고관절 쪽이 덜 꼬이게)
   * ForeArmTwist·LegTwist: 손·발 비틀림의 +50%(손목·발목 쪽이 따라 돌게)
   */
  updateDriven(): void {
    if (!this.drivenBones.length) return;
    const deltas = this.jointDeltas();
    for (const tw of this.drivenBones) {
      const limb = drivenParent(tw);
      const limbR = deltas.get(limb);
      if (!limbR) continue;
      const axis = this.skel.rest.get(limb)!.dir;
      let angle = 0;
      if (/(Arm|UpLeg)Twist$/.test(tw)) {
        const gp = this.skel.parents.get(limb);
        const gpR = gp ? deltas.get(gp) : undefined;
        const J = (gpR ? gpR.clone().invert() : new Quaternion()).multiply(limbR);
        angle = -0.5 * swingTwist(J, axis).twistAngle;
      } else {
        const child = tw.endsWith('ForeArmTwist') ? limb.replace('ForeArm', 'Hand') : limb.replace('Leg', 'Foot');
        const childR = deltas.get(child);
        if (!childR) continue;
        const J = limbR.clone().invert().multiply(childR);
        angle = 0.5 * swingTwist(J, axis).twistAngle;
      }
      const R = limbR.clone().multiply(_q.setFromAxisAngle(axis, angle));
      this.setJointDelta(tw, R);
    }
  }

  /** 관절 하나를 한계 안으로. 바뀌었으면 true */
  clampJoint(name: string): boolean {
    const limit = limitFor(name);
    if (!limit || isDrivenBone(name)) return false;
    const parent = this.skel.parents.get(name) ?? null;
    const deltas = this.jointDeltas();
    const R = deltas.get(name);
    if (!R) return false;
    const P = parent ? deltas.get(parent)! : IDENTITY;
    const J = P.clone().invert().multiply(R);
    const fixed = clampJointRotation(J, this.skel.rest.get(name)!.dir, limit);
    if (!fixed) return false;
    this.setJointDelta(name, P.clone().multiply(fixed));
    return true;
  }

  /** 모든 관절을 한계 안으로(부모부터). 하나라도 바뀌었으면 true */
  clampAll(): boolean {
    let changed = false;
    for (const name of this.skel.order) if (this.clampJoint(name)) changed = true;
    if (changed) this.root.updateMatrixWorld(true);
    return changed;
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

  /** 골반(돌 이동 핸들) 위치 */
  hipWorldPos(target = new Vector3()): Vector3 {
    return this.worldPos(this.skel.order[0], target);
  }

  /** 제어점·링을 뼈에 맞춘다. 매 프레임 호출 */
  updateHelpers(): void {
    this.updateDriven();
    this.effectors.forEach((name, i) => {
      this.worldPos(IK_CHAINS[name].end, _v);
      this.ikMarkers.setPosition(i, _v.x, _v.y, _v.z);
    });
    this.hipWorldPos(_v);
    this.hipMarker.setPosition(0, _v.x, _v.y, _v.z);
    if (this.selected) {
      this.jointDotBones.forEach((name, i) => {
        this.worldPos(name, _v);
        this.jointMarkers.setPosition(i, _v.x, _v.y, _v.z);
      });
    }
    if (this.highlighted && this.skel.bones.has(this.highlighted)) {
      this.worldPos(this.highlighted, _v);
      this.selectedMarker.setPosition(0, _v.x, _v.y, _v.z);
    }
    this.groundRing.position.set(this.root.position.x, 0.003, this.root.position.z);
    this.groundRing.scale.setScalar(Math.max(0.5, this.heightCm / 175));
  }

  /** 바닥 링 반지름(월드) */
  get groundRingRadius(): number {
    return 0.255 * Math.max(0.5, this.heightCm / 175);
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
    for (const m of this.materials) m.dispose();
    this.ikMarkers.dispose();
    this.hipMarker.dispose();
    this.jointMarkers.dispose();
    this.selectedMarker.dispose();
    this.groundRing.geometry.dispose();
    (this.groundRing.material as MeshBasicMaterial).dispose();
    this.root.removeFromParent();
    this.helpers.removeFromParent();
  }
}
