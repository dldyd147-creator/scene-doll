import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../model/types';

/**
 * 관절 한계. 값은 '휴식 자세 기준 뼈 좌표계'에서의 각도(도).
 * - cone: 뼈 방향이 휴식 방향에서 벗어날 수 있는 최대 각(스윙 원뿔)
 * - twist: 뼈 축 둘레 비틀림 ± 한계
 * - hinge: 경첩 관절. 축(휴식 돌 공간)과 부호 있는 각도 범위. 스윙은 이 축 둘레로만 허용
 */
export interface JointLimit {
  cone?: number;
  twist?: number;
  hinge?: { axis: Vec3; min: number; max: number };
}

const elbow = (side: 'Left' | 'Right'): JointLimit => ({
  hinge: { axis: [0, 1, 0], min: side === 'Left' ? -148 : 0, max: side === 'Left' ? 0 : 148 },
  twist: 85,
});
const knee: JointLimit = { hinge: { axis: [1, 0, 0], min: 0, max: 150 }, twist: 10 };

const COMMON: Record<string, JointLimit> = {
  Spine: { cone: 25, twist: 20 },
  Spine1: { cone: 25, twist: 20 },
  Spine2: { cone: 25, twist: 20 },
  Neck: { cone: 30, twist: 35 },
  Head: { cone: 40, twist: 45 },
  Shoulder: { cone: 25, twist: 15 },
  Arm: { cone: 125, twist: 80 },
  Hand: { cone: 70, twist: 30 },
  UpLeg: { cone: 115, twist: 45 },
  Leg: knee,
  Foot: { cone: 45, twist: 20 },
  ToeBase: { cone: 40, twist: 5 },
};

/** 뼈 이름의 관절 한계. 없으면 null(루트·손가락·끝 뼈) */
export function limitFor(bone: string): JointLimit | null {
  const m = /^(Left|Right)(.+)$/.exec(bone);
  if (m) {
    const side = m[1] as 'Left' | 'Right';
    const base = m[2];
    if (base === 'ForeArm') return elbow(side);
    return COMMON[base] ?? null;
  }
  return COMMON[bone] ?? null;
}

const _axis = new Vector3();
const _v = new Vector3();

/** q = swing * twist 로 분해. twist는 axis 둘레 회전 */
export function swingTwist(q: Quaternion, axis: Vector3): { swing: Quaternion; twist: Quaternion; twistAngle: number } {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const twist = new Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (twist.lengthSq() < 1e-12) twist.set(0, 0, 0, 1);
  else twist.normalize();
  const swing = q.clone().multiply(twist.clone().invert());
  let twistAngle = 2 * Math.atan2(d, q.w);
  if (twistAngle > Math.PI) twistAngle -= 2 * Math.PI;
  if (twistAngle < -Math.PI) twistAngle += 2 * Math.PI;
  return { swing, twist, twistAngle };
}

/**
 * 부모 기준 관절 회전 J(휴식 돌 공간에서 표현)를 한계 안으로 넣는다.
 * boneDir: 뼈의 휴식 방향(단위). 바뀐 게 없으면 null.
 */
export function clampJointRotation(J: Quaternion, boneDir: Vector3, limit: JointLimit): Quaternion | null {
  const { swing, twist, twistAngle } = swingTwist(J, boneDir);
  let changed = false;
  let newSwing = swing;
  let newTwist = twist;

  if (limit.twist !== undefined) {
    const max = MathUtils.degToRad(limit.twist);
    if (Math.abs(twistAngle) > max + 1e-4) {
      newTwist = new Quaternion().setFromAxisAngle(boneDir, Math.sign(twistAngle) * max);
      changed = true;
    }
  }

  if (limit.hinge) {
    _axis.set(limit.hinge.axis[0], limit.hinge.axis[1], limit.hinge.axis[2]).normalize();
    const rotated = _v.copy(boneDir).applyQuaternion(swing);
    // 경첩 축에 수직인 평면으로 투영
    const proj = rotated.clone().sub(_axis.clone().multiplyScalar(rotated.dot(_axis)));
    if (proj.lengthSq() > 1e-8) {
      proj.normalize();
      const base = boneDir.clone().sub(_axis.clone().multiplyScalar(boneDir.dot(_axis))).normalize();
      let theta = Math.atan2(base.clone().cross(proj).dot(_axis), base.dot(proj));
      const min = MathUtils.degToRad(limit.hinge.min);
      const max = MathUtils.degToRad(limit.hinge.max);
      const clamped = Math.min(max, Math.max(min, theta));
      const hingeOnly = new Quaternion().setFromAxisAngle(_axis, clamped);
      // 경첩 밖 성분이 있거나 범위를 벗어났으면 교정
      const offAxis = rotated.angleTo(proj);
      if (offAxis > 1e-3 || Math.abs(clamped - theta) > 1e-4) {
        newSwing = hingeOnly;
        changed = true;
      }
      theta = clamped;
    }
  } else if (limit.cone !== undefined) {
    const w = Math.min(1, Math.max(-1, swing.w));
    const angle = 2 * Math.acos(Math.abs(w));
    const max = MathUtils.degToRad(limit.cone);
    if (angle > max + 1e-4) {
      const s = Math.sqrt(Math.max(0, 1 - w * w));
      if (s > 1e-6) {
        _axis.set(swing.x / s, swing.y / s, swing.z / s);
        if (w < 0) _axis.negate();
        newSwing = new Quaternion().setFromAxisAngle(_axis, max);
        changed = true;
      }
    }
  }

  if (!changed) return null;
  return newSwing.clone().multiply(newTwist);
}
