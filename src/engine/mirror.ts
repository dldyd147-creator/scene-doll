import type { JointRotations, Quat } from '../model/types';
import { mirrorBoneName } from './skeleton';

/** YZ 평면(x→-x) 대칭 회전. 돌 공간 기준 회전이므로 그대로 적용된다 */
export function mirrorQuat(q: Quat): Quat {
  return [q[0], -q[1], -q[2], q[3]];
}

/** 포즈 좌우 반전: 왼쪽↔오른쪽 뼈를 바꾸고 각 회전을 대칭시킨다 */
export function mirrorJoints(joints: JointRotations): JointRotations {
  const out: JointRotations = {};
  for (const [name, q] of Object.entries(joints)) {
    out[mirrorBoneName(name)] = mirrorQuat(q);
  }
  return out;
}
