// 손가락 굽힘을 돌 관절값으로 바꾼다.
// 관절값은 돌 공간의 휴식 대비 회전이므로, 손가락 마디 k의 값 = (손의 현재 회전) × (휴식 손 좌표계에서 손바닥 쪽으로 굽힌 회전, 1~k마디 누적).
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Hand, JointRotations } from '../model/types';
import { CURL_MAX, FINGERS, fingerBoneName, type Curl, type FingerName, type FingerPreset } from '../model/fingers';
import type { DollRig } from './DollRig';
import { toQuat } from './three-utils';

/**
 * 손바닥 법선(휴식 돌 공간): 검지 방향과 엄지 방향의 외적. 오른손은 부호가 반대.
 * 손바닥이 아래를 보는 T포즈에서 (0,-1,0)이 나온다.
 */
export function palmNormal(side: 'Left' | 'Right', indexDir: Vector3, thumbDir: Vector3): Vector3 {
  const n = new Vector3().crossVectors(indexDir, thumbDir);
  if (n.lengthSq() < 1e-8) return new Vector3(0, -1, 0);
  n.normalize();
  return side === 'Right' ? n.negate() : n;
}

/** 손가락 마디를 손바닥 쪽으로 angleDeg만큼 굽히는 회전(휴식 돌 공간). 축 = 마디 방향 × 손바닥 법선 */
export function curlQuaternion(dir: Vector3, normal: Vector3, angleDeg: number): Quaternion {
  const axis = new Vector3().crossVectors(dir, normal);
  if (axis.lengthSq() < 1e-8) return new Quaternion();
  return new Quaternion().setFromAxisAngle(axis.normalize(), MathUtils.degToRad(angleDeg));
}

/** 돌에 손가락 뼈가 있는지 */
export function hasFingerBones(rig: DollRig, hand: Hand): boolean {
  const side = hand === 'right' ? 'Right' : 'Left';
  return rig.skel.bones.has(fingerBoneName(side, 'Index', 1)) && rig.skel.bones.has(fingerBoneName(side, 'Thumb', 1));
}

function handFrame(rig: DollRig, hand: Hand): { side: 'Left' | 'Right'; normal: Vector3; handQ: Quaternion } | null {
  if (!hasFingerBones(rig, hand)) return null;
  const side = hand === 'right' ? 'Right' : 'Left';
  const indexDir = rig.skel.rest.get(fingerBoneName(side, 'Index', 1))!.dir;
  const thumbDir = rig.skel.rest.get(fingerBoneName(side, 'Thumb', 1))!.dir;
  return { side, normal: palmNormal(side, indexDir, thumbDir), handQ: rig.jointDelta(`${side}Hand`) };
}

/** 손가락별 굽힘각 → 그 손의 손가락 관절값(현재 손 회전을 따라감). 손가락 뼈가 없으면 null */
export function fingerJointsForCurl(rig: DollRig, hand: Hand, curl: Record<FingerName, Curl>): JointRotations | null {
  const f = handFrame(rig, hand);
  if (!f) return null;
  const out: JointRotations = {};
  for (const finger of FINGERS) {
    let sum = 0;
    for (const joint of [1, 2, 3] as const) {
      const name = fingerBoneName(f.side, finger, joint);
      const rest = rig.skel.rest.get(name);
      if (!rest) continue;
      sum += curl[finger][joint - 1];
      const rel = f.handQ.clone().multiply(curlQuaternion(rest.dir, f.normal, sum));
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      out[name] = toQuat(rel);
    }
  }
  return out;
}

/** 프리셋 → 관절값 */
export function fingerJointsFor(rig: DollRig, hand: Hand, preset: FingerPreset): JointRotations | null {
  return fingerJointsForCurl(rig, hand, preset.curl);
}

/**
 * 지금 손가락 관절값에서 손가락별 마디 굽힘각을 추정한다(핸드 오퍼레이터 슬라이더 초기값).
 * 마디 k의 손 기준 상대 회전을 굽힘 축 둘레 각으로 읽으면 1~k마디 누적각이므로, 앞 마디와의 차가 그 마디 각이다.
 */
export function estimateCurl(rig: DollRig, hand: Hand): Record<FingerName, Curl> | null {
  const f = handFrame(rig, hand);
  if (!f) return null;
  const deltas = rig.jointDeltas();
  const invHand = f.handQ.clone().invert();
  const out = {} as Record<FingerName, Curl>;
  for (const finger of FINGERS) {
    let prev = 0;
    const curl: number[] = [];
    for (const joint of [1, 2, 3] as const) {
      const name = fingerBoneName(f.side, finger, joint);
      const rest = rig.skel.rest.get(name);
      const d = deltas.get(name);
      if (!rest || !d) {
        curl.push(0);
        continue;
      }
      const axis = new Vector3().crossVectors(rest.dir, f.normal);
      if (axis.lengthSq() < 1e-8) {
        curl.push(0);
        continue;
      }
      axis.normalize();
      const rel = invHand.clone().multiply(d);
      const dot = rel.x * axis.x + rel.y * axis.y + rel.z * axis.z;
      let ang = MathUtils.radToDeg(2 * Math.atan2(dot, rel.w));
      if (ang > 180) ang -= 360;
      if (ang < -180) ang += 360;
      // 누적각은 앞 마디보다 크다(주먹은 245°까지). 쿼터니언 각은 ±180°로 접히므로 앞 마디 누적각 위로 풀어 준다
      let sum = ang;
      while (sum < prev - 90) sum += 360;
      sum = Math.max(0, sum);
      curl.push(Math.max(0, Math.min(CURL_MAX[finger][joint - 1] * 1.3, sum - prev)));
      prev = Math.max(prev, sum);
    }
    out[finger] = [curl[0], curl[1], curl[2]];
  }
  return out;
}
