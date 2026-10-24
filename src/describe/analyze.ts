import { MathUtils, Vector3 } from 'three';
import type { Engine } from '../engine/Engine';
import type { DollRig } from '../engine/DollRig';
import type { AngleTag, Character, Cut, ShotSize } from '../model/types';
import { colorName } from '../model/defaults';

export type XZone = '왼쪽' | '중앙' | '오른쪽';
export type DepthZone = '앞' | '중간' | '뒤';

export interface DollAnalysis {
  id: string;
  characterId: string;
  name: string;
  color: string;
  colorName: string;
  inFrame: boolean;
  shot: ShotSize;
  /** 화면에 투영된 키(NDC 단위) */
  projectedHeight: number;
  xZone: XZone;
  depthZone: DepthZone | null;
  /** 8방위 향함 */
  facing: string;
  /** 서 있음·앉음·누움 */
  stance: string;
  /** 서서·앉아·누워 */
  stanceConj: string;
  phrases: string[];
  distance: number;
}

export interface CutAnalysis {
  count: number;
  shot: ShotSize;
  angle: AngleTag;
  /** 화면 안 돌만 */
  dolls: DollAnalysis[];
  camera: { height: number; focal: number; pitch: number; distance: number };
}

export const SHOT_LABEL: Record<ShotSize, string> = { closeup: '클로즈업', bust: '바스트', waist: '웨이스트', full: '풀샷' };
export const ANGLE_LABEL: Record<AngleTag, string> = { high: '하이앵글', eye: '아이레벨', low: '로우앵글' };

const FACING = ['정면', '오른쪽 반측면', '오른쪽 향함', '오른쪽 뒤', '뒷모습', '왼쪽 뒤', '왼쪽 향함', '왼쪽 반측면'];

/** 카메라 공간에서 앞 방향 각도(0=카메라를 봄, +=화면 오른쪽) → 8방위 */
export function facingLabel(thetaDeg: number): string {
  let sector = Math.round(thetaDeg / 45) % 8;
  if (sector < 0) sector += 8;
  return FACING[sector];
}

const UP = new Vector3(0, 1, 0);
const angleDeg = (a: Vector3, b: Vector3) => MathUtils.radToDeg(a.angleTo(b));

/** 관절 각도로 자세를 고정 어휘 문구로 만든다 */
export function describePose(rig: DollRig): { stance: string; stanceConj: string; phrases: string[] } {
  const phrases: string[] = [];
  const has = (b: string) => rig.skel.bones.has(b);
  const dir = (b: string, rest: Vector3) => rig.boneWorldDirection(b, rest);

  const torsoBone = has('Spine2') ? 'Spine2' : 'Hips';
  const up = dir(torsoBone, new Vector3(0, 1, 0));
  const fwd = dir(torsoBone, new Vector3(0, 0, 1));
  const down = up.clone().negate();

  // 자세: 누움 / 앉음 / 서 있음
  const torsoTilt = angleDeg(up, UP);
  const hipsY = rig.worldPos('Hips').y;
  const standingHips = (rig.skel.rest.get('Hips')?.pos.y ?? 0.5) * rig.root.scale.x;
  const ratio = standingHips > 0 ? hipsY / standingHips : 1;
  const kneeBend = (s: 'Left' | 'Right') => (has(`${s}UpLeg`) && has(`${s}Leg`) ? angleDeg(dir(`${s}UpLeg`, new Vector3(0, -1, 0)), dir(`${s}Leg`, new Vector3(0, -1, 0))) : 0);
  const lying = torsoTilt > 60;
  const sitting = !lying && ratio < 0.72 && (kneeBend('Left') > 55 || kneeBend('Right') > 55);
  const crouch = !lying && !sitting && ratio < 0.6;
  const stance = lying ? '누움' : sitting ? '앉음' : crouch ? '웅크림' : '서 있음';
  const stanceConj = lying ? '누워' : sitting ? '앉아' : crouch ? '웅크려' : '서서';

  if (!lying && torsoTilt > 25) {
    const hipsFwd = dir('Hips', new Vector3(0, 0, 1));
    hipsFwd.y = 0;
    phrases.push(up.dot(hipsFwd) > 0 ? '상체 숙임' : '상체 젖힘');
  }

  for (const [s, label, sign] of [
    ['Right', '오른', -1],
    ['Left', '왼', 1],
  ] as const) {
    if (!has(`${s}Arm`) || !has(`${s}ForeArm`)) continue;
    const armDir = dir(`${s}Arm`, new Vector3(sign, 0, 0));
    const foreDir = dir(`${s}ForeArm`, new Vector3(sign, 0, 0));
    const elev = angleDeg(armDir, down);
    const forward = armDir.dot(fwd);
    const elbow = angleDeg(armDir, foreDir);
    let p = '';
    if (elev > 130) p = `${label}팔 들어 올림`;
    else if (elev > 55) p = forward > 0.5 ? `${label}팔 앞으로 뻗음` : forward < -0.5 ? `${label}팔 뒤로` : `${label}팔 옆으로 벌림`;
    else if (elbow > 50) p = `${label}팔 굽힘`;
    if (p && elev > 55 && elbow > 50) p += '(팔꿈치 굽힘)';
    if (p) phrases.push(p);
  }

  if (!sitting && !lying) {
    for (const [s, label] of [
      ['Right', '오른'],
      ['Left', '왼'],
    ] as const) {
      if (!has(`${s}UpLeg`) || !has(`${s}Leg`)) continue;
      const thigh = dir(`${s}UpLeg`, new Vector3(0, -1, 0));
      const legElev = angleDeg(thigh, down);
      const knee = kneeBend(s);
      if (legElev > 45) phrases.push(thigh.dot(fwd) > 0.3 ? `${label}다리 앞으로 듦` : `${label}다리 들어 올림`);
      else if (knee > 45) phrases.push(`${label}무릎 굽힘`);
    }
  }

  if (has('Head')) {
    const headFwd = dir('Head', new Vector3(0, 0, 1));
    const headUp = dir('Head', new Vector3(0, 1, 0));
    const f1 = fwd.clone().sub(up.clone().multiplyScalar(fwd.dot(up))).normalize();
    const h1 = headFwd.clone().sub(up.clone().multiplyScalar(headFwd.dot(up))).normalize();
    const yaw = MathUtils.radToDeg(Math.atan2(f1.clone().cross(h1).dot(up), f1.dot(h1)));
    if (yaw > 20) phrases.push('고개 왼쪽으로 돌림');
    else if (yaw < -20) phrases.push('고개 오른쪽으로 돌림');
    const tilt = angleDeg(headUp, up);
    if (tilt > 18) phrases.push(headUp.dot(fwd) > 0 ? '고개 숙임' : '고개 듦');
  }

  return { stance, stanceConj, phrases };
}

/** 컷을 분석한다. 엔진에 그 컷이 적용된 상태여야 한다(applyCut 직후) */
export function analyzeCut(engine: Engine, cut: Cut, characters: Character[]): CutAnalysis {
  const cam = engine.manu.camera;
  cam.updateMatrixWorld(true);
  const camQInv = cam.quaternion.clone().invert();
  const dolls: DollAnalysis[] = [];

  for (const inst of cut.dolls) {
    const rig = engine.dolls.get(inst.id);
    if (!rig) continue;
    const chr = characters.find((c) => c.id === inst.characterId);
    const P = (b: string) => rig.worldPos(b);
    const vis = (p: Vector3) => {
      const n = p.clone().project(cam);
      return { n, visible: Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && n.z > -1 && n.z < 1 };
    };
    const vTop = vis(P('HeadTop_End'));
    const vHead = vis(P('Head'));
    const vChest = vis(P('Spine2'));
    const vHips = vis(P('Hips'));
    const vLFoot = vis(P('LeftFoot'));
    const vRFoot = vis(P('RightFoot'));
    const kneesVisible = vis(P('LeftLeg')).visible || vis(P('RightLeg')).visible;
    const feetVisible = vLFoot.visible || vRFoot.visible;
    const inFrame = vHead.visible || vChest.visible || vHips.visible;
    const shot: ShotSize = feetVisible ? 'full' : vHips.visible || kneesVisible ? 'waist' : vChest.visible ? 'bust' : 'closeup';
    const projectedHeight = Math.abs(vTop.n.y - Math.min(vLFoot.n.y, vRFoot.n.y));
    const cx = vHips.visible ? vHips.n.x : vChest.visible ? vChest.n.x : vHead.n.x;
    const xZone: XZone = cx < -1 / 3 ? '왼쪽' : cx > 1 / 3 ? '오른쪽' : '중앙';
    const chest = P('Spine2');
    const distance = chest.distanceTo(cam.position);
    const fwd = rig.boneWorldDirection(rig.skel.bones.has('Spine2') ? 'Spine2' : 'Hips', new Vector3(0, 0, 1));
    const fc = fwd.applyQuaternion(camQInv);
    const theta = MathUtils.radToDeg(Math.atan2(fc.x, fc.z));
    const pose = describePose(rig);
    dolls.push({
      id: inst.id,
      characterId: inst.characterId,
      name: chr?.name ?? '임시',
      color: inst.color,
      colorName: colorName(inst.color),
      inFrame,
      shot,
      projectedHeight,
      xZone,
      depthZone: null,
      facing: facingLabel(theta),
      stance: pose.stance,
      stanceConj: pose.stanceConj,
      phrases: pose.phrases,
      distance,
    });
  }

  const inFrame = dolls.filter((d) => d.inFrame);
  if (inFrame.length >= 2) {
    const sorted = [...inFrame].sort((a, b) => a.distance - b.distance);
    sorted.forEach((d, i) => {
      d.depthZone = i === 0 ? '앞' : i === sorted.length - 1 ? '뒤' : '중간';
    });
  }
  let main: DollAnalysis | null = null;
  for (const d of inFrame) if (!main || d.projectedHeight > main.projectedHeight) main = d;
  const pitch = cut.camera.pitch;
  const angle: AngleTag = pitch > 8 ? 'low' : pitch < -8 ? 'high' : 'eye';
  const camDistance = inFrame.length ? Math.min(...inFrame.map((d) => d.distance)) : engine.subjectCenter().distanceTo(cam.position);
  return {
    count: inFrame.length,
    shot: main?.shot ?? 'full',
    angle,
    dolls: inFrame,
    camera: { height: cut.camera.position[1], focal: cut.camera.focalLength, pitch, distance: camDistance },
  };
}
