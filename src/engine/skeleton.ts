import { Bone, Matrix4, Quaternion, Vector3 } from 'three';
import type { Gender, Vec3 } from '../model/types';

/**
 * 뼈대 정의. 뼈 이름은 Mixamo 표준(접두어 없음).
 * 좌표: 키를 1.0으로 본 비율. +Y 위, +Z 정면(캐릭터가 바라보는 방향), +X 캐릭터의 왼쪽.
 */
export interface Proportions {
  headTop: number; headJoint: number; neck: number; spine2: number; spine1: number; spine: number; hips: number;
  shoulderY: number; clavicleX: number; shoulderX: number; upperArm: number; foreArm: number; hand: number;
  hipX: number; hipJointY: number; knee: number; ankle: number; ankleZ: number; toeBaseY: number; toeBaseZ: number; toeEndZ: number;
  headRx: number; headRy: number; headRz: number; neckR: number;
  chestRx: number; chestRy: number; chestRz: number; waistR: number; waistZ: number;
  pelvisRx: number; pelvisRy: number; pelvisRz: number;
  clavicleR: number; upperArmR: number; foreArmR: number; handW: number; handT: number;
  thighR: number; calfR: number; footW: number; footH: number; heel: number;
}

export const MALE_PROPORTIONS: Proportions = {
  headTop: 1.0, headJoint: 0.855, neck: 0.815, spine2: 0.72, spine1: 0.645, spine: 0.585, hips: 0.535,
  shoulderY: 0.805, clavicleX: 0.025, shoulderX: 0.12, upperArm: 0.165, foreArm: 0.145, hand: 0.105,
  hipX: 0.055, hipJointY: 0.505, knee: 0.285, ankle: 0.055, ankleZ: -0.01, toeBaseY: 0.012, toeBaseZ: 0.1, toeEndZ: 0.15,
  headRx: 0.074, headRy: 0.0725, headRz: 0.084, neckR: 0.03,
  chestRx: 0.105, chestRy: 0.085, chestRz: 0.075, waistR: 0.07, waistZ: 0.85,
  pelvisRx: 0.1, pelvisRy: 0.075, pelvisRz: 0.08,
  clavicleR: 0.026, upperArmR: 0.032, foreArmR: 0.027, handW: 0.05, handT: 0.014,
  thighR: 0.052, calfR: 0.04, footW: 0.052, footH: 0.04, heel: 0.045,
};

export const FEMALE_PROPORTIONS: Proportions = {
  headTop: 1.0, headJoint: 0.853, neck: 0.812, spine2: 0.715, spine1: 0.642, spine: 0.582, hips: 0.532,
  shoulderY: 0.8, clavicleX: 0.022, shoulderX: 0.105, upperArm: 0.16, foreArm: 0.14, hand: 0.1,
  hipX: 0.058, hipJointY: 0.502, knee: 0.283, ankle: 0.053, ankleZ: -0.01, toeBaseY: 0.012, toeBaseZ: 0.095, toeEndZ: 0.142,
  headRx: 0.072, headRy: 0.0735, headRz: 0.082, neckR: 0.026,
  chestRx: 0.093, chestRy: 0.08, chestRz: 0.07, waistR: 0.06, waistZ: 0.85,
  pelvisRx: 0.105, pelvisRy: 0.078, pelvisRz: 0.085,
  clavicleR: 0.022, upperArmR: 0.028, foreArmR: 0.023, handW: 0.045, handT: 0.012,
  thighR: 0.052, calfR: 0.037, footW: 0.046, footH: 0.035, heel: 0.04,
};

export function proportionsFor(gender: Gender): Proportions {
  return gender === 'female' ? FEMALE_PROPORTIONS : MALE_PROPORTIONS;
}

export interface BoneSpec {
  name: string;
  parent: string | null;
  pos: Vec3;
  /** 로컬 +Y가 가리킬 자식 뼈. 없으면 부모 방향을 물려받는다 */
  child?: string;
  /** 로컬 +Z를 정하는 힌트 벡터(기본 정면 +Z) */
  up?: Vec3;
}

const UP_Y: Vec3 = [0, 1, 0];

/** 비율표로 T포즈 뼈대 정의를 만든다 */
export function boneSpecs(p: Proportions): BoneSpec[] {
  const specs: BoneSpec[] = [
    { name: 'Hips', parent: null, pos: [0, p.hips, 0], child: 'Spine' },
    { name: 'Spine', parent: 'Hips', pos: [0, p.spine, 0], child: 'Spine1' },
    { name: 'Spine1', parent: 'Spine', pos: [0, p.spine1, 0], child: 'Spine2' },
    { name: 'Spine2', parent: 'Spine1', pos: [0, p.spine2, 0], child: 'Neck' },
    { name: 'Neck', parent: 'Spine2', pos: [0, p.neck, 0], child: 'Head' },
    { name: 'Head', parent: 'Neck', pos: [0, p.headJoint, 0], child: 'HeadTop_End' },
    { name: 'HeadTop_End', parent: 'Head', pos: [0, p.headTop, 0] },
  ];
  const side = (s: 'Left' | 'Right', sign: 1 | -1) => {
    const x = (v: number) => sign * v;
    specs.push(
      { name: `${s}Shoulder`, parent: 'Spine2', pos: [x(p.clavicleX), p.shoulderY, 0], child: `${s}Arm` },
      { name: `${s}Arm`, parent: `${s}Shoulder`, pos: [x(p.shoulderX), p.shoulderY, 0], child: `${s}ForeArm` },
      { name: `${s}ForeArm`, parent: `${s}Arm`, pos: [x(p.shoulderX + p.upperArm), p.shoulderY, 0], child: `${s}Hand` },
      { name: `${s}Hand`, parent: `${s}ForeArm`, pos: [x(p.shoulderX + p.upperArm + p.foreArm), p.shoulderY, 0] },
      { name: `${s}UpLeg`, parent: 'Hips', pos: [x(p.hipX), p.hipJointY, 0], child: `${s}Leg` },
      { name: `${s}Leg`, parent: `${s}UpLeg`, pos: [x(p.hipX), p.knee, 0], child: `${s}Foot` },
      { name: `${s}Foot`, parent: `${s}Leg`, pos: [x(p.hipX), p.ankle, p.ankleZ], child: `${s}ToeBase`, up: UP_Y },
      { name: `${s}ToeBase`, parent: `${s}Foot`, pos: [x(p.hipX), p.toeBaseY, p.toeBaseZ], child: `${s}Toe_End`, up: UP_Y },
      { name: `${s}Toe_End`, parent: `${s}ToeBase`, pos: [x(p.hipX), 0, p.toeEndZ], up: UP_Y },
    );
  };
  side('Left', 1);
  side('Right', -1);
  return specs;
}

export interface RestTransform {
  /** 돌 공간 휴식 위치 */
  pos: Vector3;
  /** 돌 공간 휴식 회전 */
  quat: Quaternion;
  /** 자식(또는 물려받은) 방향으로의 길이. 잎 뼈는 0 */
  length: number;
}

export interface BuiltSkeleton {
  root: Bone;
  bones: Map<string, Bone>;
  rest: Map<string, RestTransform>;
  /** 부모 → 자식 순서 */
  order: string[];
  specs: Map<string, BoneSpec>;
}

/** 로컬 +Y = dir, 로컬 +Z = hint에서 dir 성분을 뺀 것 */
export function frameQuat(dir: Vector3, hint: Vector3): Quaternion {
  const y = dir.clone().normalize();
  let z = hint.clone().sub(y.clone().multiplyScalar(hint.dot(y)));
  if (z.lengthSq() < 1e-8) {
    const alt = Math.abs(y.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    z = alt.sub(y.clone().multiplyScalar(alt.dot(y)));
  }
  z.normalize();
  const x = new Vector3().crossVectors(y, z).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/**
 * 뼈대 정의로 three.js Bone 계층을 만든다.
 * 각 뼈의 로컬 +Y는 자식 뼈를 가리킨다(Blender/Mixamo 규약). 회전 저장은 돌 공간 기준이라 이 규약에 의존하지 않는다.
 */
export function buildSkeleton(specList: BoneSpec[]): BuiltSkeleton {
  const specs = new Map(specList.map((s) => [s.name, s]));
  const rest = new Map<string, RestTransform>();
  const bones = new Map<string, Bone>();
  const order: string[] = [];

  const dirOf = (s: BoneSpec): Vector3 => {
    if (s.child && specs.has(s.child)) {
      const c = specs.get(s.child)!;
      return new Vector3(c.pos[0] - s.pos[0], c.pos[1] - s.pos[1], c.pos[2] - s.pos[2]);
    }
    if (s.parent && specs.has(s.parent)) return dirOf(specs.get(s.parent)!);
    return new Vector3(0, 1, 0);
  };

  // 부모가 먼저 오도록 정렬(입력이 이미 그 순서지만 안전하게)
  const pending = [...specList];
  while (pending.length) {
    const i = pending.findIndex((s) => s.parent === null || rest.has(s.parent));
    if (i < 0) throw new Error('뼈대 정의에 끊어진 부모가 있습니다');
    const s = pending.splice(i, 1)[0];
    const pos = new Vector3(...s.pos);
    const dir = dirOf(s);
    const hint = new Vector3(...(s.up ?? [0, 0, 1]));
    const quat = frameQuat(dir, hint);
    const length = s.child && specs.has(s.child) ? dir.length() : 0;
    rest.set(s.name, { pos, quat, length });

    const bone = new Bone();
    bone.name = s.name;
    if (s.parent) {
      const pr = rest.get(s.parent)!;
      const inv = pr.quat.clone().invert();
      bone.position.copy(pos.clone().sub(pr.pos).applyQuaternion(inv));
      bone.quaternion.copy(inv.multiply(quat));
      bones.get(s.parent)!.add(bone);
    } else {
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
    }
    bones.set(s.name, bone);
    order.push(s.name);
  }

  const root = bones.get(order[0])!;
  root.updateMatrixWorld(true);
  return { root, bones, rest, order, specs };
}

/** IK 끝점과 그 2-뼈 사슬(위 뼈, 아래 뼈, 끝 뼈). pole은 곧게 펴진 상태에서 팔꿈치/무릎이 향할 방향(돌 공간) */
export const IK_CHAINS: Record<string, { upper: string; lower: string; end: string; clavicle?: string; pole: Vec3 }> = {
  LeftHand: { upper: 'LeftArm', lower: 'LeftForeArm', end: 'LeftHand', clavicle: 'LeftShoulder', pole: [0, -0.4, -1] },
  RightHand: { upper: 'RightArm', lower: 'RightForeArm', end: 'RightHand', clavicle: 'RightShoulder', pole: [0, -0.4, -1] },
  LeftFoot: { upper: 'LeftUpLeg', lower: 'LeftLeg', end: 'LeftFoot', pole: [0, 0, 1] },
  RightFoot: { upper: 'RightUpLeg', lower: 'RightLeg', end: 'RightFoot', pole: [0, 0, 1] },
};

export const EFFECTOR_NAMES = Object.keys(IK_CHAINS);

/** 좌우 대칭 뼈 이름 */
export function mirrorBoneName(name: string): string {
  if (name.startsWith('Left')) return 'Right' + name.slice(4);
  if (name.startsWith('Right')) return 'Left' + name.slice(5);
  return name;
}

/** 사용자에게 보여줄 뼈(관절) 한글 이름 */
export const BONE_LABELS: Record<string, string> = {
  Hips: '골반', Spine: '허리', Spine1: '명치', Spine2: '가슴', Neck: '목', Head: '머리', HeadTop_End: '정수리',
  LeftShoulder: '왼쪽 어깨(쇄골)', LeftArm: '왼팔 위', LeftForeArm: '왼팔 아래', LeftHand: '왼손',
  RightShoulder: '오른쪽 어깨(쇄골)', RightArm: '오른팔 위', RightForeArm: '오른팔 아래', RightHand: '오른손',
  LeftUpLeg: '왼다리 위', LeftLeg: '왼다리 아래', LeftFoot: '왼발', LeftToeBase: '왼발 앞', LeftToe_End: '왼발 끝',
  RightUpLeg: '오른다리 위', RightLeg: '오른다리 아래', RightFoot: '오른발', RightToeBase: '오른발 앞', RightToe_End: '오른발 끝',
};
