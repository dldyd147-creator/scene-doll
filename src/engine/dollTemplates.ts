import { Box3, Object3D } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
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

/** FBX 단위(cm)를 m로: 키가 10 이상이면 0.01배 하고 변환을 굽는다(뼈대 좌표가 돌 공간 기준이라) */
function normalizeFbx(scene: Object3D): Object3D {
  scene.updateMatrixWorld(true);
  const h = new Box3().setFromObject(scene);
  if (h.max.y - h.min.y > 10) {
    scene.scale.multiplyScalar(0.01);
    scene.updateMatrixWorld(true);
  }
  return scene;
}

/** 내장 GLB 돌을 한 번만 내려받아 템플릿으로 둔다 */
export function loadDollTemplate(asset: DollAsset): Promise<DollTemplate> {
  if (!asset.glbPath) return Promise.reject(new Error('GLB 경로가 없는 돌입니다'));
  const hit = loaded.get(asset.id);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(asset.id);
  if (!p) {
    const url = `${import.meta.env.BASE_URL}${asset.glbPath}`;
    // 시험용 돌은 FBX(믹사모 등)도 받는다. FBX는 보통 cm 단위라 키가 10을 넘으면 m로 맞춘다
    const load: Promise<Object3D> = /\.fbx$/i.test(asset.glbPath) ? new FBXLoader().loadAsync(url).then(normalizeFbx) : new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    p = load.then((scene) => {
      scene.updateMatrixWorld(true);
      const box = new Box3().setFromObject(scene);
      const t: DollTemplate = { scene, unitHeight: Math.max(0.01, box.max.y - box.min.y) };
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
