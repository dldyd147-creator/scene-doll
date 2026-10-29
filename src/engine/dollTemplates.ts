import { Box3, type BufferGeometry, type Mesh, Object3D, type SkinnedMesh } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { DollAsset } from '../model/types';
import { DollRig } from './DollRig';
import { GlbDollRig } from './GlbDollRig';
import { adaptHumanRig, isHumanRigScene } from './humanRigAdapter';
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
    // 루트 배율로 줄이면 뼈대의 돌 공간 좌표가 cm로 남으므로, 모든 노드의 위치와 메시 좌표에 0.01을 직접 굽는다
    const c = 0.01;
    const geos = new Set<BufferGeometry>();
    scene.traverse((o) => {
      if (o !== scene) o.position.multiplyScalar(c);
      const m = o as Mesh;
      if (m.isMesh && !geos.has(m.geometry)) {
        geos.add(m.geometry);
        m.geometry.scale(c, c, c);
        m.geometry.computeBoundingBox();
        m.geometry.computeBoundingSphere();
      }
    });
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const sm = o as SkinnedMesh;
      if (sm.isSkinnedMesh) {
        sm.skeleton.calculateInverses();
        sm.bind(sm.skeleton, sm.matrixWorld);
        // 스킨 메시는 자기 경계상자를 따로 캐시한다(키 계산이 cm로 남지 않게 다시 계산)
        (sm as unknown as { boundingBox: unknown }).boundingBox = null;
        (sm as unknown as { boundingSphere: unknown }).boundingSphere = null;
        sm.computeBoundingBox();
      }
    });
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
    const load: Promise<Object3D> = /\.fbx$/i.test(asset.glbPath) ? new FBXLoader().loadAsync(url).then(normalizeFbx) : new GLTFLoader().loadAsync(url).then((gltf) => (isHumanRigScene(gltf.scene) ? adaptHumanRig(gltf.scene) : gltf.scene));
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
