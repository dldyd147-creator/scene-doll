import { Plane, Quaternion, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three';
import type { Engine } from './Engine';
import type { DollRig } from './DollRig';
import { boneLabel, IK_CHAINS } from './skeleton';
import { rotateObjectWorld } from './three-utils';

type DragState =
  | { kind: 'idle' }
  | { kind: 'pending'; rig: DollRig; bone: string; point: Vector3; x: number; y: number; alt: boolean }
  | { kind: 'direct'; rig: DollRig; bone: string; pivot: Vector3; lever: Vector3; plane: Plane; moved: boolean }
  | { kind: 'twist'; rig: DollRig; bone: string; lastX: number; moved: boolean }
  | { kind: 'ik'; rig: DollRig; effector: string; plane: Plane; moved: boolean }
  | { kind: 'hipmove'; rig: DollRig; plane: Plane; startHit: Vector3; startPos: Vector3; feet: Map<string, Vector3>; joints: ReturnType<DollRig['getJoints']>; moved: boolean }
  | { kind: 'camera'; plane: Plane; startHit: Vector3; startPos: Vector3; moved: boolean };

type Pick =
  | { kind: 'ik'; rig: DollRig; effector: string; pos: Vector3 }
  | { kind: 'joint'; rig: DollRig; bone: string; pos: Vector3 }
  | { kind: 'camera'; point: Vector3 }
  | { kind: 'part'; rig: DollRig; bone: string; point: Vector3 }
  | null;

/** 월드(three.js) 축. 사용자에게는 블렌더처럼 Z가 위아래, Y가 앞뒤로 보인다 */
export type Axis = 'x' | 'y' | 'z' | null;

/** 키 → 월드 축. 사용자의 Z(위아래)는 월드 Y, 사용자의 Y(앞뒤)는 월드 Z */
const KEY_TO_AXIS: Record<string, Exclude<Axis, null>> = { x: 'x', y: 'z', z: 'y' };
const AXIS_LABEL: Record<Exclude<Axis, null>, string> = { x: 'X축(좌우)', y: 'Z축(위아래)', z: 'Y축(앞뒤)' };

/** 블렌더식 모달 변형(G 이동 / R 회전). 마우스를 움직이면 바로 따라오고 클릭·Enter로 확정, Esc·우클릭으로 취소 */
interface ModalState {
  kind: 'move' | 'rotate';
  target: { rig: DollRig } | { camera: true };
  axis: Axis;
  startPointer: { x: number; y: number };
  lastPointer: { x: number; y: number };
  startPos: Vector3;
  startQuat: Quaternion;
  /** 이동용: 시작 시 바닥 평면 위의 포인터 점 */
  startHit: Vector3 | null;
}

const DRAG_THRESHOLD_PX = 3;
const AXES: Record<Exclude<Axis, null>, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const _ray = new Raycaster();
const _ndc = new Vector2();
const _hit = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _tmp = new Vector3();

/**
 * 조작뷰 포인터 상호작용(디자인돌 방식).
 * - 손·발 핸들 드래그: IK로 팔·다리 전체가 따라옴
 * - 관절점 드래그: 그 관절이 커서를 따라가게 위 뼈를 돌림. 몸 부위 드래그: 그 관절 회전. Alt: 비틀기
 * - 골반(부위·관절점) 드래그: 발을 바닥에 둔 채 몸통을 끌어 옮김(끌어내리면 앉음). 회전은 R 키·회전 기즈모로만
 * - 원고 카메라 아이콘 드래그: 카메라 이동
 * - G/M: 선택 대상 이동, R: 회전(블렌더식 모달, X/Y/Z 축 고정 — Z가 위아래)
 * - 빈 곳 클릭: 선택 해제. 시점 조작(휠/우클릭)은 OrbitControls가 맡는다.
 */
export class Interaction {
  private state: DragState = { kind: 'idle' };
  private modal: ModalState | null = null;
  private hover: Pick = null;
  private pointerId: number | null = null;
  private lastPointer = { x: 0, y: 0 };

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
    this.cancelModal();
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

  get modalActive(): boolean {
    return this.modal !== null;
  }

  // ---------- 피킹 ----------

  private setRayAt(clientX: number, clientY: number): void {
    const rect = this.el.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, this.engine.workCamera);
  }

  private setRay(e: PointerEvent): void {
    this.setRayAt(e.clientX, e.clientY);
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

  /** 점이 몸에 가려져 있는지(제어점 그리기와 같은 기준: 카메라 쪽으로 당긴 점이 메시 뒤면 가려짐) */
  private occluded(p: Vector3, pull: number, targets: Object3D[]): boolean {
    const cam = this.engine.workCamera.position;
    const toCam = cam.clone().sub(p);
    const d = toCam.length();
    if (d < 1e-6) return false;
    const probe = p.clone().add(toCam.multiplyScalar(Math.min(d * 0.5, pull) / d));
    _ray.set(cam, probe.clone().sub(cam).normalize());
    _ray.far = cam.distanceTo(probe) - 1e-3;
    const hit = _ray.intersectObjects(targets, false).length > 0;
    _ray.far = Infinity;
    return hit;
  }

  private pick(e: PointerEvent): Pick {
    const scale = Math.max(0.7, this.engine.settings.handleSize);
    const rigs = [...this.engine.dolls.values()];
    const selected = this.engine.selectedRig();
    const targets: Object3D[] = [];
    for (const rig of rigs) {
      rig.prepareForPick();
      targets.push(...rig.pickTargets);
    }

    // 1) IK 핸들(모든 돌, 가려진 것 제외) — 선택한 돌을 우선
    let best: Pick = null;
    let bestD = 14 * scale;
    const ordered = selected ? [selected, ...rigs.filter((r) => r !== selected)] : rigs;
    for (const rig of ordered) {
      const s = rig.heightCm / 175;
      for (const eff of rig.effectors) {
        const pos = rig.worldPos(IK_CHAINS[eff].end);
        const d = this.screenDist(e, pos);
        if (d < bestD && !this.occluded(pos, 0.05 * s, targets)) {
          bestD = d;
          best = { kind: 'ik', rig, effector: eff, pos };
        }
      }
    }
    if (best) return best;

    // 2) 관절점(선택한 돌만)
    if (selected) {
      let bd = 10 * scale;
      const s = selected.heightCm / 175;
      for (const bone of selected.jointDotBones) {
        const pos = selected.worldPos(bone);
        const d = this.screenDist(e, pos);
        // 몸통 제어점은 가려져도 보이고 잡힌다
        if (d < bd && (selected.isTorsoDot(bone) || !this.occluded(pos, 0.1 * s, targets))) {
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
    const hits: Intersection[] = _ray.intersectObjects(targets, false);
    for (const hit of hits) {
      const dollId = (hit.object.userData as { dollId?: string }).dollId;
      const rig = dollId ? this.engine.dolls.get(dollId) : undefined;
      if (!rig) continue;
      const bone = rig.boneFromHit(hit);
      if (!bone) continue;
      return { kind: 'part', rig, bone, point: hit.point.clone() };
    }
    return null;
  }

  private rayOnPlane(e: PointerEvent, plane: Plane): Vector3 | null {
    this.setRay(e);
    return _ray.ray.intersectPlane(plane, _hit) ? _hit.clone() : null;
  }

  private rayOnPlaneAt(clientX: number, clientY: number, plane: Plane): Vector3 | null {
    this.setRayAt(clientX, clientY);
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

  /** 골반 이동 시작: 발 위치를 기억하고(항상), 화면 평행 평면에서 몸통을 끈다 */
  private beginHipMove(rig: DollRig, point: Vector3): void {
    this.state = {
      kind: 'hipmove',
      rig,
      plane: this.viewPlaneAt(point),
      startHit: point,
      startPos: rig.root.position.clone(),
      feet: this.engine.capturePlantedFeet(rig),
      joints: rig.getJoints(),
      moved: false,
    };
    this.el.style.cursor = 'move';
  }

  // ---------- 이벤트 ----------

  private onDown = (e: PointerEvent): void => {
    if (this.modal) {
      // 모달 중 클릭: 왼쪽 확정, 오른쪽 취소
      if (e.button === 0) this.confirmModal();
      else if (e.button === 2) this.cancelModal();
      e.preventDefault();
      return;
    }
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
      case 'joint': {
        const isRoot = p.bone === p.rig.skel.order[0];
        sel({ dollId: p.rig.id, bone: isRoot ? null : p.bone });
        if (isRoot) {
          this.beginHipMove(p.rig, p.pos);
          break;
        }
        // 관절점을 끌면 그 위 뼈를 돌려 관절이 커서를 따라간다
        const parent = p.rig.skel.parents.get(p.bone) ?? p.bone;
        this.state = { kind: 'pending', rig: p.rig, bone: parent, point: p.pos, x: e.clientX, y: e.clientY, alt: e.altKey };
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
        if (isRoot) this.beginHipMove(p.rig, p.point);
        else this.state = { kind: 'pending', rig: p.rig, bone: p.bone, point: p.point, x: e.clientX, y: e.clientY, alt: e.altKey };
        break;
      }
    }
    this.capture(e);
  };

  private onMove = (e: PointerEvent): void => {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (this.modal) return; // 모달은 window 리스너가 처리
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
          this.engine.enforceFloor(s.rig);
          return;
        }
        _q.setFromUnitVectors(s.lever.clone().normalize(), v1.clone().normalize());
        const speed = this.engine.settings.directDragSpeed;
        if (speed !== 1) _q.slerp(new Quaternion(), 1 - Math.min(1.5, Math.max(0.2, speed)));
        rotateObjectWorld(bone, _q);
        s.lever.copy(v1);
        this.engine.clampAfterChange(s.rig, [s.bone]);
        this.engine.enforceFloor(s.rig);
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
      case 'hipmove': {
        const hit = this.rayOnPlane(e, s.plane);
        if (!hit) return;
        const delta = hit.sub(s.startHit);
        // 시작 자세에서 다시 풀어 떨림·누적을 막는다
        const apply = (k: number): number => {
          s.rig.root.position.copy(s.startPos).addScaledVector(delta, k);
          s.rig.root.updateMatrixWorld(true);
          s.rig.setJoints(s.joints);
          this.engine.keepFeet(s.rig, s.feet);
          return this.engine.feetError(s.rig, s.feet);
        };
        // 아래로 끌어 다리가 더 못 접히거나(발이 못 닿음) 몸이 바닥을 뚫으면, 되는 가장 깊은 곳에서 멈춘다. 위·옆으로는 발이 따라온다(돌 들어 올리기)
        const overshoot = (k: number) => apply(k) > 0.003 || this.engine.belowFloor(s.rig);
        if (overshoot(1) && delta.y < 0 && s.feet.size) {
          let lo = 0;
          let hi = 1;
          for (let i = 0; i < 10; i++) {
            const mid = (lo + hi) / 2;
            if (overshoot(mid)) hi = mid;
            else lo = mid;
          }
          apply(lo);
        }
        this.engine.enforceFloor(s.rig);
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
    if (this.modal) return;
    this.finish(e.button === 0 || e.type === 'pointercancel');
  };

  private onLost = (): void => {
    if (this.modal) return;
    if (this.state.kind !== 'idle') this.finish(true);
  };

  private finish(commit: boolean): void {
    const s = this.state;
    if (s.kind === 'ik') s.rig.setEffectorState(s.effector, 'normal');
    const dollDrag = s.kind === 'direct' || s.kind === 'twist' || s.kind === 'ik' || s.kind === 'hipmove';
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

  // ---------- 모달 변형(G/R) ----------

  /** G(이동)·R(회전) 시작. 선택한 돌 또는 원고 카메라가 대상 */
  startModal(kind: 'move' | 'rotate'): boolean {
    if (this.modal || this.dragging) return false;
    const rig = this.engine.selectedRig();
    const cameraSel = !!this.engine.selection.camera;
    if (!rig && !cameraSel) return false;
    const obj = rig ? rig.root : this.engine.manu.camera;
    // 포인터가 조작뷰 밖이면(또는 아직 안 움직였으면) 첫 움직임에서 기준점을 잡는다
    const rect = this.el.getBoundingClientRect();
    const inside = this.lastPointer.x >= rect.left && this.lastPointer.x <= rect.right && this.lastPointer.y >= rect.top && this.lastPointer.y <= rect.bottom;
    const startHit = inside ? this.rayOnPlaneAt(this.lastPointer.x, this.lastPointer.y, new Plane(new Vector3(0, 1, 0), -obj.position.y)) : null;
    this.modal = {
      kind,
      target: rig ? { rig } : { camera: true },
      axis: null,
      startPointer: { ...this.lastPointer },
      lastPointer: { ...this.lastPointer },
      startPos: obj.position.clone(),
      startQuat: obj.quaternion.clone(),
      startHit,
    };
    if (this.engine.orbit) this.engine.orbit.enabled = false;
    window.addEventListener('pointermove', this.onModalMove);
    window.addEventListener('keydown', this.onModalKey, true);
    this.el.style.cursor = kind === 'move' ? 'move' : 'ew-resize';
    this.modalHint();
    return true;
  }

  private modalHint(): void {
    const m = this.modal;
    if (!m) return;
    const what = 'camera' in m.target ? '원고 카메라' : '돌';
    const axis = m.axis ? `${AXIS_LABEL[m.axis]} 고정` : m.kind === 'move' ? '바닥 평면' : 'Z축(위아래) 둘레';
    this.engine.callbacks.hint(`${what} ${m.kind === 'move' ? '이동' : '회전'} · ${axis} · X/Y/Z: 축 고정(Z가 위아래) · 클릭/Enter: 확정 · Esc/우클릭: 취소`);
  }

  private onModalKey = (e: KeyboardEvent): void => {
    const m = this.modal;
    if (!m) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      this.cancelModal();
    } else if (k === 'enter' || k === ' ') {
      this.confirmModal();
    } else if (k === 'x' || k === 'y' || k === 'z') {
      const axis = KEY_TO_AXIS[k];
      m.axis = m.axis === axis ? null : axis;
      this.applyModal();
      this.modalHint();
    } else if (k === 'g' || k === 'm' || k === 'r') {
      // 모달 중 G↔R 전환
      const next = k === 'r' ? 'rotate' : 'move';
      if (next !== m.kind) {
        this.restoreModalStart();
        m.kind = next;
        m.axis = null;
        m.startPointer = { ...m.lastPointer };
        this.modalHint();
      }
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  private onModalMove = (e: PointerEvent): void => {
    const m = this.modal;
    if (!m) return;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (!m.startHit) {
      // 기준점이 없었으면 지금 위치를 시작점으로
      m.startPointer = { x: e.clientX, y: e.clientY };
      m.lastPointer = { x: e.clientX, y: e.clientY };
      m.startHit = this.rayOnPlaneAt(e.clientX, e.clientY, new Plane(new Vector3(0, 1, 0), -m.startPos.y));
      return;
    }
    m.lastPointer = { x: e.clientX, y: e.clientY };
    this.applyModal();
  };

  private modalObject(): Object3D {
    const m = this.modal!;
    return 'camera' in m.target ? this.engine.manu.camera : m.target.rig.root;
  }

  private restoreModalStart(): void {
    const m = this.modal!;
    const obj = this.modalObject();
    obj.position.copy(m.startPos);
    obj.quaternion.copy(m.startQuat);
    obj.updateMatrixWorld(true);
  }

  private applyModal(): void {
    const m = this.modal;
    if (!m) return;
    const obj = this.modalObject();
    const dx = m.lastPointer.x - m.startPointer.x;
    if (m.kind === 'move') {
      let delta: Vector3 | null = null;
      if (m.axis === 'y') {
        // 위아래: 화면 평행 평면에서 위아래만
        const plane = this.viewPlaneAt(m.startPos);
        const a = this.rayOnPlaneAt(m.startPointer.x, m.startPointer.y, plane);
        const b = this.rayOnPlaneAt(m.lastPointer.x, m.lastPointer.y, plane);
        if (a && b) delta = new Vector3(0, b.y - a.y, 0);
      } else {
        const plane = new Plane(new Vector3(0, 1, 0), -m.startPos.y);
        const a = m.startHit ?? this.rayOnPlaneAt(m.startPointer.x, m.startPointer.y, plane);
        const b = this.rayOnPlaneAt(m.lastPointer.x, m.lastPointer.y, plane);
        if (a && b) {
          delta = b.clone().sub(a);
          if (m.axis === 'x') delta.set(delta.x, 0, 0);
          else if (m.axis === 'z') delta.set(0, 0, delta.z);
        }
      }
      if (!delta) return;
      obj.position.copy(m.startPos).add(delta);
      obj.updateMatrixWorld(true);
    } else {
      const angle = -dx * 0.01;
      const axis = AXES[m.axis ?? 'y'];
      obj.quaternion.copy(m.startQuat);
      obj.updateMatrixWorld(true);
      obj.rotateOnWorldAxis(axis, angle);
      obj.updateMatrixWorld(true);
    }
    // G/R은 돌을 통째로 옮기고 돌릴 뿐 자세(관절)는 건드리지 않는다. 바닥 아래로만 안 내려가게 한다
    if (!('camera' in m.target)) this.engine.enforceFloor(m.target.rig);
  }

  private endModal(): void {
    const m = this.modal;
    if (!m) return;
    window.removeEventListener('pointermove', this.onModalMove);
    window.removeEventListener('keydown', this.onModalKey, true);
    this.modal = null;
    if (this.engine.orbit) this.engine.orbit.enabled = true;
    this.el.style.cursor = '';
    this.engine.callbacks.hint('');
  }

  confirmModal(): void {
    const m = this.modal;
    if (!m) return;
    const target = m.target;
    this.endModal();
    if ('camera' in target) this.engine.commitCamera();
    else this.engine.commitDoll(target.rig.id);
  }

  cancelModal(): void {
    const m = this.modal;
    if (!m) return;
    const obj = this.modalObject();
    obj.position.copy(m.startPos);
    obj.quaternion.copy(m.startQuat);
    obj.updateMatrixWorld(true);
    this.endModal();
  }

  // ---------- 호버 ----------

  private clearHoverState(): void {
    const h = this.hover;
    if (!h) return;
    if (h.kind === 'ik') h.rig.setEffectorState(h.effector, 'normal');
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
    }
    const hint = this.engine.callbacks.hint;
    const isRoot = (q: { rig: DollRig; bone: string }) => q.bone === q.rig.skel.order[0];
    switch (p?.kind) {
      case 'ik':
        this.el.style.cursor = 'grab';
        hint(`${boneLabel(IK_CHAINS[p.effector].end)} IK 핸들 · 끌면 팔·다리가 따라옵니다`);
        return;
      case 'joint':
        this.el.style.cursor = isRoot(p) ? 'move' : 'grab';
        hint(isRoot(p) ? '골반 · 끌면 발을 바닥에 둔 채 몸통이 움직입니다(아래로 끌면 앉음) · 회전은 R' : `${boneLabel(p.bone)} 관절 · 끌면 관절이 커서를 따라갑니다 · E: 회전 링`);
        return;
      case 'camera':
        this.el.style.cursor = 'move';
        hint('원고 카메라 · 끌어서 이동 · G: 이동 · R: 회전 · W/E: 기즈모');
        return;
      case 'part':
        this.el.style.cursor = isRoot(p) ? 'move' : 'grab';
        hint(isRoot(p) ? '골반 · 끌면 발을 바닥에 둔 채 몸통이 움직입니다(아래로 끌면 앉음) · 회전은 R' : `${boneLabel(p.bone)} · 드래그: 관절 회전 · Alt+드래그: 비틀기 · G: 돌 이동 · R: 돌 회전`);
        return;
      default:
        this.el.style.cursor = '';
        hint('');
    }
  }
}
