import { Object3D, Quaternion, Vector3 } from 'three';
import type { Quat, Vec3 } from '../model/types';

export const toQuat = (q: Quaternion): Quat => [q.x, q.y, q.z, q.w];
export const fromQuat = (a: Quat): Quaternion => new Quaternion(a[0], a[1], a[2], a[3]);
export const toVec3 = (v: Vector3): Vec3 => [v.x, v.y, v.z];
export const fromVec3 = (a: Vec3): Vector3 => new Vector3(a[0], a[1], a[2]);

const _parentQ = new Quaternion();
const _worldQ = new Quaternion();

/**
 * 객체를 월드 공간 회전 q만큼 추가로 회전시킨다(기존 월드 회전에 q를 앞에 곱함).
 */
export function rotateObjectWorld(obj: Object3D, q: Quaternion): void {
  obj.updateWorldMatrix(true, false);
  obj.getWorldQuaternion(_worldQ);
  if (obj.parent) obj.parent.getWorldQuaternion(_parentQ);
  else _parentQ.identity();
  const newWorld = q.clone().multiply(_worldQ);
  obj.quaternion.copy(_parentQ.invert().multiply(newWorld));
  obj.updateWorldMatrix(false, true);
}

/** 두 쿼터니언 사이 각도(라디안) */
export function quatAngle(a: Quaternion, b: Quaternion): number {
  const d = Math.min(1, Math.abs(a.dot(b)));
  return 2 * Math.acos(d);
}

export function roundTo(n: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
