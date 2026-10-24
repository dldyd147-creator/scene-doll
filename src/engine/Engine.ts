import {
  Box3,
  Color,
  DirectionalLight,
  Euler,
  GridHelper,
  MathUtils,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Cut } from '../model/types';
import { dollAsset } from '../model/defaults';
import type { Selection, ToolMode } from '../state/store';
import { DEFAULT_SETTINGS, type Settings } from '../state/settings';
import { DollRig } from './DollRig';
import { ManuscriptCamera } from './ManuscriptCamera';
import { KEY_LIGHT_INTENSITY, LAYER_HELPERS } from './materials';
import { IK_CHAINS } from './skeleton';
import { solveTwoBone } from './ik';
import { Interaction } from './Interaction';
import { fromVec3, roundTo, rotateObjectWorld } from './three-utils';

export interface EngineCallbacks {
  /** 현재 컷을 바꾸고 되돌리기 기록을 남긴다(스토어로 위임) */
  commit: (mutate: (cut: Cut) => void) => void;
  select: (sel: Selection) => void;
  hint: (text: string) => void;
}

export type ViewKind = 'work' | 'manuscript';

const WORK_BG = new Color('#1b1c21');
const MANU_BG = new Color('#ffffff');
const _v = new Vector3();
const _q = new Quaternion();

/**
 * 3D 엔진. 캔버스 하나로 조작뷰·원고뷰 두 영역을 가위(scissor) 렌더링한다.
 * 스토어의 컷을 받아 씬에 반영하고(applyCut), 조작 결과는 commit 콜백으로 스토어에 돌려준다.
 */
export class Engine {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly workCamera = new PerspectiveCamera(45, 1, 0.03, 300);
  readonly manu = new ManuscriptCamera();
  readonly keyLight = new DirectionalLight('#ffffff', KEY_LIGHT_INTENSITY);
  readonly grid: GridHelper;
  readonly dolls = new Map<string, DollRig>();
  /** IK 기즈모용 대리 객체(손·발 위치) */
  readonly ikProxy = new Object3D();
  orbit: OrbitControls | null = null;
  gizmo: TransformControls | null = null;
  interaction: Interaction | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS };
  selection: Selection = { dollId: null, bone: null };
  mode: ToolMode = 'direct';
  cut: Cut | null = null;

  private views: Record<ViewKind, HTMLElement | null> = { work: null, manuscript: null };
  private dollKeys = new Map<string, string>();
  private raf = 0;
  private savedWorkView: { position: Vector3; target: Vector3; fov: number } | null = null;
  private gizmoTarget: 'bone' | 'root' | 'ik' | null = null;
  private disposed = false;

  constructor(readonly callbacks: EngineCallbacks) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl-canvas';
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.workCamera.position.set(2.4, 1.75, 3.2);
    this.workCamera.layers.enable(LAYER_HELPERS);

    this.grid = new GridHelper(20, 40, new Color('#3b3d46'), new Color('#2a2c33'));
    this.grid.layers.set(LAYER_HELPERS);
    this.scene.add(this.grid);

    this.keyLight.position.set(5, 8, 6);
    this.scene.add(this.keyLight);
    this.scene.add(this.manu.camera);
    this.scene.add(this.ikProxy);
  }

  // ---------- 생명주기 ----------

  mount(): void {
    document.body.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.interaction?.dispose();
    this.gizmo?.dispose();
    this.orbit?.dispose();
    for (const rig of this.dolls.values()) rig.dispose();
    this.dolls.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private resize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  setViewElement(kind: ViewKind, el: HTMLElement | null): void {
    this.views[kind] = el;
  }

  /** 조작뷰 표면 요소: 시점 조작·기즈모·포인터 상호작용을 여기에 묶는다 */
  setWorkSurface(el: HTMLElement | null): void {
    this.interaction?.dispose();
    this.interaction = null;
    if (this.gizmo) {
      this.gizmo.getHelper().removeFromParent();
      this.gizmo.dispose();
      this.gizmo = null;
    }
    this.orbit?.dispose();
    this.orbit = null;
    if (!el) return;

    const orbit = new OrbitControls(this.workCamera, el);
    orbit.enableDamping = false;
    orbit.zoomToCursor = true;
    orbit.screenSpacePanning = true;
    orbit.minDistance = 0.15;
    orbit.maxDistance = 80;
    orbit.target.set(0, 0.95, 0);
    orbit.update();
    this.orbit = orbit;

    const gizmo = new TransformControls(this.workCamera, el);
    gizmo.getHelper().traverse((o) => o.layers.set(LAYER_HELPERS));
    this.scene.add(gizmo.getHelper());
    gizmo.addEventListener('dragging-changed', (e) => {
      orbit.enabled = !e.value;
      if (!e.value) this.onGizmoEnd();
    });
    gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.gizmo = gizmo;

    this.interaction = new Interaction(this, el);
    this.applySettings(this.settings);
    this.updateGizmo();
  }

  // ---------- 렌더 루프 ----------

  private frame = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    for (const rig of this.dolls.values()) rig.updateHelpers();
    this.updateFrustumDistance();
    this.render();
  };

  private render(): void {
    const r = this.renderer;
    r.setScissorTest(false);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.setScissorTest(true);
    this.renderView(this.views.work, this.workCamera, WORK_BG, true);
    this.renderView(this.views.manuscript, this.manu.camera, MANU_BG, false);
  }

  private renderView(el: HTMLElement | null, camera: PerspectiveCamera, bg: Color, fitAspect: boolean): void {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const left = Math.round(rect.left);
    const bottom = Math.round(window.innerHeight - rect.bottom);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const r = this.renderer;
    r.setViewport(left, bottom, w, h);
    r.setScissor(left, bottom, w, h);
    r.setClearColor(bg, 1);
    r.clear();
    if (fitAspect) {
      const aspect = w / h;
      if (Math.abs(camera.aspect - aspect) > 1e-4) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    }
    r.render(this.scene, camera);
  }

  private updateFrustumDistance(): void {
    if (!this.dolls.size) {
      this.manu.setFrustumDistance(this.manu.camera.position.length());
      return;
    }
    _v.set(0, 0, 0);
    for (const rig of this.dolls.values()) _v.add(rig.root.position);
    _v.divideScalar(this.dolls.size);
    _v.y += 0.9;
    this.manu.setFrustumDistance(this.manu.camera.position.distanceTo(_v));
  }

  // ---------- 스토어 → 씬 ----------

  applyCut(cut: Cut): void {
    this.cut = cut;
    const seen = new Set<string>();
    for (const inst of cut.dolls) {
      seen.add(inst.id);
      let rig = this.dolls.get(inst.id);
      if (!rig) {
        rig = new DollRig(inst.id, dollAsset(inst.dollId).gender, inst.color, inst.heightCm);
        rig.setHandleRadius(0.022 * this.settings.handleSize);
        this.scene.add(rig.root, rig.helpers);
        this.dolls.set(inst.id, rig);
      }
      const key = JSON.stringify(inst);
      if (this.dollKeys.get(inst.id) !== key) {
        rig.applyInstance(inst);
        this.dollKeys.set(inst.id, key);
      }
      rig.setShading(cut.light.shading);
    }
    for (const [id, rig] of this.dolls) {
      if (!seen.has(id)) {
        if (this.gizmo?.object && (this.gizmo.object === rig.root || rig.skel.bones.has(this.gizmo.object.name))) this.gizmo.detach();
        rig.dispose();
        this.dolls.delete(id);
        this.dollKeys.delete(id);
      }
    }
    this.manu.apply(cut.camera, cut.aspect);
    const d = fromVec3(cut.light.direction).normalize();
    this.keyLight.position.copy(d.multiplyScalar(-10));
    this.refreshSelectionVisuals();
    this.updateGizmo();
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (this.orbit) {
      const o = this.orbit;
      o.rotateSpeed = s.rotateSpeed;
      o.zoomSpeed = s.zoomSpeed;
      o.panSpeed = s.panSpeed;
      o.mouseButtons =
        s.orbitMode === 'designdoll'
          ? { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
          : { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN };
    }
    this.gizmo?.setSize(s.gizmoSize);
    for (const rig of this.dolls.values()) rig.setHandleRadius(0.022 * s.handleSize);
    this.grid.visible = s.showGrid;
    this.manu.setFrustumVisible(s.showFrustum);
  }

  applySelection(sel: Selection): void {
    this.selection = sel;
    this.refreshSelectionVisuals();
    this.updateGizmo();
  }

  applyMode(mode: ToolMode): void {
    this.mode = mode;
    this.updateGizmo();
  }

  private refreshSelectionVisuals(): void {
    for (const rig of this.dolls.values()) {
      const selected = rig.id === this.selection.dollId;
      rig.setSelected(selected);
      rig.setHighlight(selected ? this.selection.bone : null);
    }
  }

  selectedRig(): DollRig | null {
    return this.selection.dollId ? (this.dolls.get(this.selection.dollId) ?? null) : null;
  }

  // ---------- 기즈모 ----------

  private updateGizmo(): void {
    const g = this.gizmo;
    if (!g) return;
    const rig = this.selectedRig();
    const bone = this.selection.bone && rig ? (rig.skel.bones.get(this.selection.bone) ?? null) : null;
    if (this.mode === 'direct' || !rig) {
      g.detach();
      this.gizmoTarget = null;
      g.getHelper().visible = false;
      return;
    }
    g.getHelper().visible = true;
    if (this.mode === 'rotate') {
      g.setMode('rotate');
      if (bone) {
        g.setSpace('local');
        g.attach(bone);
        this.gizmoTarget = 'bone';
      } else {
        g.setSpace('world');
        g.attach(rig.root);
        this.gizmoTarget = 'root';
      }
      return;
    }
    // translate
    g.setMode('translate');
    g.setSpace('world');
    if (bone && IK_CHAINS[bone.name]) {
      rig.worldPos(bone.name, this.ikProxy.position);
      g.attach(this.ikProxy);
      this.gizmoTarget = 'ik';
    } else {
      g.attach(rig.root);
      this.gizmoTarget = 'root';
    }
  }

  private onGizmoChange(): void {
    if (this.gizmoTarget === 'ik') {
      const rig = this.selectedRig();
      if (rig && this.selection.bone) this.solveIk(rig, this.selection.bone, this.ikProxy.position);
    }
  }

  private onGizmoEnd(): void {
    const rig = this.selectedRig();
    if (!rig) return;
    this.commitDoll(rig.id);
    if (this.gizmoTarget === 'ik' && this.selection.bone) rig.worldPos(this.selection.bone, this.ikProxy.position);
  }

  // ---------- IK ----------

  /** 끝점(손·발)을 월드 좌표 target으로 보내도록 팔·다리를 푼다. 어깨 연동 포함 */
  solveIk(rig: DollRig, effector: string, target: Vector3): void {
    const chain = IK_CHAINS[effector];
    if (!chain) return;
    const upper = rig.skel.bones.get(chain.upper)!;
    const lower = rig.skel.bones.get(chain.lower)!;
    const end = rig.skel.bones.get(chain.end)!;
    rig.root.updateMatrixWorld(true);

    if (this.settings.shoulderLink && chain.clavicle && this.settings.shoulderLinkRatio > 0) {
      const clav = rig.skel.bones.get(chain.clavicle)!;
      const s = rig.worldPos(chain.clavicle);
      const c = rig.worldPos(chain.end);
      const from = c.sub(s);
      const to = target.clone().sub(s);
      if (from.lengthSq() > 1e-8 && to.lengthSq() > 1e-8) {
        const full = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
        const partial = new Quaternion().slerp(full, this.settings.shoulderLinkRatio);
        rotateObjectWorld(clav, partial);
        // 쇄골은 휴식 자세에서 35° 넘게 벗어나지 않게
        clav.getWorldQuaternion(_q);
        const dollQ = rig.root.quaternion.clone().invert().multiply(_q);
        const rel = dollQ.multiply(rig.skel.rest.get(chain.clavicle)!.quat.clone().invert());
        const angle = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
        if (angle > MathUtils.degToRad(35)) rotateObjectWorld(clav, partial.invert());
      }
    }

    const a = rig.worldPos(chain.upper);
    const b = rig.worldPos(chain.lower);
    const c = rig.worldPos(chain.end);
    const pole = fromVec3(chain.pole).applyQuaternion(rig.root.quaternion);
    const res = solveTwoBone({ a, b, c, target, poleHint: pole });
    rotateObjectWorld(upper, res.upper);
    rotateObjectWorld(lower, res.lower);
    end.updateWorldMatrix(true, false);
  }

  // ---------- 씬 → 스토어 ----------

  commitDoll(id: string): void {
    const rig = this.dolls.get(id);
    const cut = this.cut;
    if (!rig || !cut) return;
    const base = cut.dolls.find((d) => d.id === id);
    if (!base) return;
    const inst = rig.toInstance(base);
    this.dollKeys.set(id, JSON.stringify(inst));
    this.callbacks.commit((c) => {
      const i = c.dolls.findIndex((d) => d.id === id);
      if (i >= 0) c.dolls[i] = inst;
    });
  }

  // ---------- 돌 명령 ----------

  mirrorSelected(): void {
    const rig = this.selectedRig();
    if (!rig) return;
    rig.mirror();
    this.commitDoll(rig.id);
  }

  resetSelectedJoint(recursive: boolean): void {
    const rig = this.selectedRig();
    if (!rig) return;
    if (this.selection.bone) rig.resetJoint(this.selection.bone, recursive);
    else rig.resetAll();
    this.commitDoll(rig.id);
  }

  resetAllJoints(): void {
    const rig = this.selectedRig();
    if (!rig) return;
    rig.resetAll();
    this.commitDoll(rig.id);
  }

  snapSelectedToGround(): void {
    const rig = this.selectedRig();
    if (!rig) return;
    rig.snapToGround();
    this.commitDoll(rig.id);
  }

  // ---------- 시점 ----------

  private frameBox(box: Box3): void {
    if (!this.orbit || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const dist = (sphere.radius / Math.sin(MathUtils.degToRad(this.workCamera.fov) / 2)) * 1.1;
    const dir = this.workCamera.position.clone().sub(this.orbit.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.4, 1).normalize();
    this.orbit.target.copy(sphere.center);
    this.workCamera.position.copy(sphere.center).add(dir.multiplyScalar(Math.max(0.5, dist)));
    this.orbit.update();
  }

  /** 전체 보기(Shift+Z): 모든 돌이 들어오는 객관 뷰 */
  fitAll(): void {
    const box = new Box3();
    for (const rig of this.dolls.values()) box.union(rig.worldBounds());
    if (box.isEmpty()) box.set(new Vector3(-0.6, 0, -0.6), new Vector3(0.6, 1.9, 0.6));
    this.frameBox(box);
  }

  /** 선택한 돌로 시점 맞춤(F) */
  focusSelected(): void {
    const rig = this.selectedRig();
    if (!rig) {
      this.fitAll();
      return;
    }
    if (this.selection.bone) {
      const p = rig.worldPos(this.selection.bone);
      const r = 0.35 * rig.root.scale.x;
      this.frameBox(new Box3(p.clone().subScalar(r), p.clone().addScalar(r)));
    } else {
      this.frameBox(rig.worldBounds());
    }
  }

  /** Tab: 조작뷰 시점 ↔ 원고 카메라 시점 전환 */
  toggleViewWithManuscript(): void {
    if (!this.orbit) return;
    if (this.savedWorkView) {
      this.workCamera.position.copy(this.savedWorkView.position);
      this.orbit.target.copy(this.savedWorkView.target);
      this.workCamera.fov = this.savedWorkView.fov;
      this.workCamera.updateProjectionMatrix();
      this.savedWorkView = null;
      this.orbit.update();
      return;
    }
    this.savedWorkView = { position: this.workCamera.position.clone(), target: this.orbit.target.clone(), fov: this.workCamera.fov };
    this.moveWorkViewToManuscript();
  }

  /** 조작뷰 시점을 원고 카메라 자리로 옮긴다(화각까지) */
  moveWorkViewToManuscript(): void {
    if (!this.orbit) return;
    const cam = this.manu.camera;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const dist = Math.max(0.3, this.workCamera.position.distanceTo(this.orbit.target));
    this.workCamera.position.copy(cam.position);
    this.orbit.target.copy(cam.position).add(fwd.multiplyScalar(dist));
    this.workCamera.fov = cam.fov;
    this.workCamera.updateProjectionMatrix();
    this.orbit.update();
  }

  /** 조작뷰 시점을 원고 카메라로 복사(컷 데이터 변경) */
  copyWorkViewToManuscript(): void {
    const e = new Euler().setFromQuaternion(this.workCamera.quaternion, 'YXZ');
    const p = this.workCamera.position;
    this.callbacks.commit((cut) => {
      cut.camera = {
        ...cut.camera,
        position: [roundTo(p.x, 4), roundTo(p.y, 4), roundTo(p.z, 4)],
        yaw: roundTo(MathUtils.radToDeg(e.y), 2),
        pitch: roundTo(MathUtils.radToDeg(e.x), 2),
        roll: roundTo(MathUtils.radToDeg(e.z), 2),
      };
    });
  }

  /** 원고 카메라를 수치로 바꿀 때(카메라 패널) 즉시 반영용 */
  previewCamera(partial: Partial<Cut['camera']>, aspect?: number): void {
    if (!this.cut) return;
    this.manu.apply({ ...this.cut.camera, ...partial }, aspect ?? this.cut.aspect);
  }
}
