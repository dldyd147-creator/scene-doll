import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import type { Pose, SceneLibraryItem } from '../model/types';
import { createPose, sceneFromCut } from '../model/library';
import { useStore } from '../state/store';
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
  return stored;
}

/** 선택한 돌의 관절값을 포즈로 저장한다(썸네일은 그 돌만 찍음). 선택이 없으면 null */
export async function savePoseFromSelected(engine: Engine, name: string, category: string, tags: string[]): Promise<Pose | null> {
  const rig = engine.selectedRig();
  if (!rig) return null;
  const pose = createPose(name, category, tags, rig.getJoints());
  const canvas = engine.renderDollSnapshot(rig.id, POSE_THUMB.width, POSE_THUMB.height);
  const stored = await useLibrary.getState().savePose(pose, canvas ? canvas.toDataURL('image/png') : null);
  useStore.getState().setStatusHint(`포즈 '${stored.name}'을(를) 저장했습니다 (공용/포즈)`);
  return stored;
}

/** 포즈를 선택한 돌에 적용(체형과 무관). 선택이 없으면 상태 바에 안내 */
export function applyPose(engine: Engine, pose: Pose): boolean {
  const ok = engine.applyPoseToSelected(pose.joints);
  useStore.getState().setStatusHint(ok ? `포즈 '${pose.name}' 적용 (Ctrl+Z로 되돌림)` : '포즈를 적용할 돌을 먼저 선택하세요');
  return ok;
}
