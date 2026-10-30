import { create } from 'zustand';
import type { CameraState, Character, DollInstance, PropInstance, SceneLibraryItem } from '../model/types';
import { useStore } from '../state/store';

/** 씬 수정 중인 상태: 현재 컷에 씬을 불러와 고친 뒤 다시 저장한다(취소하면 컷을 원래대로) */
interface SceneEditState {
  item: SceneLibraryItem | null;
  before: { dolls: DollInstance[]; props: PropInstance[]; camera: CameraState; aspect: number; characters: Character[] } | null;
  begin: (item: SceneLibraryItem, before: SceneEditState['before']) => void;
  end: () => void;
}

export const useSceneEdit = create<SceneEditState>((set) => ({
  item: null,
  before: null,
  begin: (item, before) => set({ item, before }),
  end: () => set({ item: null, before: null }),
}));

/** 씬을 현재 컷에 불러오고 수정 창을 연다(캐릭터는 저장 당시 돌·키의 임시 캐릭터) */
export function startSceneEdit(item: SceneLibraryItem): void {
  const s = useStore.getState();
  const cut = s.currentCut();
  const before = {
    dolls: structuredClone(cut.dolls),
    props: structuredClone(cut.props),
    camera: structuredClone(cut.camera),
    aspect: cut.aspect,
    characters: s.characters,
  };
  useSceneEdit.getState().begin(item, before);
  s.applyLibraryScene(item, {}, 'replace');
  s.setStatusHint(`씬 '${item.name}'을(를) 불러왔습니다 · 돌·소품·카메라를 고친 뒤 수정 창에서 저장하세요`);
}

/** 수정을 취소하고 컷을 불러오기 전 상태로 되돌린다 */
export function cancelSceneEdit(): void {
  const { before } = useSceneEdit.getState();
  if (before) {
    useStore.getState().commitCut((c) => {
      c.dolls = structuredClone(before.dolls);
      c.props = structuredClone(before.props);
      c.camera = structuredClone(before.camera);
      c.aspect = before.aspect;
    });
    useStore.setState({ characters: before.characters });
  }
  useSceneEdit.getState().end();
}
