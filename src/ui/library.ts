import { useEffect } from 'react';
import { create } from 'zustand';
import type { Pose, PropAsset, SceneLibraryItem } from '../model/types';
import type { HandPose } from '../model/fingers';
import { storage } from '../storage';

/**
 * 공용 라이브러리(씬·포즈·소품) 캐시. 저장소에서 한 번 읽어 두고, 저장·삭제는 저장소에 쓴 뒤 목록을 고친다.
 * 썸네일은 보일 때 하나씩 읽는다(경로 → 데이터 URL).
 */
interface LibraryState {
  /** null = 아직 안 읽음 */
  scenes: SceneLibraryItem[] | null;
  poses: Pose[] | null;
  props: PropAsset[] | null;
  /** 저장한 손 모양(핸드 오퍼레이터) */
  handPoses: HandPose[] | null;
  /** 썸네일 경로 → 데이터 URL. ''는 파일이 없음 */
  thumbs: Record<string, string>;
  error: string | null;
  loadScenes: (force?: boolean) => Promise<void>;
  loadPoses: (force?: boolean) => Promise<void>;
  ensureThumb: (path: string) => void;
  saveScene: (item: SceneLibraryItem, thumbDataUrl: string | null) => Promise<SceneLibraryItem>;
  deleteScene: (id: string) => Promise<void>;
  savePose: (pose: Pose, thumbDataUrl: string | null) => Promise<Pose>;
  deletePose: (id: string) => Promise<void>;
  loadProps: (force?: boolean) => Promise<void>;
  saveProp: (asset: PropAsset, thumbDataUrl: string | null) => Promise<PropAsset>;
  deleteProp: (id: string) => Promise<void>;
  loadHandPoses: (force?: boolean) => Promise<void>;
  saveHandPose: (pose: HandPose) => Promise<void>;
  deleteHandPose: (id: string) => Promise<void>;
  /** 저장소가 바뀌면 전부 다시 읽도록 비운다 */
  reset: () => void;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const pendingThumbs = new Set<string>();
let sceneLoad: Promise<void> | null = null;
let poseLoad: Promise<void> | null = null;
let propLoad: Promise<void> | null = null;

export const useLibrary = create<LibraryState>()((set, get) => ({
  scenes: null,
  poses: null,
  props: null,
  handPoses: null,
  thumbs: {},
  error: null,

  loadHandPoses: (force = false) => {
    if (!force && get().handPoses) return Promise.resolve();
    return storage.repository
      .loadHandPoses()
      .then((handPoses) => set({ handPoses }))
      .catch((e: unknown) => set({ handPoses: get().handPoses ?? [], error: `손 모양 목록을 읽지 못했습니다: ${message(e)}` }));
  },

  saveHandPose: async (pose) => {
    await storage.repository.saveHandPose(pose);
    set((s) => ({ handPoses: s.handPoses ? [pose, ...s.handPoses.filter((x) => x.id !== pose.id)] : null }));
  },

  deleteHandPose: async (id) => {
    await storage.repository.deleteHandPose(id);
    set((s) => ({ handPoses: s.handPoses ? s.handPoses.filter((x) => x.id !== id) : null }));
  },

  loadScenes: (force = false) => {
    if (!force && get().scenes) return Promise.resolve();
    if (sceneLoad) return sceneLoad;
    sceneLoad = storage.repository
      .loadScenes()
      .then((scenes) => set({ scenes, error: null }))
      .catch((e: unknown) => set({ scenes: get().scenes ?? [], error: `씬 라이브러리를 읽지 못했습니다: ${message(e)}` }))
      .finally(() => {
        sceneLoad = null;
      });
    return sceneLoad;
  },

  loadPoses: (force = false) => {
    if (!force && get().poses) return Promise.resolve();
    if (poseLoad) return poseLoad;
    poseLoad = storage.repository
      .loadPoses()
      .then((poses) => set({ poses, error: null }))
      .catch((e: unknown) => set({ poses: get().poses ?? [], error: `포즈 라이브러리를 읽지 못했습니다: ${message(e)}` }))
      .finally(() => {
        poseLoad = null;
      });
    return poseLoad;
  },

  ensureThumb: (path) => {
    if (!path || pendingThumbs.has(path) || get().thumbs[path] !== undefined) return;
    pendingThumbs.add(path);
    storage.repository
      .readImage(path)
      .then((url) => set((s) => ({ thumbs: { ...s.thumbs, [path]: url ?? '' } })))
      .catch(() => set((s) => ({ thumbs: { ...s.thumbs, [path]: '' } })))
      .finally(() => pendingThumbs.delete(path));
  },

  saveScene: async (item, thumbDataUrl) => {
    const stored = await storage.repository.saveScene(item, thumbDataUrl);
    set((s) => ({
      // 아직 목록을 안 읽었으면(null) 나중에 저장소에서 통째로 읽는다
      scenes: s.scenes ? [stored, ...s.scenes.filter((x) => x.id !== stored.id)] : null,
      thumbs: thumbDataUrl && stored.thumbnail ? { ...s.thumbs, [stored.thumbnail]: thumbDataUrl } : s.thumbs,
    }));
    return stored;
  },

  deleteScene: async (id) => {
    await storage.repository.deleteScene(id);
    set((s) => ({ scenes: s.scenes ? s.scenes.filter((x) => x.id !== id) : null }));
  },

  savePose: async (pose, thumbDataUrl) => {
    const stored = await storage.repository.savePose(pose, thumbDataUrl);
    set((s) => ({
      poses: s.poses ? [stored, ...s.poses.filter((x) => x.id !== stored.id)] : null,
      thumbs: thumbDataUrl && stored.thumbnail ? { ...s.thumbs, [stored.thumbnail]: thumbDataUrl } : s.thumbs,
    }));
    return stored;
  },

  deletePose: async (id) => {
    await storage.repository.deletePose(id);
    set((s) => ({ poses: s.poses ? s.poses.filter((x) => x.id !== id) : null }));
  },

  loadProps: (force = false) => {
    if (!force && get().props) return Promise.resolve();
    if (propLoad) return propLoad;
    propLoad = storage.repository
      .loadProps()
      .then((props) => set({ props, error: null }))
      .catch((e: unknown) => set({ props: get().props ?? [], error: `소품 목록을 읽지 못했습니다: ${message(e)}` }))
      .finally(() => {
        propLoad = null;
      });
    return propLoad;
  },

  saveProp: async (asset, thumbDataUrl) => {
    const stored = await storage.repository.saveProp(asset, thumbDataUrl);
    set((s) => ({
      props: s.props ? [...s.props.filter((x) => x.id !== stored.id), stored] : null,
      thumbs: thumbDataUrl && stored.thumbnail ? { ...s.thumbs, [stored.thumbnail]: thumbDataUrl } : s.thumbs,
    }));
    return stored;
  },

  deleteProp: async (id) => {
    await storage.repository.deleteProp(id);
    set((s) => ({ props: s.props ? s.props.filter((x) => x.id !== id) : null }));
  },

  reset: () => {
    pendingThumbs.clear();
    set({ scenes: null, poses: null, props: null, handPoses: null, thumbs: {}, error: null });
  },
}));

/** 썸네일 경로 → 데이터 URL(아직 못 읽었거나 없으면 null). 처음 보일 때 읽는다 */
export function useThumb(path: string | null | undefined): string | null {
  const url = useLibrary((s) => (path ? s.thumbs[path] : undefined));
  const ensure = useLibrary((s) => s.ensureThumb);
  useEffect(() => {
    if (path && url === undefined) ensure(path);
  }, [path, url, ensure]);
  return url || null;
}
