import { create } from 'zustand';
import type { Engine } from '../engine/Engine';
import type { JointRotations, Pose } from '../model/types';
import { useStore } from '../state/store';

/** 포즈 편집 중인 상태: 선택한 돌에 포즈를 입혀 놓고, 조작뷰에서 미세수정한 뒤 다시 저장한다 */
interface PoseEditState {
  pose: Pose | null;
  dollId: string | null;
  before: { joints: JointRotations; position: [number, number, number]; quaternion: [number, number, number, number] } | null;
  begin: (pose: Pose, dollId: string, before: PoseEditState['before']) => void;
  end: () => void;
}

export const usePoseEdit = create<PoseEditState>((set) => ({
  pose: null,
  dollId: null,
  before: null,
  begin: (pose, dollId, before) => set({ pose, dollId, before }),
  end: () => set({ pose: null, dollId: null, before: null }),
}));

/** 선택한 돌에 포즈를 입히고 편집 창을 연다. 돌이 없으면 false */
export function startPoseEdit(engine: Engine, pose: Pose): boolean {
  const rig = engine.selectedRig();
  if (!rig) {
    useStore.getState().setStatusHint('포즈를 고칠 돌을 먼저 선택하세요');
    return false;
  }
  const before = { joints: rig.getJoints(), position: rig.root.position.toArray() as [number, number, number], quaternion: rig.root.quaternion.toArray() as [number, number, number, number] };
  engine.applyPoseToDoll(rig.id, pose.joints, pose.groundOnApply);
  usePoseEdit.getState().begin(pose, rig.id, before);
  return true;
}

/** 편집을 취소하고 돌을 편집 전 자세로 되돌린다 */
export function cancelPoseEdit(engine: Engine): void {
  const { dollId, before } = usePoseEdit.getState();
  const rig = dollId ? engine.dolls.get(dollId) : null;
  if (rig && before) {
    rig.setJoints(before.joints);
    rig.root.position.fromArray(before.position);
    rig.root.quaternion.fromArray(before.quaternion);
    rig.root.updateMatrixWorld(true);
    engine.commitDoll(rig.id);
  }
  usePoseEdit.getState().end();
}
