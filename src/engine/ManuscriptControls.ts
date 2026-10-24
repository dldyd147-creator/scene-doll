import { MathUtils, Quaternion, Vector3 } from 'three';
import type { CameraState } from '../model/types';
import type { Engine } from './Engine';

type Mode = 'orbit' | 'pan' | null;

const _fwd = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _q = new Quaternion();

/** yaw·pitch·roll(도)로 카메라 쿼터니언 */
export function cameraQuaternion(yaw: number, pitch: number, roll: number, target = new Quaternion()): Quaternion {
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), MathUtils.degToRad(yaw));
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), MathUtils.degToRad(pitch));
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), MathUtils.degToRad(roll));
  return target.copy(qy).multiply(qx).multiply(qz);
}

/** 카메라 앞 방향(월드) */
export function cameraForward(state: CameraState, target = new Vector3()): Vector3 {
  cameraQuaternion(state.yaw, state.pitch, state.roll, _q);
  return target.set(0, 0, -1).applyQuaternion(_q);
}

/** 위치와 바라볼 점으로 yaw·pitch를 구한다(롤 0) */
export function lookAtAngles(position: Vector3, target: Vector3): { yaw: number; pitch: number } {
  const d = target.clone().sub(position);
  const horiz = Math.hypot(d.x, d.z);
  const yaw = MathUtils.radToDeg(Math.atan2(-d.x, -d.z));
  const pitch = MathUtils.radToDeg(Math.atan2(d.y, horiz));
  return { yaw: round2(yaw), pitch: round2(pitch) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * 원고뷰 위에서의 원고 카메라 조작.
 * - 궤도 회전: 피사체(화면 안 돌의 중심)를 축으로 카메라를 돌린다
 * - 팬: 카메라를 화면 평면에서 민다
 * - 휠: 피사체 쪽으로 돌리(달리), Ctrl+휠: 초점거리
 * 버튼 배치는 설정(스케치업/디자인돌)을 따르고, 왼쪽 드래그는 두 방식 모두 궤도 회전이다(원고뷰에는 선택할 것이 없다).
 * 드래그 중에는 엔진에 바로 반영하고, 놓을 때 컷에 기록한다(되돌리기 1단계).
 */
export class ManuscriptControls {
  private mode: Mode = null;
  private pointerId: number | null = null;
  private last = { x: 0, y: 0 };
  private state: CameraState | null = null;
  private pivot = new Vector3();
  private dist = 3;
  private wheelTimer = 0;

  constructor(
    private engine: Engine,
    private el: HTMLElement,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
  }

  private onContext = (e: Event): void => e.preventDefault();

  private modeFor(e: PointerEvent): Mode {
    const designdoll = this.engine.settings.orbitMode === 'designdoll';
    if (e.button === 0) return e.shiftKey ? 'pan' : 'orbit';
    if (e.button === 1) return designdoll ? 'pan' : e.shiftKey ? 'pan' : 'orbit';
    if (e.button === 2) return designdoll ? 'orbit' : 'pan';
    return null;
  }

  private begin(): void {
    const cut = this.engine.cut;
    if (!cut) return;
    this.state = { ...cut.camera, position: [...cut.camera.position] as [number, number, number] };
    const pos = new Vector3(...this.state.position);
    const subject = this.engine.subjectCenter();
    cameraForward(this.state, _fwd);
    // 피사체를 시선 위에 투영한 점을 회전축으로 쓴다(화면 밖이어도 자연스럽다)
    this.dist = Math.max(0.3, subject.clone().sub(pos).dot(_fwd));
    this.pivot.copy(pos).add(_fwd.clone().multiplyScalar(this.dist));
  }

  private onDown = (e: PointerEvent): void => {
    const mode = this.modeFor(e);
    if (!mode) return;
    e.preventDefault();
    this.begin();
    if (!this.state) return;
    this.mode = mode;
    this.last = { x: e.clientX, y: e.clientY };
    this.pointerId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.el.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.mode || !this.state) return;
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    const s = this.engine.settings;
    if (this.mode === 'orbit') {
      const k = 0.25 * s.rotateSpeed;
      this.state.yaw = round2(this.state.yaw - dx * k);
      this.state.pitch = round2(Math.max(-89, Math.min(89, this.state.pitch - dy * k)));
      cameraForward(this.state, _fwd);
      const pos = this.pivot.clone().sub(_fwd.multiplyScalar(this.dist));
      this.state.position = [round4(pos.x), round4(pos.y), round4(pos.z)];
    } else {
      const rect = this.el.getBoundingClientRect();
      const vfov = MathUtils.degToRad(this.engine.manu.camera.fov);
      const worldPerPx = (2 * this.dist * Math.tan(vfov / 2)) / Math.max(1, rect.height);
      cameraQuaternion(this.state.yaw, this.state.pitch, this.state.roll, _q);
      _right.set(1, 0, 0).applyQuaternion(_q);
      _up.set(0, 1, 0).applyQuaternion(_q);
      const k = worldPerPx * s.panSpeed;
      const delta = _right.multiplyScalar(-dx * k).add(_up.multiplyScalar(dy * k));
      const pos = new Vector3(...this.state.position).add(delta);
      this.pivot.add(delta);
      this.state.position = [round4(pos.x), round4(pos.y), round4(pos.z)];
    }
    this.engine.previewCamera(this.state);
  };

  private onUp = (): void => {
    if (!this.mode) return;
    this.mode = null;
    this.el.style.cursor = 'grab';
    if (this.pointerId !== null) {
      try {
        this.el.releasePointerCapture(this.pointerId);
      } catch {
        /* ignore */
      }
      this.pointerId = null;
    }
    if (this.state) this.engine.commitCameraState(this.state);
    this.state = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const cut = this.engine.cut;
    if (!cut) return;
    if (!this.state) this.begin();
    if (!this.state) return;
    const notch = Math.sign(e.deltaY);
    if (e.ctrlKey || e.metaKey) {
      // 초점거리: 24~200mm
      const f = this.state.focalLength;
      const next = Math.round(Math.max(18, Math.min(200, f * (notch > 0 ? 1 / 1.1 : 1.1))));
      this.state.focalLength = next;
    } else {
      const factor = notch > 0 ? 1.12 : 1 / 1.12;
      const scaled = Math.max(0.2, this.dist * Math.pow(factor, this.engine.settings.zoomSpeed));
      cameraForward(this.state, _fwd);
      const pos = this.pivot.clone().sub(_fwd.multiplyScalar(scaled));
      this.dist = scaled;
      this.state.position = [round4(pos.x), round4(pos.y), round4(pos.z)];
    }
    this.engine.previewCamera(this.state);
    // 휠이 멈추면 한 번만 기록
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      if (this.state && !this.mode) {
        this.engine.commitCameraState(this.state);
        this.state = null;
      }
    }, 250);
  };
}
