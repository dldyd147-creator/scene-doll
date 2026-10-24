import { Quaternion, Vector3 } from 'three';

export interface TwoBoneInput {
  /** 위 뼈 시작(어깨/고관절) */
  a: Vector3;
  /** 아래 뼈 시작(팔꿈치/무릎) */
  b: Vector3;
  /** 끝(손목/발목) */
  c: Vector3;
  target: Vector3;
  /** 사슬이 곧게 펴져 있을 때 팔꿈치/무릎이 향할 방향(월드) */
  poleHint: Vector3;
}

export interface TwoBoneResult {
  /** 위 뼈에 적용할 월드 회전 */
  upper: Quaternion;
  /** 위 뼈 적용 후 아래 뼈에 적용할 월드 회전 */
  lower: Quaternion;
  /** 목표까지 닿았는지(사슬 길이 안) */
  reachable: boolean;
}

const EPS = 1e-6;

function angleBetween(u: Vector3, v: Vector3): number {
  const d = u.dot(v) / (u.length() * v.length() || 1);
  return Math.acos(Math.min(1, Math.max(-1, d)));
}

function fromTo(u: Vector3, v: Vector3): Quaternion {
  const un = u.clone().normalize();
  const vn = v.clone().normalize();
  return new Quaternion().setFromUnitVectors(un, vn);
}

/**
 * 해석적 2-뼈 IK.
 * 1) 사슬 전체를 목표 쪽으로 돌린다(기존 굽힘 유지)
 * 2) 코사인 법칙으로 필요한 어깨 각을 구해 굽힘 평면 안에서 위 뼈를 더/덜 굽힌다
 * 3) 아래 뼈를 돌려 끝을 목표에 맞춘다
 * 굽힘 평면은 현재 팔꿈치 위치를 따르므로 뒤집힘(flip)이 없고, 곧게 펴진 경우만 poleHint를 쓴다.
 */
export function solveTwoBone(inp: TwoBoneInput): TwoBoneResult {
  const { a, b, c, target, poleHint } = inp;
  const ab = b.clone().sub(a);
  const bc = c.clone().sub(b);
  const ac = c.clone().sub(a);
  const l1 = ab.length();
  const l2 = bc.length();
  const at = target.clone().sub(a);
  let dist = at.length();
  const minD = Math.abs(l1 - l2) + 1e-4;
  const maxD = l1 + l2 - 1e-4;
  const reachable = dist <= maxD && dist >= minD;
  if (dist < EPS) {
    // 목표가 어깨 위치와 같으면 방향을 정할 수 없다: 현재 방향 유지
    at.copy(ac).normalize().multiplyScalar(minD);
    dist = minD;
  }
  const d = Math.min(maxD, Math.max(minD, dist));

  // 1) 겨냥
  const qAim = ac.lengthSq() > EPS ? fromTo(ac, at) : new Quaternion();
  const ab1 = ab.clone().applyQuaternion(qAim);
  const ac1 = ac.clone().applyQuaternion(qAim);

  // 2) 굽힘
  const cosAlpha = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d || 1);
  const alpha = Math.acos(Math.min(1, Math.max(-1, cosAlpha)));
  const alpha0 = angleBetween(ab1, ac1);
  const acDir = ac1.clone().normalize();
  let elbowOffset = ab1.clone().sub(acDir.clone().multiplyScalar(ab1.dot(acDir)));
  if (elbowOffset.length() < 1e-4 * l1) {
    elbowOffset = poleHint.clone().sub(acDir.clone().multiplyScalar(poleHint.dot(acDir)));
    if (elbowOffset.lengthSq() < EPS) {
      // 힌트도 사슬과 평행하면 임의의 수직 벡터
      elbowOffset = Math.abs(acDir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
      elbowOffset.sub(acDir.clone().multiplyScalar(elbowOffset.dot(acDir)));
    }
  }
  const n = new Vector3().crossVectors(acDir, elbowOffset).normalize();
  const qBend = new Quaternion().setFromAxisAngle(n, alpha - alpha0);
  const upper = qBend.multiply(qAim);

  // 3) 아래 뼈
  const ab2 = ab.clone().applyQuaternion(upper);
  const ac2 = ac.clone().applyQuaternion(upper);
  const b2 = a.clone().add(ab2);
  const c2 = a.clone().add(ac2);
  const bc2 = c2.clone().sub(b2);
  const bt = target.clone().sub(b2);
  const lower = bt.lengthSq() > EPS ? fromTo(bc2, bt) : new Quaternion();

  return { upper, lower, reachable };
}

/** 테스트·검증용: 결과를 위치에 적용해 최종 b, c 위치를 돌려준다 */
export function applyTwoBone(inp: TwoBoneInput, res: TwoBoneResult): { b: Vector3; c: Vector3 } {
  const ab = inp.b.clone().sub(inp.a).applyQuaternion(res.upper);
  const b = inp.a.clone().add(ab);
  const bc = inp.c.clone().sub(inp.b).applyQuaternion(res.upper).applyQuaternion(res.lower);
  const c = b.clone().add(bc);
  return { b, c };
}
