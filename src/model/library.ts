// 씬 라이브러리·포즈 라이브러리의 순수 로직(엔진·저장소와 무관).
// 기획서 '씬 검색기(` 키)'·'씬 태그: 자동 + 상황 버튼'·'데이터 구조'(포즈·씬 라이브러리) 절.

import type { AngleTag, Character, Cut, DollInstance, JointRotations, Pose, Quat, SceneLibraryItem, SceneSlot, ShotSize, Vec3 } from './types';
import type { CutAnalysis } from '../describe/analyze';
import { ANGLE_LABEL, SHOT_LABEL } from '../describe/analyze';
import { createCamera, createTemporaryCharacter, dollAsset, nowIso, pickColor } from './defaults';
import { newId } from './ids';

/** 상황 태그 버튼 초기 목록(기획서 결정 사항). 설정에서 편집한다 */
export const DEFAULT_SITUATION_TAGS = ['대화', '독백', '대치', '전투', '이동', '리액션', '일상', '로맨스', '군중', '설정샷'];

/** 포즈 분류 제안 목록(자유 입력, 자동 완성용) */
export const DEFAULT_POSE_CATEGORIES = ['서기', '앉기', '눕기', '걷기·뛰기', '동작', '전투', '감정', '일반'];

export const SHOT_ORDER: ShotSize[] = ['closeup', 'bust', 'waist', 'full'];
export const ANGLE_ORDER: AngleTag[] = ['high', 'eye', 'low'];

/** 인원 버튼 1·2·3·4+ (0인 씬은 인원 필터를 걸지 않을 때만 보인다) */
export const COUNT_BUCKETS = [1, 2, 3, 4] as const;
export type CountBucket = (typeof COUNT_BUCKETS)[number];

export function countBucket(n: number): number {
  return n <= 0 ? 0 : n >= 4 ? 4 : n;
}

export function countLabel(bucket: number): string {
  return bucket >= 4 ? '4+' : String(bucket);
}

/**
 * 씬 검색기 필터. 샷·앵글·인원은 한 씬에 값이 하나라 같은 묶음 안에서는 '또는'(둘을 누르면 둘 다 보임),
 * 묶음끼리는 '그리고'. 상황 태그는 한 씬에 여럿 붙을 수 있어 누른 태그를 모두 가진 씬만 남긴다(좁히기).
 */
export interface SceneFilter {
  shots: ShotSize[];
  angles: AngleTag[];
  counts: number[];
  situations: string[];
  /** 이름·상황 태그 검색어 */
  query: string;
}

export const EMPTY_FILTER: SceneFilter = { shots: [], angles: [], counts: [], situations: [], query: '' };

export function hasActiveFilter(f: SceneFilter): boolean {
  return f.shots.length > 0 || f.angles.length > 0 || f.counts.length > 0 || f.situations.length > 0 || f.query.trim().length > 0;
}

export function filterScenes(items: SceneLibraryItem[], f: SceneFilter): SceneLibraryItem[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((it) => {
    if (f.shots.length && !f.shots.includes(it.autoTags.shot)) return false;
    if (f.angles.length && !f.angles.includes(it.autoTags.angle)) return false;
    if (f.counts.length && !f.counts.includes(countBucket(it.autoTags.count))) return false;
    if (f.situations.length && !f.situations.every((t) => it.situationTags.includes(t))) return false;
    if (q && !it.name.toLowerCase().includes(q) && !it.situationTags.some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** 자동 태그로 만든 기본 이름. 예: '2인 풀샷 로우앵글' */
export function defaultSceneName(a: SceneLibraryItem['autoTags']): string {
  return `${a.count}인 ${SHOT_LABEL[a.shot]} ${ANGLE_LABEL[a.angle]}`;
}

/** 자동 태그를 사람이 읽는 칩 목록으로 */
export function autoTagChips(a: SceneLibraryItem['autoTags']): string[] {
  const chips = [`${a.count}인`, SHOT_LABEL[a.shot], ANGLE_LABEL[a.angle], `1:${Math.round(a.aspect * 100) / 100}`];
  if (a.placement.length) chips.push(a.placement.join(' / '));
  return chips;
}

export interface SceneFromCutOptions {
  id?: string;
  name?: string;
  situationTags?: string[];
  thumbnail?: string;
  now?: string;
}

/**
 * 현재 컷 + 컷 분석 결과 → 씬 라이브러리 항목.
 * 캐릭터 지정(characterId·고정색)은 지우고 돌 슬롯(돌 ID·키·위치·회전·관절)·소품·카메라·화면비만 남겨 다른 작품에서도 쓴다.
 * 자동 태그는 화면 안 돌만 센다(분석의 dolls는 화면 안 돌).
 */
export function sceneFromCut(cut: Cut, analysis: Pick<CutAnalysis, 'count' | 'shot' | 'angle' | 'dolls'>, opts: SceneFromCutOptions = {}): SceneLibraryItem {
  const id = opts.id ?? newId('scene');
  const autoTags: SceneLibraryItem['autoTags'] = {
    count: analysis.count,
    shot: analysis.shot,
    angle: analysis.angle,
    aspect: Math.round(cut.aspect * 100) / 100,
    placement: analysis.dolls.map((d) => (d.depthZone ? `${d.xZone} ${d.depthZone}` : d.xZone)),
    shots: analysis.dolls.map((d) => d.shot),
  };
  return {
    id,
    name: (opts.name ?? '').trim() || defaultSceneName(autoTags),
    autoTags,
    situationTags: [...new Set((opts.situationTags ?? []).map((t) => t.trim()).filter(Boolean))],
    slots: cut.dolls.map((d, i) => ({
      slot: i + 1,
      dollId: d.dollId,
      heightCm: d.heightCm,
      position: [...d.position] as Vec3,
      rotation: [...d.rotation] as Quat,
      joints: structuredClone(d.joints),
    })),
    props: structuredClone(cut.props),
    camera: { ...cut.camera, position: [...cut.camera.position] as Vec3 },
    aspect: cut.aspect,
    thumbnail: opts.thumbnail ?? '',
    createdAt: opts.now ?? nowIso(),
  };
}

/** 슬롯 번호 → 지정한 캐릭터 ID(null·없음이면 임시 캐릭터) */
export type SlotAssignments = Record<number, string | null | undefined>;

/**
 * 씬 슬롯 → 컷에 놓을 돌.
 * 지정한 캐릭터가 있으면 그 캐릭터의 돌(성별 돌·키·고정색)로, 비운 슬롯은 저장 당시 돌·키로 임시 캐릭터를 새로 만든다.
 * 임시 캐릭터의 색은 지금 쓰는 색과 겹치지 않게 고른다.
 */
export function dollsFromScene(item: SceneLibraryItem, assignments: SlotAssignments, characters: Character[], workCode: string): { dolls: DollInstance[]; newCharacters: Character[] } {
  const used = characters.map((c) => c.color);
  const newCharacters: Character[] = [];
  const dolls: DollInstance[] = [];
  let tempIndex = characters.length + 1;
  for (const slot of item.slots) {
    const chrId = assignments[slot.slot] ?? null;
    const chr = chrId ? characters.find((c) => c.id === chrId) : undefined;
    const base = { id: newId('doll'), position: [...slot.position] as Vec3, rotation: [...slot.rotation] as Quat, joints: structuredClone(slot.joints) };
    if (chr) {
      dolls.push({ ...base, characterId: chr.id, dollId: dollAsset(chr.dollId).id, heightCm: chr.heightCm, color: chr.color });
      continue;
    }
    const asset = dollAsset(slot.dollId);
    const color = pickColor(used);
    used.push(color);
    const temp = createTemporaryCharacter(workCode, asset.id, slot.heightCm ?? asset.baseHeightCm, color, tempIndex++);
    newCharacters.push(temp);
    dolls.push({ ...base, characterId: temp.id, dollId: asset.id, heightCm: temp.heightCm, color });
  }
  return { dolls, newCharacters };
}

/** 저장소에서 읽은 씬을 현재 구조로 맞춘다(필드가 빠진 옛 파일 대비) */
export function normalizeScene(raw: Partial<SceneLibraryItem>): SceneLibraryItem {
  const slotsRaw = Array.isArray(raw.slots) ? raw.slots : [];
  const a: Partial<SceneLibraryItem['autoTags']> = raw.autoTags ?? {};
  const aspect = typeof raw.aspect === 'number' ? raw.aspect : 1.5;
  const autoTags: SceneLibraryItem['autoTags'] = {
    count: typeof a.count === 'number' ? a.count : slotsRaw.length,
    shot: a.shot ?? 'full',
    angle: a.angle ?? 'eye',
    aspect: typeof a.aspect === 'number' ? a.aspect : Math.round(aspect * 100) / 100,
    placement: Array.isArray(a.placement) ? a.placement : [],
    shots: Array.isArray(a.shots) ? a.shots : undefined,
  };
  const slots: SceneSlot[] = slotsRaw.map((s, i) => ({
    slot: typeof s.slot === 'number' ? s.slot : i + 1,
    dollId: s.dollId ?? dollAsset('').id,
    heightCm: s.heightCm,
    position: s.position ?? [0, 0, 0],
    rotation: s.rotation ?? [0, 0, 0, 1],
    joints: s.joints ?? {},
  }));
  return {
    id: raw.id ?? newId('scene'),
    name: raw.name?.trim() || defaultSceneName(autoTags),
    autoTags,
    situationTags: Array.isArray(raw.situationTags) ? raw.situationTags : [],
    slots,
    props: Array.isArray(raw.props) ? raw.props : [],
    camera: raw.camera ?? createCamera(),
    aspect,
    thumbnail: raw.thumbnail ?? '',
    createdAt: raw.createdAt,
  };
}

/** 선택한 돌의 관절값으로 포즈 항목 만들기 */
export function createPose(name: string, category: string, tags: string[], joints: JointRotations, id = newId('pose')): Pose {
  return {
    id,
    name: name.trim() || '이름 없는 포즈',
    category: category.trim() || '일반',
    tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
    joints: structuredClone(joints),
    createdAt: nowIso(),
  };
}

export function normalizePose(raw: Partial<Pose>): Pose {
  return {
    id: raw.id ?? newId('pose'),
    name: raw.name?.trim() || '이름 없는 포즈',
    category: raw.category?.trim() || '일반',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    joints: raw.joints ?? {},
    thumbnail: raw.thumbnail,
    createdAt: raw.createdAt,
  };
}

/** 쉼표·줄바꿈으로 적은 태그 문자열 → 목록 */
export function parseTagList(text: string): string[] {
  return [...new Set(text.split(/[,，\n]/).map((t) => t.trim()).filter(Boolean))];
}
