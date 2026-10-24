import { Color, DataTexture, Matrix4, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RGBAFormat, UnsignedByteType, Vector2, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';

/** 헬퍼(격자·핸들·기즈모) 전용 레이어. 원고뷰 카메라는 이 레이어를 보지 않는다 */
export const LAYER_HELPERS = 1;

function gradientTexture(steps: number[]): DataTexture {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((s, i) => {
    const v = Math.round(Math.min(1, Math.max(0, s)) * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const tex = new DataTexture(data, steps.length, 1, RGBAFormat, UnsignedByteType);
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** 2단 셀 명암: 그늘 0.55, 빛 1.0 */
export const TOON_TWO_STEP = gradientTexture([0.55, 1.0]);
/** 명암 끄기: 한 단계(평면색) */
export const TOON_FLAT = gradientTexture([1.0]);

/** 명암이 1.0 톤에서 원색이 되도록 하는 직사광 세기(람베르트 1/π 보정) */
export const KEY_LIGHT_INTENSITY = Math.PI;

/**
 * 십자선 셰이더 공용 유니폼(돌 하나가 공유).
 * 십자선은 표면 위에 '칠해진다': 바인드 자세 좌표(vRest)를 보고 얼굴 중심선(x=0)·눈높이선(y=eyeY)·몸통 정중선을 프래그먼트에서 그린다.
 * 선 두께는 fwidth로 화면 픽셀 단위로 일정하게 유지된다.
 */
export interface LineUniforms {
  uLineOn: IUniform<number>;
  uLinePx: IUniform<number>;
  uHeadZ: IUniform<number>;
  uHeadHalfW: IUniform<number>;
  uEyeY: IUniform<number>;
  uTorsoY: IUniform<Vector2>;
}

export interface LineParams {
  /** 머리 중심 z(돌 공간 휴식). 이보다 앞(z가 큰 쪽)에만 얼굴선을 그린다 */
  headZ: number;
  headHalfW: number;
  eyeY: number;
  /** 눈높이에서 얼굴 앞면 z(돌 공간 휴식). 시점(POV) 카메라 위치에 쓴다 */
  eyeZ: number;
  /** 몸통 정중선 세로 범위 [아래, 위] */
  torsoY: [number, number];
}

export function createLineUniforms(p: LineParams): LineUniforms {
  return {
    uLineOn: { value: 1 },
    uLinePx: { value: 2.5 },
    uHeadZ: { value: p.headZ },
    uHeadHalfW: { value: p.headHalfW },
    uEyeY: { value: p.eyeY },
    uTorsoY: { value: new Vector2(p.torsoY[0], p.torsoY[1]) },
  };
}

const VERT_DECL = `
attribute vec2 aRegion;
varying vec2 vRegion;
varying vec3 vRest;
uniform mat4 uRestMatrix;
`;
const VERT_BODY = `
#include <begin_vertex>
vRest = (uRestMatrix * vec4(position, 1.0)).xyz;
vRegion = aRegion;
`;
const FRAG_DECL = `
varying vec2 vRegion;
varying vec3 vRest;
uniform float uLineOn;
uniform float uLinePx;
uniform float uHeadZ;
uniform float uHeadHalfW;
uniform float uEyeY;
uniform vec2 uTorsoY;
`;
const FRAG_BODY = `
if (uLineOn > 0.5) {
  vec3 p = vRest;
  float headM = smoothstep(0.3, 0.6, vRegion.x) * step(uHeadZ, p.z);
  float torsoM = smoothstep(0.3, 0.6, vRegion.y) * step(0.0, p.z) * step(uTorsoY.x, p.y) * step(p.y, uTorsoY.y);
  float fx = max(fwidth(p.x), 1e-6);
  float fy = max(fwidth(p.y), 1e-6);
  float hw = 0.5 * uLinePx;
  float center = 1.0 - smoothstep(hw * fx, (hw + 1.0) * fx, abs(p.x));
  float eye = (1.0 - smoothstep(hw * fy, (hw + 1.0) * fy, abs(p.y - uEyeY))) * step(abs(p.x), uHeadHalfW * 0.82);
  float m = max(center * max(headM, torsoM), eye * headM);
  outgoingLight = mix(outgoingLight, vec3(0.06), clamp(m, 0.0, 1.0));
}
#include <opaque_fragment>
`;

function attachLineShader(m: MeshToonMaterial, shared: LineUniforms, restMatrix: Matrix4): void {
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, shared);
    shader.uniforms.uRestMatrix = { value: restMatrix };
    shader.vertexShader = shader.vertexShader.replace('void main() {', `${VERT_DECL}\nvoid main() {`).replace('#include <begin_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${FRAG_DECL}\nvoid main() {`).replace('#include <opaque_fragment>', FRAG_BODY);
  };
  m.customProgramCacheKey = () => 'doll-crosshair';
}

export interface DollMaterialSet {
  base: MeshToonMaterial;
  hi: MeshToonMaterial;
}

/** 돌 재질 한 쌍(기본·강조). restMatrix: 정점을 돌 공간 휴식 좌표로 옮기는 행렬(GLB는 단위행렬, 마네킹 부위는 뼈 휴식 행렬) */
export function createDollMaterials(hex: string, shading: boolean, shared: LineUniforms, restMatrix = new Matrix4()): DollMaterialSet {
  const base = new MeshToonMaterial({ color: new Color(hex), gradientMap: shading ? TOON_TWO_STEP : TOON_FLAT });
  const hi = new MeshToonMaterial({ color: new Color(hex), gradientMap: shading ? TOON_TWO_STEP : TOON_FLAT });
  hi.emissive = new Color('#ffffff');
  hi.emissiveIntensity = 0.28;
  attachLineShader(base, shared, restMatrix);
  attachLineShader(hi, shared, restMatrix);
  return { base, hi };
}

export const HANDLE_COLOR = '#ffffff';
export const HANDLE_DIM_COLOR = '#c9ccd3';
export const HANDLE_HOVER_COLOR = '#ffe08a';
export const HANDLE_ACTIVE_COLOR = '#ffb020';
export const JOINT_COLOR = '#f4f5f7';
export const SELECTED_JOINT_COLOR = '#ffb020';

export function handleMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(HANDLE_COLOR), depthTest: false, depthWrite: false, transparent: true, opacity: 0.92 });
}
