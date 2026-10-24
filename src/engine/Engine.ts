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
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { CameraState, Cut, DollAsset } from '../model/types';
import { dollAsset } from '../model/defaults';
import type { Selection, ToolMode } from '../state/store';
import { DEFAULT_SETTINGS, type Settings } from '../state/settings';
import type { DollRig } from './DollRig';
import { createDollRig, loadDollTemplate } from './dollTemplates';
import { ManuscriptCamera } from './ManuscriptCamera';
import { cameraForward, lookAtAngles, ManuscriptControls } from './ManuscriptControls';
import { KEY_LIGHT_INTENSITY, LAYER_HELPERS } from './materials';
import { setLineResolution } from './overlays';
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

export interface OffscreenOptions {
  background: 'white' | 'transparent' | 'dark';
  helpers?: boolean;
}

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
  manuControls: ManuscriptControls | null = null;
  settings: Settings = { ...DEFAULT_SETTINGS };
  selection: Selection = { dollId: null, bone: null };
  mode: ToolMode = 'direct';
  cut: Cut | null = null;

  private views: Record<ViewKind, HTMLElement | null> = { work: null, manuscript: null };
  private dollKeys = new Map<string, string>();
  private loadingTemplates = new Set<string>();
  private raf = 0;
  private savedWorkView: { position: Vector3; target: Vector3; fov: number } | null = null;
  private gizmoTarget: 'bone' | 'root' | 'ik' | 'camera' | null = null;
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
    this.disposed = false;
    if (!this.canvas.isConnected) document.body.appendChild(this.canvas);
    this.resize();
    window.addEventListener('resize', this.resize);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** 화면에서 떼어낸다. 다시 mount()할 수 있다(개발 중 핫 리로드 대비) */
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.setWorkSurface(null);
    this.setManuscriptSurface(null);
    for (const rig of this.dolls.values()) rig.dispose();
    this.dolls.clear();
    this.dollKeys.clear();
    this.loadingTemplates.clear();
    this.cut = null;
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
      if (e.value) this.onGizmoStart();
      else this.onGizmoEnd();
    });
    gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.gizmo = gizmo;

    this.interaction = new Interaction(this, el);
    this.applySettings(this.settings);
    this.updateGizmo();
  }

  /** 원고뷰 표면 요소: 원고 카메라 조작(궤도·팬·달리)을 묶는다 */
  setManuscriptSurface(el: HTMLElement | null): void {
    this.manuControls?.dispose();
    this.manuControls = null;
    if (el) this.manuControls = new ManuscriptControls(this, el);
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
    r.setRenderTarget(null);
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
    setLineResolution(w, h);
    r.render(this.scene, camera);
  }

  /**
   * 오프스크린 렌더(썸네일·일괄 출력). 원고 카메라 화각 그대로, 헬퍼 없이 그린다.
   * 결과는 2D 캔버스(위아래 뒤집기 완료).
   */
  renderToCanvas(camera: PerspectiveCamera, width: number, height: number, opts: OffscreenOptions): HTMLCanvasElement {
    const r = this.renderer;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const rt = new WebGLRenderTarget(w, h, { colorSpace: SRGBColorSpace, samples: 4 });
    const prevMask = camera.layers.mask;
    if (!opts.helpers) camera.layers.set(0);
    const prevAspect = camera.aspect;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const rig of this.dolls.values()) rig.updateHelpers();
    r.setRenderTarget(rt);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    if (opts.background === 'transparent') r.setClearColor(0x000000, 0);
    else r.setClearColor(opts.background === 'white' ? MANU_BG : WORK_BG, 1);
    r.clear();
    setLineResolution(w, h);
    r.render(this.scene, camera);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    r.setRenderTarget(null);
    rt.dispose();
    camera.layers.mask = prevMask;
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const row = w * 4;
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  private updateFrustumDistance(): void {
    const c = this.subjectCenter();
    this.manu.setFrustumDistance(Math.max(0.5, c.sub(this.manu.camera.position).dot(cameraForward(this.cut?.camera ?? { position: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, focalLength: 50 }))));
  }

  /** 피사체 중심: 돌들의 중심(없으면 원점 가슴 높이) */
  subjectCenter(): Vector3 {
    if (!this.dolls.size) return new Vector3(0, 0.9, 0);
    const c = new Vector3();
    for (const rig of this.dolls.values()) {
      _v.copy(rig.root.position);
      _v.y += 0.9 * (rig.heightCm / 175);
      c.add(_v);
    }
    return c.divideScalar(this.dolls.size);
  }

  // ---------- 스토어 → 씬 ----------

  applyCut(cut: Cut): void {
    this.cut = cut;
    const seen = new Set<string>();
    for (const inst of cut.dolls) {
      seen.add(inst.id);
      let rig = this.dolls.get(inst.id);
      if (!rig) {
        const asset = dollAsset(inst.dollId);
        const created = createDollRig(inst.id, asset, inst.color, inst.heightCm);
        if (!created) {
          // GLB 템플릿을 아직 안 불러왔다: 불러온 뒤 다시 반영
          this.ensureTemplate(asset);
          continue;
        }
        rig = created;
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
      rig.setOutline(cut.outline);
      rig.setCrosshair(cut.crosshair);
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

  private ensureTemplate(asset: DollAsset): void {
    if (this.loadingTemplates.has(asset.id)) return;
    this.loadingTemplates.add(asset.id);
    loadDollTemplate(asset)
      .then(() => {
        this.loadingTemplates.delete(asset.id);
        if (!this.disposed && this.cut) this.applyCut(this.cut);
      })
      .catch((e: unknown) => {
        this.loadingTemplates.delete(asset.id);
        this.callbacks.hint(`돌을 불러오지 못했습니다: ${asset.name} (${e instanceof Error ? e.message : String(e)})`);
      });
  }

  /** 모든 GLB 템플릿이 준비될 때까지 기다린다(일괄 출력 전) */
  async ensureTemplatesFor(cuts: Cut[]): Promise<void> {
    const ids = new Set<string>();
    for (const c of cuts) for (const d of c.dolls) ids.add(d.dollId);
    for (const id of ids) {
      const asset = dollAsset(id);
      if (asset.glbPath) await loadDollTemplate(asset);
    }
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
    // 관절 링이 돌을 다 덮지 않도록 기본은 three.js 기본 크기의 60%
    this.gizmo?.setSize(0.6 * s.gizmoSize);
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
    this.manu.setSelected(!!this.selection.camera);
  }

  selectedRig(): DollRig | null {
    return this.selection.dollId ? (this.dolls.get(this.selection.dollId) ?? null) : null;
  }

  // ---------- 기즈모 ----------

  private updateGizmo(): void {
    const g = this.gizmo;
    if (!g) return;
    if (this.mode === 'direct') {
      g.detach();
      this.gizmoTarget = null;
      g.getHelper().visible = false;
      return;
    }
    if (this.selection.camera) {
      g.getHelper().visible = true;
      g.setMode(this.mode);
      g.setSpace(this.mode === 'rotate' ? 'local' : 'world');
      g.attach(this.manu.camera);
      this.gizmoTarget = 'camera';
      return;
    }
    const rig = this.selectedRig();
    const bone = this.selection.bone && rig ? (rig.skel.bones.get(this.selection.bone) ?? null) : null;
    if (!rig) {
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

  private plantedFeet: Map<string, Vector3> | null = null;

  private onGizmoStart(): void {
    const rig = this.selectedRig();
    if (rig && this.gizmoTarget === 'root' && this.settings.plantFeet) {
      this.plantedFeet = new Map();
      for (const eff of ['LeftFoot', 'RightFoot']) if (rig.skel.bones.has(eff)) this.plantedFeet.set(eff, rig.worldPos(eff));
    } else {
      this.plantedFeet = null;
    }
  }

  private onGizmoChange(): void {
    const rig = this.selectedRig();
    if (this.gizmoTarget === 'ik') {
      if (rig && this.selection.bone) this.solveIk(rig, this.selection.bone, this.ikProxy.position);
    } else if (this.gizmoTarget === 'root' && rig && this.plantedFeet) {
      rig.root.updateMatrixWorld(true);
      for (const [eff, pos] of this.plantedFeet) this.solveIk(rig, eff, pos, { shoulder: false });
    } else if (this.gizmoTarget === 'camera') {
      this.manu.camera.updateMatrixWorld(true);
    }
  }

  private onGizmoEnd(): void {
    this.plantedFeet = null;
    if (this.gizmoTarget === 'camera') {
      this.commitCamera();
      return;
    }
    const rig = this.selectedRig();
    if (!rig) return;
    this.commitDoll(rig.id);
    if (this.gizmoTarget === 'ik' && this.selection.bone) rig.worldPos(this.selection.bone, this.ikProxy.position);
  }

  // ---------- IK ----------

  /** 끝점(손·발)을 월드 좌표 target으로 보내도록 팔·다리를 푼다. 어깨 연동 포함 */
  solveIk(rig: DollRig, effector: string, target: Vector3, opts: { shoulder?: boolean; keepEndOrientation?: boolean } = {}): void {
    const chain = IK_CHAINS[effector];
    if (!chain) return;
    const upper = rig.skel.bones.get(chain.upper);
    const lower = rig.skel.bones.get(chain.lower);
    const end = rig.skel.bones.get(chain.end);
    if (!upper || !lower || !end) return;
    rig.root.updateMatrixWorld(true);
    const endWorldQ = new Quaternion();
    if (opts.keepEndOrientation ?? this.settings.lockEndOrientation) end.getWorldQuaternion(endWorldQ);

    const useShoulder = opts.shoulder ?? this.settings.shoulderLink;
    if (useShoulder && chain.clavicle && this.settings.shoulderLinkRatio > 0) {
      const clav = rig.skel.bones.get(chain.clavicle);
      if (clav) {
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
    }

    const a = rig.worldPos(chain.upper);
    const b = rig.worldPos(chain.lower);
    const c = rig.worldPos(chain.end);
    const pole = fromVec3(chain.pole).applyQuaternion(rig.root.quaternion);
    const res = solveTwoBone({ a, b, c, target, poleHint: pole });
    rotateObjectWorld(upper, res.upper);
    rotateObjectWorld(lower, res.lower);
    end.updateWorldMatrix(true, false);
    if (opts.keepEndOrientation ?? this.settings.lockEndOrientation) {
      end.getWorldQuaternion(_q);
      rotateObjectWorld(end, endWorldQ.multiply(_q.invert()));
    }
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

  /** three.js 카메라의 현재 상태를 컷에 기록한다(기즈모·아이콘 드래그 뒤) */
  commitCamera(): void {
    if (!this.cut) return;
    this.commitCameraState(this.manu.read(this.cut.camera.focalLength));
  }

  commitCameraState(state: CameraState): void {
    this.callbacks.commit((c) => {
      c.camera = { ...state, position: [...state.position] as [number, number, number] };
    });
  }

  /** 원고 카메라를 수치로 바꿀 때(카메라 패널·드래그 중) 즉시 반영용. 컷 데이터는 바꾸지 않는다 */
  previewCamera(partial: Partial<CameraState>, aspect?: number): void {
    if (!this.cut) return;
    this.manu.apply({ ...this.cut.camera, ...partial }, aspect ?? this.cut.aspect);
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

  // ---------- 조작뷰 시점 ----------

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

  private allBounds(): Box3 {
    const box = new Box3();
    for (const rig of this.dolls.values()) box.union(rig.worldBounds());
    if (box.isEmpty()) box.set(new Vector3(-0.6, 0, -0.6), new Vector3(0.6, 1.9, 0.6));
    return box;
  }

  /** 전체 보기(Shift+Z): 모든 돌이 들어오는 객관 뷰 */
  fitAll(): void {
    this.frameBox(this.allBounds());
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

  // ---------- 원고 카메라 명령 ----------

  /** 아이레벨·하이·로우 프리셋: 높이를 바꾸고 피사체를 바라본다 */
  cameraPreset(kind: 'eye' | 'high' | 'low'): void {
    if (!this.cut) return;
    const subject = this.subjectCenter();
    const cam = this.cut.camera;
    const scale = Math.max(0.6, subject.y / 0.9);
    const height = kind === 'eye' ? 1.5 * scale : kind === 'high' ? 2.9 * scale : 0.45 * scale;
    const pos = new Vector3(cam.position[0], height, cam.position[2]);
    const horiz = Math.hypot(pos.x - subject.x, pos.z - subject.z);
    if (horiz < 0.5) pos.z = subject.z + 3;
    const aim = subject.clone();
    if (kind === 'eye') aim.y = height; // 수평 유지
    const { yaw, pitch } = lookAtAngles(pos, aim);
    this.commitCameraState({ ...cam, position: [roundTo(pos.x, 4), roundTo(pos.y, 4), roundTo(pos.z, 4)], yaw, pitch, roll: 0 });
  }

  /** 원고 프레임에 맞춤: 시선 방향은 두고 거리만 바꿔 대상이 세로로 들어오게 */
  fitManuscript(target: 'all' | 'selected'): void {
    if (!this.cut) return;
    const rig = this.selectedRig();
    const box = target === 'selected' && rig ? rig.worldBounds() : this.allBounds();
    const sphere = box.getBoundingSphere(new Sphere());
    const cam = this.cut.camera;
    const fwd = cameraForward(cam);
    const vfov = MathUtils.degToRad(this.manu.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.manu.camera.aspect);
    const dist = (sphere.radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.05;
    const pos = sphere.center.clone().sub(fwd.multiplyScalar(dist));
    this.commitCameraState({ ...cam, position: [roundTo(pos.x, 4), roundTo(pos.y, 4), roundTo(pos.z, 4)] });
  }

  /** 카메라가 피사체 중심을 바라보게(위치 유지) */
  aimManuscriptAtSubject(): void {
    if (!this.cut) return;
    const rig = this.selectedRig();
    const center = rig ? rig.worldBounds().getCenter(new Vector3()) : this.subjectCenter();
    const pos = new Vector3(...this.cut.camera.position);
    const { yaw, pitch } = lookAtAngles(pos, center);
    this.commitCameraState({ ...this.cut.camera, yaw, pitch });
  }
}
