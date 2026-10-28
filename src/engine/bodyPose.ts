import { Quaternion } from 'three';

/** 몸통 슬라이더가 다루는 축. 허리는 좌우축(x) 둘레로 숙이고, 어깨는 앞뒤축(z)·세로축(y) 둘레로 올리고 민다 */
export const SPINE_BONES = ['Spine', 'Spine1', 'Spine2'];

export type Side = 'left' | 'right';

export interface BodyPose {
  /** 허리를 앞으로 숙인 각(도). 뒤로 젖히면 음수 */
  bend: number;
  /** 어깨를 올린 각(도). 내리면 음수 */
  shoulderUp: Record<Side, number>;
  /** 어깨를 앞으로 민 각(도). 뒤로 당기면 음수 */
  shoulderFwd: Record<Side, number>;
}

export type BodySlider = { part: 'bend' } | { part: 'shoulderUp' | 'shoulderFwd'; side: Side };

/** 회전 q 중 axis 둘레 각(rad). 한 축 위주의 회전에 맞는 근사(w 부호는 가까운 쪽으로 정규화) */
export function angleAbout(q: Quaternion, axis: 'x' | 'y' | 'z'): number {
  const s = q.w < 0 ? -1 : 1;
  return 2 * Math.atan2(s * q[axis], Math.abs(q.w));
}

/**
 * 어깨 슬라이더의 부호. 휴식 자세에서 어깨(쇄골)→팔 방향이 +x면 +1, -x면 -1.
 * 앞뒤축(z) 둘레로 +각이면 +x쪽 팔은 올라가고, 세로축(y) 둘레로 +각이면 +x쪽 팔은 뒤로 간다.
 */
export function armSide(armX: number, shoulderX: number, side: Side): 1 | -1 {
  const d = armX - shoulderX;
  if (Math.abs(d) > 1e-6) return d > 0 ? 1 : -1;
  return side === 'left' ? 1 : -1;
}
