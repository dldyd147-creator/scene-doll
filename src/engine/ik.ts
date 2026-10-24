import { Matrix4, Quaternion, Vector3 } from 'three';

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

/** d에 수직인 아무 단위 벡터 */
function anyPerpendicular(d: Vector3): Vector3 {
  const helper = Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  return new Vector3().crossVectors(d, helper).normalize();
}

/** (dir, forward) 두 방향으로 정한 좌표계를 다른 좌표계로 옮기는 회전. forward는 dir에 수직인 성분만 쓴다 */
export function frameRotation(dCur: Vector3, fCur: Vector3, dDes: Vector3, fDes: Vector3): Quaternion {
  const basis = (d: Vector3, f: Vector3): Quaternion => {
    const x = d.clone().normalize();
    const z = f.clone().sub(x.clone().multiplyScalar(f.dot(x)));
    if (z.lengthSq() < 1e-10) z.copy(anyPerpendicular(x));
    z.normalize();
    const y = new Vector3().crossVectors(z, x);
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  };
  return basis(dDes, fDes).multiply(basis(dCur, fCur).invert());
}

/**
 * 해석적 2-뼈 IK(자유 관절용. 관절 한계를 끈 상태에서 쓴다).
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
    if (elbowOffset.lengthSq() < EPS) elbowOffset = anyPerpendicular(acDir);
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

// ---------- 경첩 사슬(관절 한계 켠 상태의 무릎·팔꿈치) ----------

/**
 * 경첩 사슬 입력. 방향은 모두 '휴식 돌 공간'의 단위 벡터, 길이·거리는 월드 단위.
 * 아래 뼈는 경첩 축 둘레로만 굽는다고 보고, 위 뼈의 회전(휴식 대비 돌 공간 회전)과 굽힘각을 정확히 푼다.
 */
export interface HingeChainInput {
  /** 위·아래 뼈 길이 */
  l1: number;
  l2: number;
  /** 위·아래 뼈의 휴식 방향 */
  u0: Vector3;
  s0: Vector3;
  /** 경첩 축과 굽힘 범위(라디안) */
  axis: Vector3;
  min: number;
  max: number;
  /** 지금 굽힘각: 두 해가 모두 범위 안이면 가까운 쪽을 고른다 */
  thetaCur: number;
  /** 위 뼈 시작→목표 방향과 거리 */
  tDir: Vector3;
  dist: number;
  /** 무릎·팔꿈치가 튀어나올 쪽(위 뼈의 '앞' 방향이 향할 곳) */
  pole: Vector3;
}

export interface HingeChainResult {
  /** 위 뼈의 '휴식 대비 돌 공간 회전' */
  upper: Quaternion;
  /** 아래 뼈의 경첩 굽힘각 */
  theta: number;
  reachable: boolean;
}

/** 굽힘각 theta일 때 위 뼈 시작→아래 뼈 끝 벡터(휴식 돌 공간) */
export function hingeChainVector(l1: number, l2: number, u0: Vector3, s0: Vector3, axis: Vector3, theta: number): Vector3 {
  const s = s0.clone().applyQuaternion(new Quaternion().setFromAxisAngle(axis, theta));
  return u0.clone().multiplyScalar(l1).add(s.multiplyScalar(l2));
}

/** 중간 굽힘에서 무릎·팔꿈치가 사슬 직선에서 튀어나오는 방향(휴식 돌 공간, 단위). 위 뼈에 붙은 '앞' 방향으로 쓴다 */
export function hingeForward(l1: number, l2: number, u0: Vector3, s0: Vector3, axis: Vector3, min: number, max: number): Vector3 {
  const v = hingeChainVector(l1, l2, u0, s0, axis, (min + max) / 2).normalize();
  const k = u0.clone().sub(v.clone().multiplyScalar(u0.dot(v)));
  if (k.lengthSq() > 1e-10) return k.normalize();
  const alt = new Vector3().crossVectors(u0, axis);
  return alt.lengthSq() > 1e-10 ? alt.normalize() : new Vector3(0, 0, 1);
}

function wrapAngle(t: number): number {
  while (t > Math.PI) t -= 2 * Math.PI;
  while (t <= -Math.PI) t += 2 * Math.PI;
  return t;
}

/**
 * 경첩 사슬 IK.
 * 위 뼈 휴식 좌표계에서 시작→끝 벡터는 v(θ) = l1·u0 + l2·R_axis(θ)·s0 이고
 * |v(θ)|² = l1² + l2² + 2·l1·l2·(K + A·cosθ + B·sinθ) 이므로 거리 조건을 θ에 대해 닫힌 꼴로 푼다.
 * 그 뒤 위 뼈 회전은 v(θ)를 목표 방향으로, 위 뼈의 '앞'(hingeForward)을 pole 쪽으로 보내는 좌표계 회전으로 정한다.
 * 결과의 아래 뼈 상대 회전은 정확히 경첩 둘레 회전이라 관절 한계 교정이 손대지 않는다.
 */
export function solveHingeChain(inp: HingeChainInput): HingeChainResult {
  const { l1, l2, u0, s0, axis, min, max, tDir, pole } = inp;
  const sPar = axis.clone().multiplyScalar(s0.dot(axis));
  const sPerp = s0.clone().sub(sPar);
  const sCross = new Vector3().crossVectors(axis, sPerp);
  const K = u0.dot(sPar);
  const A = u0.dot(sPerp);
  const B = u0.dot(sCross);
  const d = Math.max(inp.dist, 1e-6);
  const m = (d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2 || 1) - K;
  const R = Math.hypot(A, B);
  const phi = Math.atan2(B, A);
  const ratio = R > 1e-9 ? m / R : 2;
  let reachable = true;
  let cands: number[];
  if (ratio >= 1) {
    cands = [phi]; // 너무 멀다: 최대로 편다
    reachable = false;
  } else if (ratio <= -1) {
    cands = [phi + Math.PI]; // 너무 가깝다: 최대로 접는다
    reachable = false;
  } else {
    const h = Math.acos(ratio);
    cands = [phi + h, phi - h];
  }
  const clampT = (t: number) => Math.min(max, Math.max(min, t));
  const inRange = cands.map(wrapAngle).filter((t) => t >= min - 1e-6 && t <= max + 1e-6);
  let theta: number;
  if (inRange.length) {
    theta = clampT(inRange.reduce((p, t) => (Math.abs(t - inp.thetaCur) < Math.abs(p - inp.thetaCur) ? t : p)));
  } else {
    reachable = false;
    const err = (t: number) => Math.abs(hingeChainVector(l1, l2, u0, s0, axis, t).length() - d);
    theta = cands.map((t) => clampT(wrapAngle(t))).reduce((p, t) => (err(t) < err(p) ? t : p));
  }
  const v = hingeChainVector(l1, l2, u0, s0, axis, theta).normalize();
  const f0 = hingeForward(l1, l2, u0, s0, axis, min, max);
  const upper = frameRotation(v, f0, tDir, pole);
  return { upper, theta, reachable };
}
