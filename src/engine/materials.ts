import { Color, DataTexture, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';

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

export function dollMaterial(hex: string, shading: boolean): MeshToonMaterial {
  return new MeshToonMaterial({ color: new Color(hex), gradientMap: shading ? TOON_TWO_STEP : TOON_FLAT });
}

export function dollHighlightMaterial(hex: string, shading: boolean): MeshToonMaterial {
  const m = dollMaterial(hex, shading);
  m.emissive = new Color('#ffffff');
  m.emissiveIntensity = 0.28;
  return m;
}

export const HANDLE_COLOR = '#c8c8cc';
export const HANDLE_HOVER_COLOR = '#ffffff';
export const HANDLE_ACTIVE_COLOR = '#ffb020';

export function handleMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(HANDLE_COLOR), depthTest: false, depthWrite: false, transparent: true, opacity: 0.92 });
}
