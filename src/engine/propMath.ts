// 소품 쥐기 좌표 변환: 손 뼈의 월드 행렬(크기 제거) ↔ 소품 월드 변환. 순수 three.js 수학이라 Node에서 테스트한다.
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { GripTransform } from '../model/types';
import { fromQuat, fromVec3, roundTo, toQuat, toVec3 } from './three-utils';

const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();

/** 뼈 월드 행렬에서 위치·회전만 꺼낸다(돌 키 스케일은 버린다) */
export function boneFrame(boneWorld: Matrix4): { position: Vector3; quaternion: Quaternion } {
  boneWorld.decompose(_pos, _quat, _scale);
  return { position: _pos.clone(), quaternion: _quat.clone().normalize() };
}

/** 쥐기 오프셋(뼈 로컬) → 월드 위치·회전 */
export function gripToWorld(boneWorld: Matrix4, grip: GripTransform): { position: Vector3; quaternion: Quaternion } {
  const f = boneFrame(boneWorld);
  const position = fromVec3(grip.position).applyQuaternion(f.quaternion).add(f.position);
  const quaternion = f.quaternion.clone().multiply(fromQuat(grip.rotation)).normalize();
  return { position, quaternion };
}

/** 월드 위치·회전 → 쥐기 오프셋(뼈 로컬) */
export function worldToGrip(boneWorld: Matrix4, position: Vector3, quaternion: Quaternion): GripTransform {
  const f = boneFrame(boneWorld);
  const inv = f.quaternion.clone().invert();
  const local = position.clone().sub(f.position).applyQuaternion(inv);
  const rot = inv.multiply(quaternion).normalize();
  if (rot.w < 0) rot.set(-rot.x, -rot.y, -rot.z, -rot.w);
  return { position: toVec3(local).map((v) => roundTo(v, 4)) as GripTransform['position'], rotation: toQuat(rot).map((v) => roundTo(v, 5)) as GripTransform['rotation'] };
}
