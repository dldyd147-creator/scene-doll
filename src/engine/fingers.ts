// 손가락 프리셋을 돌 관절값으로 바꾼다.
// 관절값은 돌 공간의 휴식 대비 회전이므로, 손가락 마디 k의 값 = (손의 현재 회전) × (휴식 손 좌표계에서 손바닥 쪽으로 굽힌 회전, 1~k마디 누적).
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { Hand, JointRotations } from '../model/types';
import { FINGERS, fingerBoneName, type FingerPreset } from '../model/fingers';
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

/** 프리셋 → 그 손의 손가락 관절값(현재 손 회전을 따라감). 손가락 뼈가 없으면 null */
export function fingerJointsFor(rig: DollRig, hand: Hand, preset: FingerPreset): JointRotations | null {
  if (!hasFingerBones(rig, hand)) return null;
  const side = hand === 'right' ? 'Right' : 'Left';
  const indexDir = rig.skel.rest.get(fingerBoneName(side, 'Index', 1))!.dir;
  const thumbDir = rig.skel.rest.get(fingerBoneName(side, 'Thumb', 1))!.dir;
  const normal = palmNormal(side, indexDir, thumbDir);
  const handQ = rig.jointDelta(`${side}Hand`);
  const out: JointRotations = {};
  for (const finger of FINGERS) {
    let sum = 0;
    for (const joint of [1, 2, 3] as const) {
      const name = fingerBoneName(side, finger, joint);
      const rest = rig.skel.rest.get(name);
      if (!rest) continue;
      sum += preset.curl[finger][joint - 1];
      const rel = handQ.clone().multiply(curlQuaternion(rest.dir, normal, sum));
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      out[name] = toQuat(rel);
    }
  }
  return out;
}
