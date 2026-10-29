import { Box3, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DollAsset } from '../model/types';
import { DollRig } from './DollRig';
import { GlbDollRig } from './GlbDollRig';
import { MannequinRig } from './MannequinRig';

export interface DollTemplate {
  scene: Object3D;
  /** 휴식 자세 키(m) */
  unitHeight: number;
}

const loaded = new Map<string, DollTemplate>();
const loading = new Map<string, Promise<DollTemplate>>();

export function templateIfLoaded(asset: DollAsset): DollTemplate | null {
  return loaded.get(asset.id) ?? null;
}

/** 내장 GLB 돌을 한 번만 내려받아 템플릿으로 둔다 */
export function loadDollTemplate(asset: DollAsset): Promise<DollTemplate> {
  if (!asset.glbPath) return Promise.reject(new Error('GLB 경로가 없는 돌입니다'));
  const hit = loaded.get(asset.id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(asset.id);
  if (!p) {
    const url = `${import.meta.env.BASE_URL}${asset.glbPath}`;
    p = new GLTFLoader().loadAsync(url).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(gltf.scene);
      const t: DollTemplate = { scene: gltf.scene, unitHeight: Math.max(0.01, box.max.y - box.min.y) };
      loaded.set(asset.id, t);
      loading.delete(asset.id);
      return t;
    });
    loading.set(asset.id, p);
  }
  return p;
}

/** 돌 인스턴스를 만든다. GLB 템플릿이 아직 없으면 null(불러온 뒤 다시 호출) */
export function createDollRig(id: string, asset: DollAsset, color: string, heightCm: number): DollRig | null {
  if (!asset.glbPath) return new MannequinRig(id, asset, color, heightCm);
  const t = templateIfLoaded(asset);
  if (!t) return null;
  return new GlbDollRig(id, asset, t, color, heightCm);
}
