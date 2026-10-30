import { Quaternion, Vector3 } from 'three';
import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { newId } from '../model/ids';
import type { Pose, PoseProp, PropInstance, Quat, SceneLibraryItem, Vec3 } from '../model/types';
import { createPose, sceneFromCut } from '../model/library';
import { useStore } from '../state/store';
import { logAction } from '../storage/remote/service';
import { captureThumbnail } from './cuts';
import { useLibrary } from './library';

/** 씬 라이브러리 썸네일 가로(검색기 미리보기가 커지므로 컷 목록용보다 크게) */
const SCENE_THUMB_WIDTH = 384;
const POSE_THUMB = { width: 160, height: 200 };

export interface SceneDraft {
  item: SceneLibraryItem;
  /** 썸네일 데이터 URL */
  thumb: string;
}

/** 현재 컷으로 씬 항목 초안(자동 태그 포함)과 썸네일을 만든다. 엔진에 현재 컷이 적용된 상태여야 한다 */
export function draftSceneFromCurrent(engine: Engine, name = '', situationTags: string[] = []): SceneDraft {
  const s = useStore.getState();
  const cut = s.currentCut();
  const item = sceneFromCut(cut, analyzeCut(engine, cut, s.characters), { name, situationTags });
  return { item, thumb: captureThumbnail(engine, cut.aspect, SCENE_THUMB_WIDTH) };
}

/** 초안을 이름·상황 태그와 함께 공용/씬에 저장한다 */
export async function saveSceneDraft(draft: SceneDraft, name: string, situationTags: string[]): Promise<SceneLibraryItem> {
  const item: SceneLibraryItem = { ...draft.item, name: name.trim() || draft.item.name, situationTags };
  const stored = await useLibrary.getState().saveScene(item, draft.thumb);
  useStore.getState().setStatusHint(`씬 '${stored.name}'을(를) 라이브러리에 저장했습니다 (공용/씬)`);
  logAction('scene', stored.name, null, useStore.getState().work.code);
  return stored;
}

/** 포즈에 함께 저장할 수 있는 소품: 이 돌이 손에 쥔 것과 자유 배치된 것(다른 돌이 쥔 것은 뺀다) */
export interface PosePropCandidate {
  id: string;
  name: string;
  /** 이 돌이 손에 쥐고 있음 */
  held: boolean;
}

export function posePropCandidates(dollId: string): PosePropCandidate[] {
  const cut = useStore.getState().currentCut();
  const assets = useLibrary.getState().props ?? [];
  return cut.props
    .filter((p) => !p.attachedTo || p.attachedTo.dollInstanceId === dollId)
    .map((p) => ({ id: p.id, name: assets.find((a) => a.id === p.propId)?.name ?? '소품', held: p.attachedTo?.dollInstanceId === dollId }));
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** 컷의 소품(인스턴스 ID 목록)을 포즈에 딸린 소품으로. 쥔 것은 쥐기 오프셋, 자유 배치는 돌 기준(돌 위치 X·Z와 정면 방향 기준, 높이는 바닥 기준)으로 적는다 */
export function collectPoseProps(engine: Engine, dollId: string, propIds: string[]): PoseProp[] {
  const rig = engine.dolls.get(dollId);
  if (!rig) return [];
  const cut = useStore.getState().currentCut();
  const invQ = rig.root.quaternion.clone().invert();
  const out: PoseProp[] = [];
  for (const pid of propIds) {
    const p = cut.props.find((x) => x.id === pid);
    if (!p || (p.attachedTo && p.attachedTo.dollInstanceId !== dollId)) continue;
    const scale = p.scale ? { scale: [...p.scale] as Vec3 } : {};
    if (p.attachedTo) {
      out.push({ propId: p.propId, hand: p.attachedTo.hand, position: [...p.position] as Vec3, rotation: [...p.rotation] as Quat, ...scale });
      continue;
    }
    const world = engine.propWorldPosition(p.id) ?? p.position;
    const rel = new Vector3(world[0] - rig.root.position.x, world[1], world[2] - rig.root.position.z).applyQuaternion(invQ);
    const q = invQ.clone().multiply(new Quaternion(...p.rotation)).normalize();
    out.push({ propId: p.propId, position: [rel.x, rel.y, rel.z].map(round4) as Vec3, rotation: [q.x, q.y, q.z, q.w].map(round5) as Quat, ...scale });
  }
  return out;
}

/**
 * 포즈에 딸린 소품을 돌에 맞춰 컷에 놓는다. 같은 손에 이미 쥔 소품은 바꾸고, 소품 정의가 지워졌으면 건너뛴다.
 * 만들어진 소품 인스턴스 ID를 돌려준다
 */
export async function placePoseProps(engine: Engine, pose: Pose, dollId: string): Promise<string[]> {
  if (!pose.props?.length) return [];
  const rig = engine.dolls.get(dollId);
  if (!rig) return [];
  await useLibrary.getState().loadProps();
  const assets = useLibrary.getState().props ?? [];
  const items = pose.props.filter((pp) => assets.some((a) => a.id === pp.propId));
  if (!items.length) return [];
  const q = rig.root.quaternion.clone();
  const created: PropInstance[] = items.map((pp) => {
    const inst: PropInstance = { id: newId('pi'), propId: pp.propId, position: [...pp.position] as Vec3, rotation: [...pp.rotation] as Quat };
    if (pp.scale) inst.scale = [...pp.scale] as Vec3;
    if (pp.hand) {
      inst.attachedTo = { dollInstanceId: dollId, hand: pp.hand };
      return inst;
    }
    const world = new Vector3(...pp.position).applyQuaternion(q);
    inst.position = [round4(world.x + rig.root.position.x), round4(world.y), round4(world.z + rig.root.position.z)];
    const wq = q.clone().multiply(new Quaternion(...pp.rotation)).normalize();
    inst.rotation = [round5(wq.x), round5(wq.y), round5(wq.z), round5(wq.w)];
    return inst;
  });
  const replaced = new Set(created.filter((c) => c.attachedTo).map((c) => c.attachedTo!.hand));
  useStore.getState().commitCut((c) => {
    c.props = c.props.filter((p) => !(p.attachedTo?.dollInstanceId === dollId && replaced.has(p.attachedTo.hand)));
    c.props.push(...created);
  });
  return created.map((c) => c.id);
}

/** 포즈를 돌에 적용하고 딸린 소품도 놓는다. 만든 소품 ID를 돌려준다 */
export async function applyPoseToDollWithProps(engine: Engine, pose: Pose, dollId: string): Promise<string[]> {
  if (!engine.applyPoseToDoll(dollId, pose.joints, pose.groundOnApply)) return [];
  return placePoseProps(engine, pose, dollId);
}

/** 선택한 돌의 관절값(과 고른 소품)을 포즈로 저장한다(썸네일은 그 돌만 찍음). 선택이 없으면 null */
export async function savePoseFromSelected(engine: Engine, name: string, category: string, tags: string[], propIds: string[] = []): Promise<Pose | null> {
  const rig = engine.selectedRig();
  if (!rig) return null;
  const pose = createPose(name, category, tags, rig.getJoints());
  const props = collectPoseProps(engine, rig.id, propIds);
  if (props.length) pose.props = props;
  const canvas = engine.renderDollSnapshot(rig.id, POSE_THUMB.width, POSE_THUMB.height);
  const stored = await useLibrary.getState().savePose(pose, canvas ? canvas.toDataURL('image/png') : null);
  useStore.getState().setStatusHint(`포즈 '${stored.name}'을(를) 저장했습니다 (공용/포즈)`);
  return stored;
}

/** 포즈를 선택한 돌에 적용(체형과 무관, 딸린 소품 포함). 선택이 없으면 상태 바에 안내 */
export function applyPose(engine: Engine, pose: Pose): boolean {
  const rig = engine.selectedRig();
  if (!rig) {
    useStore.getState().setStatusHint('포즈를 적용할 돌을 먼저 선택하세요');
    return false;
  }
  void applyPoseToDollWithProps(engine, pose, rig.id).then((ids) => {
    useStore.getState().setStatusHint(`포즈 '${pose.name}' 적용${ids.length ? ` · 소품 ${ids.length}개 함께 놓음` : ''} (Ctrl+Z로 되돌림)`);
  });
  return true;
}
