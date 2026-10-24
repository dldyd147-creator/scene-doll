import { Plane, Quaternion, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three';
import type { Engine } from './Engine';
import type { DollRig } from './DollRig';
import { boneLabel, IK_CHAINS } from './skeleton';
import { rotateObjectWorld } from './three-utils';

type DragState =
  | { kind: 'idle' }
  | { kind: 'pending'; rig: DollRig; bone: string; point: Vector3; x: number; y: number; alt: boolean; viaDot: boolean }
  | { kind: 'direct'; rig: DollRig; bone: string; pivot: Vector3; lever: Vector3; plane: Plane; moved: boolean }
  | { kind: 'twist'; rig: DollRig; bone: string; lastX: number; moved: boolean }
  | { kind: 'ik'; rig: DollRig; effector: string; plane: Plane; moved: boolean }
  | { kind: 'move'; rig: DollRig; plane: Plane; startHit: Vector3; startPos: Vector3; feet: Map<string, Vector3> | null; moved: boolean; viaHip: boolean }
  | { kind: 'yaw'; rig: DollRig; center: Vector3; lastAngle: number; lastX: number; byAngle: boolean; feet: Map<string, Vector3> | null; moved: boolean }
  | { kind: 'camera'; plane: Plane; startHit: Vector3; startPos: Vector3; moved: boolean };

type Pick =
  | { kind: 'ik'; rig: DollRig; effector: string; pos: Vector3 }
  | { kind: 'hip'; rig: DollRig; pos: Vector3 }
  | { kind: 'joint'; rig: DollRig; bone: string; pos: Vector3 }
  | { kind: 'ring'; rig: DollRig; point: Vector3 }
  | { kind: 'camera'; point: Vector3 }
  | { kind: 'part'; rig: DollRig; bone: string; point: Vector3 }
  | null;

const DRAG_THRESHOLD_PX = 3;
const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const _ray = new Raycaster();
const _ndc = new Vector2();
const _hit = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _tmp = new Vector3();

/**
 * 조작뷰 포인터 상호작용(디자인돌 방식).
 * - 손·발 핸들 드래그: IK로 팔·다리 전체가 따라옴
 * - 골반 핸들(사각) 또는 골반 부위 드래그: 돌 전체 이동(바닥 평면, Shift: 화면 평면). Alt+드래그: 돌 전체 회전
 * - 바닥 링 드래그: 돌 전체 회전
 * - 관절점 드래그: 그 관절이 커서를 따라가게 위 뼈를 돌림. 몸 부위 드래그: 그 관절 회전. Alt: 비틀기
 * - 원고 카메라 아이콘 드래그: 카메라 이동
 * - 빈 곳 클릭: 선택 해제. 시점 조작(휠/우클릭)은 OrbitControls가 맡는다.
 */
export class Interaction {
  private state: DragState = { kind: 'idle' };
  private hover: Pick = null;
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

  /** 월드 점의 화면 픽셀 거리 */
  private screenDist(e: PointerEvent, p: Vector3): number {
    const rect = this.el.getBoundingClientRect();
    _tmp.copy(p).project(this.engine.workCamera);
    if (_tmp.z > 1) return Infinity;
    const sx = rect.left + ((_tmp.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - _tmp.y) / 2) * rect.height;
    return Math.hypot(sx - e.clientX, sy - e.clientY);
  }

  private pick(e: PointerEvent): Pick {
    const scale = Math.max(0.7, this.engine.settings.handleSize);
    const rigs = [...this.engine.dolls.values()];
    const selected = this.engine.selectedRig();

    // 1) IK 핸들·골반 핸들(모든 돌) — 선택한 돌을 우선
    let best: Pick = null;
    let bestD = 14 * scale;
    const ordered = selected ? [selected, ...rigs.filter((r) => r !== selected)] : rigs;
    for (const rig of ordered) {
      for (const eff of rig.effectors) {
        const pos = rig.worldPos(IK_CHAINS[eff].end);
        const d = this.screenDist(e, pos);
        if (d < bestD) {
          bestD = d;
          best = { kind: 'ik', rig, effector: eff, pos };
        }
      }
      const hip = rig.hipWorldPos();
      const dh = this.screenDist(e, hip);
      if (dh < bestD) {
        bestD = dh;
        best = { kind: 'hip', rig, pos: hip };
      }
    }
    if (best) return best;

    // 2) 관절점(선택한 돌만)
    if (selected) {
      let bd = 10 * scale;
      for (const bone of selected.jointDotBones) {
        const pos = selected.worldPos(bone);
        const d = this.screenDist(e, pos);
        if (d < bd) {
          bd = d;
          best = { kind: 'joint', rig: selected, bone, pos };
        }
      }
      if (best) return best;
    }

    // 3) 원고 카메라 아이콘
    this.setRay(e);
    if (this.engine.manu.icon.visible) {
      const hits = _ray.intersectObjects(this.engine.manu.iconMeshes, false);
      if (hits.length) return { kind: 'camera', point: hits[0].point.clone() };
    }

    // 4) 몸 부위
    const targets: Object3D[] = [];
    for (const rig of rigs) {
      rig.prepareForPick();
      targets.push(...rig.pickTargets);
    }
    const hits: Intersection[] = _ray.intersectObjects(targets, false);
    for (const hit of hits) {
      const dollId = (hit.object.userData as { dollId?: string }).dollId;
      const rig = dollId ? this.engine.dolls.get(dollId) : undefined;
      if (!rig) continue;
      const bone = rig.boneFromHit(hit);
      if (!bone) continue;
      return { kind: 'part', rig, bone, point: hit.point.clone() };
    }

    // 5) 바닥 링(선택한 돌)
    if (selected && _ray.ray.intersectPlane(GROUND, _hit)) {
      const c = selected.root.position;
      const dist = Math.hypot(_hit.x - c.x, _hit.z - c.z);
      const camDist = this.engine.workCamera.position.distanceTo(_hit);
      const tol = 0.03 + 0.015 * camDist;
      if (Math.abs(dist - selected.groundRingRadius) < tol) return { kind: 'ring', rig: selected, point: _hit.clone() };
    }
    return null;
  }

  private rayOnPlane(e: PointerEvent, plane: Plane): Vector3 | null {
    this.setRay(e);
    return _ray.ray.intersectPlane(plane, _hit) ? _hit.clone() : null;
  }

  private viewPlaneAt(point: Vector3): Plane {
    this.engine.workCamera.getWorldDirection(_dir);
    return new Plane().setFromNormalAndCoplanarPoint(_dir.clone(), point);
  }

  private horizontalPlaneAt(point: Vector3): Plane {
    return new Plane(new Vector3(0, 1, 0), -point.y);
  }

  private gizmoHot(): boolean {
    const g = this.engine.gizmo;
    return !!g && g.getHelper().visible && (g.dragging || g.axis !== null);
  }

  private groundAngle(rig: DollRig, p: Vector3): number {
    return Math.atan2(p.x - rig.root.position.x, p.z - rig.root.position.z);
  }

  // ---------- 이벤트 ----------

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.gizmoHot()) return;
    if (this.state.kind !== 'idle') return;
    const sel = this.engine.callbacks.select;
    const p = this.pick(e);
    if (!p) {
      sel({ dollId: null, bone: null });
      return;
    }
    switch (p.kind) {
      case 'ik':
        sel({ dollId: p.rig.id, bone: IK_CHAINS[p.effector].end });
        p.rig.setEffectorState(p.effector, 'active');
        this.state = { kind: 'ik', rig: p.rig, effector: p.effector, plane: this.viewPlaneAt(p.pos), moved: false };
        break;
      case 'hip':
        sel({ dollId: p.rig.id, bone: null });
        p.rig.setHipState('active');
        this.beginMoveOrYaw(e, p.rig, p.pos, true);
        break;
      case 'joint': {
        const parent = p.rig.skel.parents.get(p.bone) ?? null;
        sel({ dollId: p.rig.id, bone: p.bone });
        if (!parent) break;
        // 관절점을 끌면 그 위 뼈를 돌려 관절이 커서를 따라간다
        this.state = { kind: 'pending', rig: p.rig, bone: parent, point: p.pos, x: e.clientX, y: e.clientY, alt: e.altKey, viaDot: true };
        break;
      }
      case 'camera': {
        sel({ dollId: null, bone: null, camera: true });
        this.state = { kind: 'camera', plane: this.viewPlaneAt(p.point), startHit: p.point, startPos: this.engine.manu.camera.position.clone(), moved: false };
        break;
      }
      case 'part': {
        const isRoot = p.bone === p.rig.skel.order[0];
        sel({ dollId: p.rig.id, bone: isRoot ? null : p.bone });
        if (isRoot) this.beginMoveOrYaw(e, p.rig, p.point, false);
        else this.state = { kind: 'pending', rig: p.rig, bone: p.bone, point: p.point, x: e.clientX, y: e.clientY, alt: e.altKey, viaDot: false };
        break;
      }
      case 'ring': {
        sel({ dollId: p.rig.id, bone: null });
        this.state = { kind: 'yaw', rig: p.rig, center: p.rig.root.position.clone(), lastAngle: this.groundAngle(p.rig, p.point), lastX: e.clientX, byAngle: true, feet: this.engine.capturePlantedFeet(p.rig), moved: false };
        break;
      }
    }
    if (this.state.kind !== 'idle') this.capture(e);
  };

  /** 골반을 잡았을 때: 보통은 이동, Alt면 돌 전체 회전 */
  private beginMoveOrYaw(e: PointerEvent, rig: DollRig, point: Vector3, viaHip: boolean): void {
    const feet = this.engine.capturePlantedFeet(rig);
    if (e.altKey) {
      this.state = { kind: 'yaw', rig, center: rig.root.position.clone(), lastAngle: 0, lastX: e.clientX, byAngle: false, feet, moved: false };
      return;
    }
    const plane = e.shiftKey ? this.viewPlaneAt(point) : this.horizontalPlaneAt(point);
    this.state = { kind: 'move', rig, plane, startHit: point, startPos: rig.root.position.clone(), feet, moved: false, viaHip };
    this.el.style.cursor = 'move';
  }

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
        s.moved = true;
        // 팔꿈치·무릎 아래 뼈는 경첩이라 위 뼈 비틀기와 함께 푼다(관절 한계가 켜진 동안)
        if (this.engine.settings.jointLimits && s.rig.aimHinge(s.bone, v1)) {
          s.lever.copy(v1);
          return;
        }
        _q.setFromUnitVectors(s.lever.clone().normalize(), v1.clone().normalize());
        const speed = this.engine.settings.directDragSpeed;
        if (speed !== 1) _q.slerp(new Quaternion(), 1 - Math.min(1.5, Math.max(0.2, speed)));
        rotateObjectWorld(bone, _q);
        s.lever.copy(v1);
        this.engine.clampAfterChange(s.rig, [s.bone]);
        return;
      }
      case 'twist': {
        const bone = s.rig.skel.bones.get(s.bone)!;
        const dx = e.clientX - s.lastX;
        s.lastX = e.clientX;
        bone.rotateY(dx * 0.012 * this.engine.settings.directDragSpeed);
        bone.updateWorldMatrix(false, true);
        s.moved = true;
        this.engine.clampAfterChange(s.rig, [s.bone]);
        return;
      }
      case 'ik': {
        const target = this.rayOnPlane(e, s.plane);
        if (!target) return;
        this.engine.solveIk(s.rig, s.effector, target);
        s.moved = true;
        return;
      }
      case 'move': {
        const hit = this.rayOnPlane(e, s.plane);
        if (!hit) return;
        s.rig.root.position.copy(s.startPos).add(hit.sub(s.startHit));
        s.rig.root.updateMatrixWorld(true);
        this.engine.keepFeet(s.rig, s.feet);
        s.moved = true;
        return;
      }
      case 'yaw': {
        let delta: number;
        if (s.byAngle) {
          const hit = this.rayOnPlane(e, GROUND);
          if (!hit) return;
          const a = this.groundAngle(s.rig, hit);
          delta = a - s.lastAngle;
          if (delta > Math.PI) delta -= 2 * Math.PI;
          if (delta < -Math.PI) delta += 2 * Math.PI;
          s.lastAngle = a;
        } else {
          delta = -(e.clientX - s.lastX) * 0.01;
          s.lastX = e.clientX;
        }
        this.engine.rotateRootYaw(s.rig, delta);
        this.engine.keepFeet(s.rig, s.feet);
        s.moved = true;
        return;
      }
      case 'camera': {
        const hit = this.rayOnPlane(e, s.plane);
        if (!hit) return;
        const cam = this.engine.manu.camera;
        cam.position.copy(s.startPos).add(hit.sub(s.startHit));
        cam.updateMatrixWorld(true);
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
    if (s.kind === 'ik') s.rig.setEffectorState(s.effector, 'normal');
    if (s.kind === 'move' && s.viaHip) s.rig.setHipState('normal');
    const dollDrag = s.kind === 'direct' || s.kind === 'twist' || s.kind === 'ik' || s.kind === 'move' || s.kind === 'yaw';
    if (commit && dollDrag && s.moved) this.engine.commitDoll(s.rig.id);
    if (commit && s.kind === 'camera' && s.moved) this.engine.commitCamera();
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

  private clearHoverState(): void {
    const h = this.hover;
    if (!h) return;
    if (h.kind === 'ik') h.rig.setEffectorState(h.effector, 'normal');
    if (h.kind === 'hip') h.rig.setHipState('normal');
    this.hover = null;
  }

  private updateHover(e: PointerEvent): void {
    if (this.gizmoHot()) {
      this.clearHoverState();
      this.el.style.cursor = '';
      return;
    }
    const p = this.pick(e);
    const same = this.hover && p && this.hover.kind === p.kind && (this.hover as { rig?: DollRig }).rig === (p as { rig?: DollRig }).rig && (this.hover as { effector?: string }).effector === (p as { effector?: string }).effector;
    if (!same) {
      this.clearHoverState();
      this.hover = p;
      if (p?.kind === 'ik') p.rig.setEffectorState(p.effector, 'hover');
      if (p?.kind === 'hip') p.rig.setHipState('hover');
    }
    const hint = this.engine.callbacks.hint;
    switch (p?.kind) {
      case 'ik':
        this.el.style.cursor = 'grab';
        hint(`${boneLabel(IK_CHAINS[p.effector].end)} IK 핸들 · 끌면 팔·다리가 따라옵니다`);
        return;
      case 'hip':
        this.el.style.cursor = 'move';
        hint('골반 핸들 · 드래그: 돌 이동 · Shift+드래그: 높이 · Alt+드래그: 돌 회전');
        return;
      case 'joint':
        this.el.style.cursor = 'grab';
        hint(`${boneLabel(p.bone)} 관절 · 끌면 관절이 커서를 따라갑니다 · E: 회전 링`);
        return;
      case 'camera':
        this.el.style.cursor = 'move';
        hint('원고 카메라 · 끌어서 이동 · W: 이동 기즈모 · E: 회전 기즈모');
        return;
      case 'part':
        this.el.style.cursor = p.bone === p.rig.skel.order[0] ? 'move' : 'grab';
        hint(p.bone === p.rig.skel.order[0] ? '골반 · 드래그: 돌 이동 · Shift: 높이 · Alt: 돌 회전' : `${boneLabel(p.bone)} · 드래그: 관절 회전 · Alt+드래그: 비틀기 · E: 회전 링`);
        return;
      case 'ring':
        this.el.style.cursor = 'ew-resize';
        hint('바닥 링 · 끌면 돌 전체가 돕니다');
        return;
      default:
        this.el.style.cursor = '';
        hint('');
    }
  }
}
