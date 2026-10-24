import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from 'three';
import type { CameraState } from '../model/types';
import { LAYER_HELPERS } from './materials';
import { roundTo } from './three-utils';

/** 35mm 풀프레임 가로 36mm 기준으로 초점거리 → 가로 화각 */
export function focalToHorizontalFov(focalMm: number): number {
  return 2 * Math.atan(18 / focalMm);
}

/** 가로 화각과 세로/가로 비율로 세로 화각(three.js fov) */
export function verticalFov(focalMm: number, aspectHW: number): number {
  const h = focalToHorizontalFov(focalMm);
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) * aspectHW));
}

const ICON_COLOR = '#dcdcdc';
const ICON_SELECTED = '#ffb020';

/**
 * 원고 카메라. 컷의 CameraState(위치·yaw·pitch·roll·초점거리)와 화면비를 three.js 카메라로 옮기고,
 * 조작뷰에 보이는 카메라 아이콘과 화각 범위 선(헬퍼 레이어)을 함께 관리한다.
 */
export class ManuscriptCamera {
  readonly camera = new PerspectiveCamera(50, 1 / 1.5, 0.05, 200);
  readonly icon = new Group();
  readonly iconMeshes: Mesh[] = [];
  readonly frustum: LineSegments;
  aspect = 1.5;
  private frustumDistance = 3.5;
  private frustumKey = '';
  private iconMat = new MeshBasicMaterial({ color: ICON_COLOR });
  private iconWireMat = new MeshBasicMaterial({ color: ICON_COLOR, wireframe: true });

  constructor() {
    const body = new Mesh(new BoxGeometry(0.1, 0.07, 0.12), this.iconMat);
    const lens = new Mesh(new ConeGeometry(0.045, 0.07, 4, 1, true), this.iconWireMat);
    lens.rotation.x = -Math.PI / 2;
    lens.rotation.z = Math.PI / 4;
    lens.position.z = -0.095;
    // 위쪽 표시(뷰파인더)
    const finder = new Mesh(new BoxGeometry(0.04, 0.03, 0.05), this.iconMat);
    finder.position.set(0, 0.05, 0.01);
    this.icon.add(body, lens, finder);
    this.iconMeshes.push(body, lens, finder);
    this.icon.traverse((o) => {
      o.layers.set(LAYER_HELPERS);
      o.userData = { camera: true };
    });
    this.camera.add(this.icon);

    this.frustum = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: '#ffb020', transparent: true, opacity: 0.85 }));
    this.frustum.layers.set(LAYER_HELPERS);
    this.frustum.frustumCulled = false;
    this.camera.add(this.frustum);
  }

  apply(state: CameraState, aspect: number): void {
    this.aspect = aspect;
    this.camera.position.set(state.position[0], state.position[1], state.position[2]);
    this.camera.rotation.set(MathUtils.degToRad(state.pitch), MathUtils.degToRad(state.yaw), MathUtils.degToRad(state.roll), 'YXZ');
    this.camera.fov = verticalFov(state.focalLength, aspect);
    this.camera.aspect = 1 / aspect;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.updateFrustum();
  }

  /** 현재 three.js 카메라에서 CameraState를 읽는다(기즈모로 움직인 뒤) */
  read(focalLength: number): CameraState {
    const e = new Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    return {
      position: [roundTo(this.camera.position.x, 4), roundTo(this.camera.position.y, 4), roundTo(this.camera.position.z, 4)],
      yaw: roundTo(MathUtils.radToDeg(e.y), 2),
      pitch: roundTo(MathUtils.radToDeg(e.x), 2),
      roll: roundTo(MathUtils.radToDeg(e.z), 2),
      focalLength,
    };
  }

  setSelected(on: boolean): void {
    this.iconMat.color.set(on ? ICON_SELECTED : ICON_COLOR);
    this.iconWireMat.color.set(on ? ICON_SELECTED : ICON_COLOR);
  }

  /** 조작뷰의 화각 범위 선을 그릴 거리(피사체까지) */
  setFrustumDistance(d: number): void {
    const clamped = Math.max(0.3, Math.min(30, d));
    if (Math.abs(clamped - this.frustumDistance) < 0.01) return;
    this.frustumDistance = clamped;
    this.updateFrustum();
  }

  setFrustumVisible(v: boolean): void {
    this.frustum.visible = v;
  }

  private updateFrustum(): void {
    const d = this.frustumDistance;
    const key = `${this.camera.fov.toFixed(3)}|${this.camera.aspect.toFixed(4)}|${d.toFixed(3)}`;
    if (key === this.frustumKey) return;
    this.frustumKey = key;
    const h = 2 * d * Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const w = h * this.camera.aspect;
    const x = w / 2;
    const y = h / 2;
    const z = -d;
    const c = [
      [-x, -y, z],
      [x, -y, z],
      [x, y, z],
      [-x, y, z],
    ];
    const pts: number[] = [];
    for (let i = 0; i < 4; i++) {
      pts.push(0, 0, 0, ...c[i]);
      pts.push(...c[i], ...c[(i + 1) % 4]);
    }
    // 위쪽 표시(화면의 위가 어디인지): 윗변 중앙에 작은 삼각형
    pts.push(-0.08 * x, y, z, 0, y * 1.12, z, 0, y * 1.12, z, 0.08 * x, y, z);
    this.frustum.geometry.dispose();
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.frustum.geometry = g;
  }
}
