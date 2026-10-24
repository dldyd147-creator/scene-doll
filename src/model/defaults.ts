import type { CameraState, Character, Cut, DollAsset, Episode, Gender, LightState, Work } from './types';
import { newId } from './ids';

export const nowIso = (): string => new Date().toISOString();

/** 캐릭터 구분색 팔레트. 설명 텍스트에 쓰는 한글 이름과 함께 둔다 */
export const CHARACTER_COLORS: Array<{ hex: string; name: string }> = [
  { hex: '#F5C518', name: '노랑' },
  { hex: '#2F6FEB', name: '파랑' },
  { hex: '#E5393B', name: '빨강' },
  { hex: '#2FB457', name: '초록' },
  { hex: '#F2862A', name: '주황' },
  { hex: '#8E5BE8', name: '보라' },
  { hex: '#1FB5B5', name: '청록' },
  { hex: '#E8609C', name: '분홍' },
  { hex: '#9C6B3C', name: '갈색' },
  { hex: '#9BCB2D', name: '연두' },
  { hex: '#3C4AA8', name: '남색' },
  { hex: '#8A8F98', name: '회색' },
];

export function colorName(hex: string): string {
  const found = CHARACTER_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
  return found ? found.name : hex;
}

/** 아직 쓰지 않은 색을 고른다. 모두 썼으면 순환 */
export function pickColor(used: string[]): string {
  const lower = used.map((u) => u.toLowerCase());
  const free = CHARACTER_COLORS.find((c) => !lower.includes(c.hex.toLowerCase()));
  return (free ?? CHARACTER_COLORS[used.length % CHARACTER_COLORS.length]).hex;
}

/** 내장 돌 목록. 코드 마네킹 남·여 + MakeHuman(CC0) 남·여 */
export const DOLL_ASSETS: DollAsset[] = [
  { id: 'mannequin_m', name: '마네킹 남', gender: 'male', bodyType: 'basic', baseHeightCm: 175, glbPath: null, boneMap: {} },
  { id: 'mannequin_f', name: '마네킹 여', gender: 'female', bodyType: 'basic', baseHeightCm: 162, glbPath: null, boneMap: {} },
  { id: 'mh_m', name: 'MakeHuman 남', gender: 'male', bodyType: 'basic', baseHeightCm: 175, glbPath: 'dolls/mh_male.glb', boneMap: {} },
  { id: 'mh_f', name: 'MakeHuman 여', gender: 'female', bodyType: 'basic', baseHeightCm: 162, glbPath: 'dolls/mh_female.glb', boneMap: {} },
];

export function dollAsset(id: string): DollAsset {
  return DOLL_ASSETS.find((d) => d.id === id) ?? DOLL_ASSETS[0];
}

export function defaultDollFor(gender: Gender): DollAsset {
  return DOLL_ASSETS.find((d) => d.gender === gender) ?? DOLL_ASSETS[0];
}

export function createWork(code = 'TMP', name = '임시 작품'): Work {
  const t = nowIso();
  return { code, name, output: { width: 1024, background: 'white', crosshair: true, shading: true }, createdAt: t, updatedAt: t };
}

export function createEpisode(workCode: string, number = 1): Episode {
  return { workCode, number, cutOrder: [1], updatedAt: nowIso() };
}

/** 기본 원고 카메라: 아이레벨 1.5m, 피사체에서 3.5m 앞(+Z), 50mm */
export function createCamera(): CameraState {
  return { position: [0, 1.5, 3.5], yaw: 0, pitch: 0, roll: 0, focalLength: 50 };
}

export function createLight(): LightState {
  // 왼쪽 위 앞에서 비추는 빛(카메라 쪽에서 피사체로)
  return { direction: [-0.5, -0.8, -0.6], shading: true };
}

export function createCut(number: number): Cut {
  return {
    number,
    aspect: 1.5,
    camera: createCamera(),
    light: createLight(),
    dolls: [],
    props: [],
    confirmed: false,
    outline: true,
    crosshair: true,
    groupTags: [],
    desc: '',
    memo: '',
    generatedImages: [],
    updatedAt: nowIso(),
  };
}

export function createTemporaryCharacter(workCode: string, dollId: string, heightCm: number, color: string, index: number): Character {
  const asset = dollAsset(dollId);
  return {
    id: newId('chr'),
    workCode,
    name: `임시${index}`,
    color,
    info: { gender: asset.gender },
    appearanceTags: [],
    heightCm,
    dollId: asset.id,
    referenceImages: [],
    temporary: true,
  };
}
