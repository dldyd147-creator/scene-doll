/**
 * 앵글 태그(순수): 카메라가 주인공의 눈높이보다 얼마나 위·아래에서 보는지(고도각)로 정한다.
 * 예전에는 카메라가 내려다보는 기울기(pitch)만 봐서, 서 있는 돌을 조금 내려다보는 평범한 구도나 앉은 돌을 찍을 때도
 * 하이앵글로 적혔다(기울기는 구도를 잡느라 쉽게 변한다). 눈높이 기준으로 ±15° 넘게 벗어날 때만 하이·로우로 본다.
 */
import type { AngleTag } from '../model/types';

export const ANGLE_THRESHOLD_DEG = 15;

/** elevationDeg: 주인공 눈에서 카메라로 향하는 선이 수평에서 위로 몇 도인가(카메라가 위에 있으면 +) */
export function angleFromElevation(elevationDeg: number): AngleTag {
  if (elevationDeg > ANGLE_THRESHOLD_DEG) return 'high';
  if (elevationDeg < -ANGLE_THRESHOLD_DEG) return 'low';
  return 'eye';
}

export function elevationDeg(cam: { x: number; y: number; z: number }, eye: { x: number; y: number; z: number }): number {
  const horizontal = Math.hypot(cam.x - eye.x, cam.z - eye.z);
  return (Math.atan2(cam.y - eye.y, Math.max(horizontal, 1e-6)) * 180) / Math.PI;
}
