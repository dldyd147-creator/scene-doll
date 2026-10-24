import type { CameraState, Character, Cut, DollAsset, Episode, Gender, LightState, ReferenceImage, RefSlot, Work } from './types';
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

/** 내장 돌 목록. 2세대 MakeHuman(CC0, 트위스트 뼈) 남·여가 기본, 코드 마네킹은 가벼운 테스트용. 1세대는 옛 데이터 호환용으로 숨김 */
export const DOLL_ASSETS: DollAsset[] = [
  { id: 'mh2_m', name: '남', gender: 'male', bodyType: 'basic', baseHeightCm: 175, glbPath: 'dolls/mh2_male.glb', boneMap: {} },
  { id: 'mh2_f', name: '여', gender: 'female', bodyType: 'basic', baseHeightCm: 162, glbPath: 'dolls/mh2_female.glb', boneMap: {} },
  { id: 'mannequin_m', name: '캡슐 남', gender: 'male', bodyType: 'basic', baseHeightCm: 175, glbPath: null, boneMap: {} },
  { id: 'mannequin_f', name: '캡슐 여', gender: 'female', bodyType: 'basic', baseHeightCm: 162, glbPath: null, boneMap: {} },
  { id: 'mh_m', name: '남(1세대)', gender: 'male', bodyType: 'basic', baseHeightCm: 175, glbPath: 'dolls/mh_male.glb', boneMap: {}, hidden: true },
  { id: 'mh_f', name: '여(1세대)', gender: 'female', bodyType: 'basic', baseHeightCm: 162, glbPath: 'dolls/mh_female.glb', boneMap: {}, hidden: true },
];

export function dollAsset(id: string): DollAsset {
  return DOLL_ASSETS.find((d) => d.id === id) ?? DOLL_ASSETS[0];
}

export function defaultDollFor(gender: Gender): DollAsset {
  return DOLL_ASSETS.find((d) => d.gender === gender) ?? DOLL_ASSETS[0];
}

/** 레퍼런스 기본 슬롯 8종(순서대로 보여 준다) */
export const REF_SLOTS: Array<{ id: RefSlot; label: string; group: '얼굴' | '전신' }> = [
  { id: 'face_front', label: '얼굴 정면', group: '얼굴' },
  { id: 'face_side', label: '얼굴 측면', group: '얼굴' },
  { id: 'face_quarter', label: '얼굴 반측면', group: '얼굴' },
  { id: 'face_quarter2', label: '얼굴 반측면 2', group: '얼굴' },
  { id: 'face_back', label: '얼굴 후면', group: '얼굴' },
  { id: 'body_front', label: '전신 전면', group: '전신' },
  { id: 'body_side', label: '전신 측면', group: '전신' },
  { id: 'body_back', label: '전신 후면', group: '전신' },
];

/** 사용자 지정 레퍼런스(복장·무기 등) 최대 장수 */
export const MAX_CUSTOM_REFS = 10;

export function refLabel(r: ReferenceImage): string {
  if (r.slot) return REF_SLOTS.find((s) => s.id === r.slot)?.label ?? r.slot;
  return r.name.trim() || '추가 자료';
}

/** 대표 레퍼런스(지정이 없으면 첫 장) */
export function mainReferenceOf(chr: Character): ReferenceImage | null {
  return chr.references.find((r) => r.id === chr.mainReference) ?? chr.references[0] ?? null;
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
    dialogue: [],
    scriptNote: '',
    updatedAt: nowIso(),
  };
}

/** 등록 캐릭터 새로 만들기. 돌은 성별 기본 돌, 키는 그 돌의 기준 키 */
export function createCharacter(workCode: string, name: string, gender: Gender | 'other', color: string): Character {
  const doll = defaultDollFor(gender === 'female' ? 'female' : 'male');
  const t = nowIso();
  return {
    id: newId('chr'),
    workCode,
    name,
    color,
    info: { gender },
    description: '',
    appearanceTags: [],
    heightCm: doll.baseHeightCm,
    dollId: doll.id,
    references: [],
    temporary: false,
    createdAt: t,
    updatedAt: t,
  };
}

export function createTemporaryCharacter(workCode: string, dollId: string, heightCm: number, color: string, index: number): Character {
  const asset = dollAsset(dollId);
  const t = nowIso();
  return {
    id: newId('chr'),
    workCode,
    name: `임시${index}`,
    color,
    info: { gender: asset.gender },
    description: '',
    appearanceTags: [],
    heightCm,
    dollId: asset.id,
    references: [],
    temporary: true,
    createdAt: t,
    updatedAt: t,
  };
}

/** 저장소에서 읽은 캐릭터를 현재 구조로 맞춘다(1단계 데이터에는 설명·레퍼런스 필드가 없다) */
export function normalizeCharacter(raw: Partial<Character>): Character {
  const t = nowIso();
  const gender = raw.info?.gender ?? 'male';
  const doll = defaultDollFor(gender === 'female' ? 'female' : 'male');
  return {
    id: raw.id ?? newId('chr'),
    workCode: raw.workCode ?? 'TMP',
    name: raw.name ?? '이름 없음',
    color: raw.color ?? CHARACTER_COLORS[0].hex,
    info: { ...raw.info, gender },
    description: raw.description ?? '',
    appearanceTags: Array.isArray(raw.appearanceTags) ? raw.appearanceTags : [],
    heightCm: raw.heightCm ?? doll.baseHeightCm,
    dollId: raw.dollId ?? doll.id,
    references: Array.isArray(raw.references) ? raw.references : [],
    mainReference: raw.mainReference,
    temporary: !!raw.temporary,
    createdAt: raw.createdAt ?? t,
    updatedAt: raw.updatedAt ?? t,
  };
}
