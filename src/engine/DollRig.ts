import { Box3, Color, DoubleSide, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, Object3D, Quaternion, RingGeometry, Vector3, type Intersection } from 'three';
import type { DollInstance, Gender, JointRotations, Quat } from '../model/types';
import { drivenParent, EFFECTOR_NAMES, IK_CHAINS, isDrivenBone, type BuiltSkeleton } from './skeleton';
import { createDollMaterials, createLineUniforms, HANDLE_COLOR, HANDLE_DIM_COLOR, JOINT_COLOR, LAYER_HELPERS, SELECTED_JOINT_COLOR, TOON_FLAT, TOON_TWO_STEP, type LineParams, type LineUniforms } from './materials';
import { mirrorJoints } from './mirror';
import { circleTexture, MarkerPoints, ringTexture } from './overlays';
import { clampJointRotation, hingeCompose, hingeDecompose, limitFor, swingTwist } from './limits';
import { fromQuat, roundTo, toQuat } from './three-utils';

const IDENTITY = new Quaternion();
const _v = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _toCam = new Vector3();

/** 관절점을 찍을 뼈(IK 끝점 손·발은 핸들이 따로 있다) */
const JOINT_DOT_BONES = [
  'Head',
  'Neck',
  'Spine2',
  'Spine1',
  'Spine',
  'Hips',
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

/** 관절이 몸 안에 있으므로 제어점을 카메라 쪽으로 당길 거리(키 175cm 기준 m). 몸 두께의 절반 정도 */
const MARKER_PULL: Record<string, number> = {
  Head: 0.11,
  Neck: 0.06,
  Spine2: 0.13,
  Spine1: 0.12,
  Spine: 0.11,
  Hips: 0.12,
  LeftShoulder: 0.09,
  RightShoulder: 0.09,
  LeftArm: 0.06,
  RightArm: 0.06,
  LeftForeArm: 0.045,
  RightForeArm: 0.045,
  LeftHand: 0.035,
  RightHand: 0.035,
  LeftUpLeg: 0.09,
  RightUpLeg: 0.09,
  LeftLeg: 0.06,
  RightLeg: 0.06,
  LeftFoot: 0.05,
  RightFoot: 0.05,
  LeftToeBase: 0.04,
  RightToeBase: 0.04,
};

export type MarkerState = 'normal' | 'hover' | 'active';

/**
 * 돌의 공통 뼈대 조작·직렬화·제어점.
 * 몸(메시)은 하위 클래스가 붙인다: 코드 마네킹(MannequinRig), GLB 스킨 메시(GlbDollRig).
 * - 관절 회전은 '돌 공간, 휴식 자세 대비' 쿼터니언으로 읽고 쓴다
 * - 제어점(손·발 IK 핸들, 관절점, 선택 관절 링)은 화면 픽셀 크기가 일정한 점으로 그리고, 몸 뒤에 가려지면 보이지 않는다
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
  readonly lineParams: LineParams;
  /** 구동(트위스트) 뼈 */
  readonly drivenBones: string[];
  /** 관절점을 찍는 뼈(이 뼈대에 있는 것만) */
  readonly jointDotBones: string[];
  readonly effectors: string[];
  private ikMarkers: MarkerPoints;
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
    this.lineParams = lineParams;
    this.lineUniforms = createLineUniforms(lineParams);
    const mats = this.newMaterials();
    this.baseMat = mats.base;
    this.hiMat = mats.hi;
    this.drivenBones = skel.order.filter((n) => isDrivenBone(n) && skel.bones.has(drivenParent(n)));
    this.jointDotBones = JOINT_DOT_BONES.filter((n) => skel.bones.has(n));
    this.effectors = EFFECTOR_NAMES.filter((n) => skel.bones.has(IK_CHAINS[n].end));

    this.ikMarkers = new MarkerPoints(Math.max(1, this.effectors.length), 15, circleTexture(), 22);
    this.jointMarkers = new MarkerPoints(Math.max(1, this.jointDotBones.length), 8, circleTexture(), 20);
    this.selectedMarker = new MarkerPoints(1, 20, ringTexture(), 23);
    for (let i = 0; i < this.effectors.length; i++) this.ikMarkers.setColor(i, HANDLE_COLOR);
    for (let i = 0; i < this.jointDotBones.length; i++) this.jointMarkers.setColor(i, JOINT_COLOR);
    this.selectedMarker.setColor(0, SELECTED_JOINT_COLOR);
    this.jointMarkers.points.visible = false;
    this.selectedMarker.points.visible = false;
    this.helpers.add(this.ikMarkers.points, this.jointMarkers.points, this.selectedMarker.points);

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
  }

  setEffectorState(name: string, state: MarkerState): void {
    const i = this.effectors.indexOf(name);
    if (i < 0) return;
    this.ikMarkers.setColor(i, state === 'active' ? '#ffb020' : state === 'hover' ? '#ffe08a' : this.selected ? HANDLE_COLOR : HANDLE_DIM_COLOR);
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
   * ArmTwist·UpLegTwist(어깨·고관절 쪽 가중치): 그 팔다리 자신의 비틀림의 −50% → 몸통에서 팔로 비틀림이 서서히 시작
   * ForeArmTwist·LegTwist(손목·발목 쪽 가중치): 손·발 비틀림의 +80% → 손목이 접히지 않고 아래팔에 걸쳐 풀림
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
      if (/^(Left|Right)(Arm|UpLeg)Twist$/.test(tw)) {
        const gp = this.skel.parents.get(limb);
        const gpR = gp ? deltas.get(gp) : undefined;
        const J = (gpR ? gpR.clone().invert() : new Quaternion()).multiply(limbR);
        angle = -0.5 * swingTwist(J, axis).twistAngle;
      } else {
        const child = tw.endsWith('ForeArmTwist') ? limb.replace('ForeArm', 'Hand') : limb.replace('Leg', 'Foot');
        const childR = deltas.get(child);
        if (!childR) continue;
        const J = limbR.clone().invert().multiply(childR);
        angle = 0.8 * swingTwist(J, axis).twistAngle;
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

  /**
   * 경첩 관절(팔꿈치·무릎)의 아래 뼈가 월드 방향 dWorld를 가리키게 한다.
   * 경첩은 한 평면에서만 굽으므로, 먼저 위 뼈(위팔·허벅지)를 제 축 둘레로 비틀어 경첩 평면이 그 방향을 품게 하고 나서 굽힌다.
   * 디자인돌처럼 아래팔을 끌면 위팔이 알아서 돌아가는 느낌을 만든다. 경첩 한계가 없는 뼈면 false.
   */
  aimHinge(child: string, dWorld: Vector3): boolean {
    const limit = limitFor(child);
    const parent = this.skel.parents.get(child) ?? null;
    if (!limit?.hinge || !parent) return false;
    const deltas = this.jointDeltas();
    const Rp = deltas.get(parent)!;
    const a0 = this.skel.rest.get(parent)!.dir;
    const s0 = this.skel.rest.get(child)!.dir;
    const h0 = new Vector3(limit.hinge.axis[0], limit.hinge.axis[1], limit.hinge.axis[2]).normalize();
    const dDoll = dWorld.clone().applyQuaternion(this.root.quaternion.clone().invert()).normalize();
    // 부모 휴식 좌표계에서 본 목표 방향
    const dP = dDoll.clone().applyQuaternion(Rp.clone().invert());
    const dPerp = dP.clone().sub(a0.clone().multiplyScalar(dP.dot(a0)));
    if (dPerp.lengthSq() < 1e-6) return false;
    const u = dPerp.normalize();
    const n = new Vector3().crossVectors(a0, u).normalize();
    // 경첩 굽힘각은 아래 뼈의 휴식 방향(경첩 축에 수직인 성분)을 기준으로 잰다
    const base = s0.clone().sub(h0.clone().multiplyScalar(s0.dot(h0))).normalize();
    const hingeAngle = (dir: Vector3): number | null => {
      const dpp = dir.clone().sub(h0.clone().multiplyScalar(dir.dot(h0)));
      if (dpp.lengthSq() < 1e-8) return null;
      return Math.atan2(base.clone().cross(dpp).dot(h0), base.dot(dpp));
    };
    // 두 후보(경첩 법선 ±n) 중 굽힘이 허용 범위에 들고 비틀림이 작은 쪽
    const min = MathUtils.degToRad(limit.hinge.min);
    const max = MathUtils.degToRad(limit.hinge.max);
    const inRange = (t: number) => t >= min - 1e-3 && t <= max + 1e-3;
    let best: { tau: number; score: number } | null = null;
    for (const cand of [n, n.clone().negate()]) {
      const tau = Math.atan2(h0.clone().cross(cand).dot(a0), h0.dot(cand));
      const twist = new Quaternion().setFromAxisAngle(a0, tau);
      const theta = hingeAngle(dP.clone().applyQuaternion(twist.clone().invert()));
      if (theta === null) continue;
      const score = (inRange(theta) ? 0 : 10) + Math.abs(tau);
      if (!best || score < best.score) best = { tau, score };
    }
    if (!best) return false;
    // 위 뼈 비틀기(한계 안에서)
    this.setJointDelta(parent, Rp.clone().multiply(new Quaternion().setFromAxisAngle(a0, best.tau)));
    this.clampJoint(parent);
    // 비틀린 뒤 실제 경첩 평면에서 굽힘각을 다시 재서 적용
    const Rp2 = this.jointDelta(parent);
    const theta = hingeAngle(dDoll.clone().applyQuaternion(Rp2.clone().invert()));
    if (theta === null) return true;
    // 아래 뼈의 기존 비틀림(손목 회내 등)은 한계 안에서 유지한다
    const Jc = Rp2.clone().invert().multiply(deltas.get(child)!);
    const maxTwist = limit.twist !== undefined ? MathUtils.degToRad(limit.twist) : Infinity;
    const phi = Math.min(maxTwist, Math.max(-maxTwist, hingeDecompose(Jc, s0, h0).phi));
    this.setJointDelta(child, Rp2.clone().multiply(hingeCompose(s0, h0, Math.min(max, Math.max(min, theta)), phi)));
    return true;
  }

  /** 모든 관절을 한계 안으로(부모부터). 바뀐 관절 수 */
  clampAll(): number {
    let changed = 0;
    for (const name of this.skel.order) if (this.clampJoint(name)) changed++;
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

  /** 휴식 돌 공간의 점(뼈 기준)이 지금 월드 어디에 있는지 */
  restPointWorld(bone: string, restPoint: Vector3, target = new Vector3()): Vector3 {
    const b = this.skel.bones.get(bone);
    const rest = this.skel.rest.get(bone);
    if (!b || !rest) return target.copy(restPoint);
    const local = restPoint.clone().sub(rest.pos).applyQuaternion(rest.quat.clone().invert());
    return target.copy(local).applyMatrix4(b.matrixWorld);
  }

  /** 두 눈 사이(얼굴 앞면, 눈높이) 월드 위치 */
  eyeWorldPoint(target = new Vector3()): Vector3 {
    const p = this.lineParams;
    return this.restPointWorld('Head', new Vector3(0, p.eyeY, p.eyeZ), target);
  }

  /** 머리가 보는 방향(월드) */
  headForward(target = new Vector3()): Vector3 {
    return this.boneWorldDirection(this.skel.bones.has('Head') ? 'Head' : this.skel.order[0], new Vector3(0, 0, 1), target);
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

  /**
   * 몸의 가장 낮은 점(대략). 발바닥·발끝·손·골반·머리 뼈 위치에서 두께를 뺀 값으로, 매 조작마다 싸게 구한다.
   */
  lowestPointY(): number {
    const s = this.root.scale.x;
    let min = Infinity;
    const probe = (bone: string, below: number) => {
      if (!this.skel.bones.has(bone)) return;
      min = Math.min(min, this.worldPos(bone, _v).y - below * s);
    };
    for (const side of ['Left', 'Right']) {
      const ankle = this.skel.rest.get(`${side}Foot`)?.pos.y ?? 0.055;
      probe(`${side}Foot`, ankle);
      probe(`${side}ToeBase`, this.skel.rest.get(`${side}ToeBase`)?.pos.y ?? 0.012);
      probe(`${side}Toe_End`, 0);
      probe(`${side}Hand`, 0.03 * this.unitHeight);
      probe(`${side}Leg`, 0.035 * this.unitHeight); // 무릎 관절 중심에서 무릎뼈 아래까지 ≈ 6cm
      probe(`${side}ForeArm`, 0.045 * this.unitHeight);
    }
    probe('Hips', 0.055 * this.unitHeight); // 고관절 중심에서 엉덩이 바닥까지 ≈ 10cm(바닥에 앉을 수 있어야 한다)
    probe('Head', 0.1 * this.unitHeight);
    return Number.isFinite(min) ? min : 0;
  }

  worldPos(bone: string, target = new Vector3()): Vector3 {
    const b = this.skel.bones.get(bone);
    if (!b) return target.set(0, 0, 0);
    return target.setFromMatrixPosition(b.matrixWorld);
  }

  /** 제어점·링을 뼈에 맞춘다. 매 프레임 호출. cameraPos가 있으면 제어점을 카메라 쪽으로 몸 두께만큼 당겨 가려짐 판정을 맞춘다 */
  updateHelpers(cameraPos?: Vector3): void {
    this.updateDriven();
    const s = this.heightCm / 175;
    const place = (marker: MarkerPoints, i: number, bone: string) => {
      this.worldPos(bone, _v);
      if (cameraPos) {
        _toCam.copy(cameraPos).sub(_v);
        const d = _toCam.length();
        if (d > 1e-6) _v.add(_toCam.multiplyScalar(Math.min(d * 0.5, (MARKER_PULL[bone] ?? 0.06) * s) / d));
      }
      marker.setPosition(i, _v.x, _v.y, _v.z);
    };
    this.effectors.forEach((name, i) => place(this.ikMarkers, i, IK_CHAINS[name].end));
    if (this.selected) this.jointDotBones.forEach((name, i) => place(this.jointMarkers, i, name));
    if (this.highlighted && this.skel.bones.has(this.highlighted)) place(this.selectedMarker, 0, this.highlighted);
    this.groundRing.position.set(this.root.position.x, 0.003, this.root.position.z);
    this.groundRing.scale.setScalar(Math.max(0.5, s));
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
    this.jointMarkers.dispose();
    this.selectedMarker.dispose();
    this.groundRing.geometry.dispose();
    (this.groundRing.material as MeshBasicMaterial).dispose();
    this.root.removeFromParent();
    this.helpers.removeFromParent();
  }
}
