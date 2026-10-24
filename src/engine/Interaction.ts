import { Color, MeshBasicMaterial, Plane, Quaternion, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three';
import type { Engine } from './Engine';
import type { DollHandle, DollPart, DollRig } from './DollRig';
import { HANDLE_ACTIVE_COLOR, HANDLE_COLOR, HANDLE_HOVER_COLOR } from './materials';
import { BONE_LABELS, IK_CHAINS } from './skeleton';
import { rotateObjectWorld } from './three-utils';

type DragState =
  | { kind: 'idle' }
  | { kind: 'pending'; rig: DollRig; bone: string; point: Vector3; x: number; y: number; alt: boolean }
  | { kind: 'direct'; rig: DollRig; bone: string; pivot: Vector3; lever: Vector3; plane: Plane; moved: boolean }
  | { kind: 'twist'; rig: DollRig; bone: string; lastX: number; moved: boolean }
  | { kind: 'ik'; rig: DollRig; effector: string; plane: Plane; handle: DollHandle; moved: boolean };

const DRAG_THRESHOLD_PX = 3;
/** IK 핸들 클릭 반경(px) */
const HANDLE_PICK_PX = 16;
const _ray = new Raycaster();
const _ndc = new Vector2();
const _hit = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _tmp = new Vector3();

/**
 * 조작뷰 포인터 상호작용(디자인돌 방식).
 * - 몸 부위를 잡고 끌면 그 관절이 바로 회전(화면 평면 기준 레버)
 * - Alt+드래그: 뼈 축 비틀기
 * - 손·발 핸들을 끌면 IK로 팔·다리 전체가 따라옴(핸들은 화면 평행 평면 위를 움직인다)
 * - 빈 곳 클릭: 선택 해제. 시점 조작(휠/우클릭)은 OrbitControls가 맡는다.
 */
export class Interaction {
  private state: DragState = { kind: 'idle' };
  private hoverHandle: DollHandle | null = null;
  private pointerId: number | null = null;

  constructor(
    private engine: Engine,
    private el: HTMLElement,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('lostpointercapture', this.onLost);
    el.style.touchAction = 'none';
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('lostpointercapture', this.onLost);
  }

  get dragging(): boolean {
    return this.state.kind !== 'idle' && this.state.kind !== 'pending';
  }

  // ---------- 피킹 ----------

  private setRay(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    _ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.engine.workCamera);
  }

  /** 화면 거리로 IK 핸들을 고른다(작은 구라도 넉넉히 잡히게) */
  private pickHandle(e: PointerEvent): DollHandle | null {
    const rect = this.el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const cam = this.engine.workCamera;
    let best: DollHandle | null = null;
    let bestD = HANDLE_PICK_PX * Math.max(0.6, this.engine.settings.handleSize);
    for (const rig of this.engine.dolls.values()) {
      for (const h of rig.handles.values()) {
        _tmp.copy(h.position).project(cam);
        if (_tmp.z > 1) continue;
        const sx = ((_tmp.x + 1) / 2) * rect.width;
        const sy = ((1 - _tmp.y) / 2) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    }
    return best;
  }

  private pickPart(e: PointerEvent): { rig: DollRig; part: DollPart; point: Vector3 } | null {
    this.setRay(e);
    const targets: Object3D[] = [];
    for (const rig of this.engine.dolls.values()) targets.push(...rig.parts);
    const hits: Intersection[] = _ray.intersectObjects(targets, false);
    if (!hits.length) return null;
    const part = hits[0].object as DollPart;
    const rig = this.engine.dolls.get(part.userData.dollId);
    if (!rig) return null;
    return { rig, part, point: hits[0].point.clone() };
  }

  private rayOnPlane(e: PointerEvent, plane: Plane): Vector3 | null {
    this.setRay(e);
    return _ray.ray.intersectPlane(plane, _hit) ? _hit.clone() : null;
  }

  private viewPlaneAt(point: Vector3): Plane {
    this.engine.workCamera.getWorldDirection(_dir);
    return new Plane().setFromNormalAndCoplanarPoint(_dir.clone(), point);
  }

  private gizmoHot(): boolean {
    const g = this.engine.gizmo;
    return !!g && g.getHelper().visible && (g.dragging || g.axis !== null);
  }

  // ---------- 이벤트 ----------

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.gizmoHot()) return;
    if (this.state.kind !== 'idle') return;

    const handle = this.pickHandle(e);
    if (handle) {
      const rig = this.engine.dolls.get(handle.userData.dollId);
      if (!rig) return;
      const effector = handle.userData.effector;
      this.engine.callbacks.select({ dollId: rig.id, bone: IK_CHAINS[effector].end });
      this.setHandleColor(handle, HANDLE_ACTIVE_COLOR);
      this.state = { kind: 'ik', rig, effector, plane: this.viewPlaneAt(handle.position), handle, moved: false };
      this.capture(e);
      return;
    }

    const hit = this.pickPart(e);
    if (hit) {
      const bone = hit.part.userData.bone;
      this.engine.callbacks.select({ dollId: hit.rig.id, bone });
      this.state = { kind: 'pending', rig: hit.rig, bone, point: hit.point, x: e.clientX, y: e.clientY, alt: e.altKey };
      this.capture(e);
      return;
    }

    this.engine.callbacks.select({ dollId: null, bone: null });
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.state;
    switch (s.kind) {
      case 'idle':
        this.updateHover(e);
        return;
      case 'pending': {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_THRESHOLD_PX) return;
        const bone = s.rig.skel.bones.get(s.bone);
        if (!bone) {
          this.state = { kind: 'idle' };
          return;
        }
        if (s.alt || e.altKey) {
          this.state = { kind: 'twist', rig: s.rig, bone: s.bone, lastX: e.clientX, moved: false };
        } else {
          const pivot = s.rig.worldPos(s.bone);
          const lever = s.point.clone().sub(pivot);
          if (lever.lengthSq() < 1e-8) lever.set(0, 0.01, 0);
          this.state = { kind: 'direct', rig: s.rig, bone: s.bone, pivot, lever, plane: this.viewPlaneAt(s.point), moved: false };
        }
        this.el.style.cursor = 'grabbing';
        this.onMove(e);
        return;
      }
      case 'direct': {
        const bone = s.rig.skel.bones.get(s.bone)!;
        const q = this.rayOnPlane(e, s.plane);
        if (!q) return;
        const v1 = q.sub(s.pivot);
        if (v1.lengthSq() < 1e-8) return;
        _q.setFromUnitVectors(s.lever.clone().normalize(), v1.clone().normalize());
        const speed = this.engine.settings.directDragSpeed;
        if (speed !== 1) _q.slerp(new Quaternion(), 1 - Math.min(1.5, Math.max(0.2, speed)));
        rotateObjectWorld(bone, _q);
        s.lever.copy(v1);
        s.moved = true;
        return;
      }
      case 'twist': {
        const bone = s.rig.skel.bones.get(s.bone)!;
        const dx = e.clientX - s.lastX;
        s.lastX = e.clientX;
        bone.rotateY(dx * 0.012 * this.engine.settings.directDragSpeed);
        bone.updateWorldMatrix(false, true);
        s.moved = true;
        return;
      }
      case 'ik': {
        const target = this.rayOnPlane(e, s.plane);
        if (!target) return;
        this.engine.solveIk(s.rig, s.effector, target);
        s.moved = true;
        return;
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.finish(e.button === 0 || e.type === 'pointercancel');
  };

  private onLost = (): void => {
    if (this.state.kind !== 'idle') this.finish(true);
  };

  private finish(commit: boolean): void {
    const s = this.state;
    if (s.kind === 'ik') this.setHandleColor(s.handle, HANDLE_COLOR);
    if (commit && (s.kind === 'direct' || s.kind === 'twist' || s.kind === 'ik') && s.moved) {
      this.engine.commitDoll(s.rig.id);
    }
    this.state = { kind: 'idle' };
    this.el.style.cursor = '';
    if (this.pointerId !== null) {
      try {
        this.el.releasePointerCapture(this.pointerId);
      } catch {
        /* 이미 해제됨 */
      }
      this.pointerId = null;
    }
  }

  private capture(e: PointerEvent): void {
    this.pointerId = e.pointerId;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 불가 환경 */
    }
  }

  // ---------- 호버 ----------

  private setHandleColor(h: DollHandle, hex: string): void {
    (h.material as MeshBasicMaterial).color = new Color(hex);
  }

  private updateHover(e: PointerEvent): void {
    if (this.gizmoHot()) {
      this.clearHover();
      return;
    }
    const handle = this.pickHandle(e);
    if (handle !== this.hoverHandle) {
      if (this.hoverHandle) this.setHandleColor(this.hoverHandle, HANDLE_COLOR);
      this.hoverHandle = handle;
      if (handle) this.setHandleColor(handle, HANDLE_HOVER_COLOR);
    }
    if (handle) {
      this.el.style.cursor = 'grab';
      const label = BONE_LABELS[IK_CHAINS[handle.userData.effector].end] ?? handle.userData.effector;
      this.engine.callbacks.hint(`${label} IK 핸들 · 끌면 팔·다리가 따라옵니다`);
      return;
    }
    const hit = this.pickPart(e);
    if (hit) {
      this.el.style.cursor = 'grab';
      const label = BONE_LABELS[hit.part.userData.bone] ?? hit.part.userData.bone;
      this.engine.callbacks.hint(`${label} · 드래그: 관절 회전 · Alt+드래그: 비틀기 · E: 회전 링`);
      return;
    }
    this.el.style.cursor = '';
    this.engine.callbacks.hint('');
  }

  private clearHover(): void {
    if (this.hoverHandle) {
      this.setHandleColor(this.hoverHandle, HANDLE_COLOR);
      this.hoverHandle = null;
    }
    this.el.style.cursor = '';
  }
}
