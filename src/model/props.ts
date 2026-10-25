// 소품(3단계)의 순수 로직: 기본 도형 프리셋, 만들기·정규화, 쥐기 기본값.
import type { GripTransform, Hand, PropAsset, PropInstance, PropShape, Quat, Vec3 } from './types';
import { newId } from './ids';
import { nowIso } from './defaults';

/** 소품 기본색(캐릭터 구분색과 겹치지 않는 중간 회색) */
export const DEFAULT_PROP_COLOR = '#8a8f98';

/** 소품 색 후보 */
export const PROP_COLORS: Array<{ hex: string; name: string }> = [
  { hex: '#8a8f98', name: '회색' },
  { hex: '#3a3d45', name: '검정' },
  { hex: '#d9d9d9', name: '밝은 회색' },
  { hex: '#b08968', name: '나무색' },
  { hex: '#c0c7d1', name: '은색' },
  { hex: '#d4a017', name: '금색' },
];

export const PROP_SHAPES: Array<{ id: PropShape; label: string; dims: string[] }> = [
  { id: 'box', label: '상자', dims: ['가로', '높이', '깊이'] },
  { id: 'cylinder', label: '원기둥', dims: ['지름', '높이'] },
  { id: 'sphere', label: '구', dims: ['지름'] },
];

/** 등록 폼의 프리셋(검·컵 등). 크기는 m */
export const PROP_PRESETS: Array<{ name: string; shape: PropShape; size: Vec3; tags: string[]; color?: string }> = [
  { name: '검', shape: 'box', size: [0.05, 0.95, 0.012], tags: ['무기'], color: '#c0c7d1' },
  { name: '단검', shape: 'box', size: [0.035, 0.35, 0.01], tags: ['무기'], color: '#c0c7d1' },
  { name: '막대', shape: 'cylinder', size: [0.03, 1.2, 0.03], tags: ['무기', '도구'], color: '#b08968' },
  { name: '컵', shape: 'cylinder', size: [0.08, 0.1, 0.08], tags: ['생활'] },
  { name: '책', shape: 'box', size: [0.15, 0.21, 0.03], tags: ['생활'] },
  { name: '휴대폰', shape: 'box', size: [0.07, 0.15, 0.008], tags: ['생활'], color: '#3a3d45' },
  { name: '공', shape: 'sphere', size: [0.22, 0.22, 0.22], tags: ['생활'] },
  { name: '상자', shape: 'box', size: [0.4, 0.3, 0.3], tags: ['배경'], color: '#b08968' },
];

/** 쥐기 기본값: 손목(손 뼈 원점)에서 손가락 쪽으로 7cm(손바닥), 회전 없음 */
export const DEFAULT_GRIP: GripTransform = { position: [0, 0.07, 0], rotation: [0, 0, 0, 1] };

export function gripFor(asset: PropAsset | undefined, hand: Hand): GripTransform {
  const g = asset?.grip?.[hand];
  return g ? { position: [...g.position] as Vec3, rotation: [...g.rotation] as Quat } : { position: [...DEFAULT_GRIP.position] as Vec3, rotation: [...DEFAULT_GRIP.rotation] as Quat };
}

export interface CreatePropOptions {
  tags?: string[];
  workCode?: string | null;
  color?: string;
  id?: string;
}

export function createPrimitiveProp(name: string, shape: PropShape, size: Vec3, opts: CreatePropOptions = {}): PropAsset {
  return {
    id: opts.id ?? newId('prop'),
    name: name.trim() || PROP_SHAPES.find((s) => s.id === shape)?.label || '소품',
    tags: [...new Set((opts.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    model: { kind: 'primitive', shape, size: normalizeSize(shape, size) },
    grip: {},
    workCode: opts.workCode ?? null,
    color: opts.color ?? DEFAULT_PROP_COLOR,
    createdAt: nowIso(),
  };
}

export function createGlbProp(name: string, path: string, opts: CreatePropOptions = {}): PropAsset {
  return {
    id: opts.id ?? newId('prop'),
    name: name.trim() || '소품',
    tags: [...new Set((opts.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    model: { kind: 'glb', path },
    grip: {},
    workCode: opts.workCode ?? null,
    color: opts.color,
    createdAt: nowIso(),
  };
}

/** 도형별로 쓰는 치수만 남기고 0.5cm~5m로 제한. 원기둥·구는 지름을 x·z에 같이 둔다 */
export function normalizeSize(shape: PropShape, size: Vec3): Vec3 {
  const clamp = (v: number) => Math.min(5, Math.max(0.005, Number.isFinite(v) ? v : 0.1));
  const [x, y, z] = size.map(clamp) as Vec3;
  if (shape === 'sphere') return [x, x, x];
  if (shape === 'cylinder') return [x, y, x];
  return [x, y, z];
}

/** 치수 표시(cm) */
export function sizeLabel(asset: PropAsset): string {
  if (asset.model.kind === 'glb') return 'GLB';
  const cm = (v: number) => `${Math.round(v * 100)}`;
  const [x, y, z] = asset.model.size;
  if (asset.model.shape === 'sphere') return `지름 ${cm(x)}cm`;
  if (asset.model.shape === 'cylinder') return `지름 ${cm(x)} · 높이 ${cm(y)}cm`;
  return `${cm(x)}×${cm(y)}×${cm(z)}cm`;
}

export function shapeLabel(asset: PropAsset): string {
  const m = asset.model;
  if (m.kind === 'glb') return 'GLB';
  return PROP_SHAPES.find((s) => s.id === m.shape)?.label ?? m.shape;
}

export function normalizeProp(raw: Partial<PropAsset>): PropAsset {
  const rawModel = raw.model;
  let model: PropAsset['model'];
  if (rawModel?.kind === 'glb' && rawModel.path) model = { kind: 'glb', path: rawModel.path };
  else {
    const prim = rawModel?.kind === 'primitive' ? rawModel : undefined;
    const shape: PropShape = prim && PROP_SHAPES.some((s) => s.id === prim.shape) ? prim.shape : 'box';
    model = { kind: 'primitive', shape, size: normalizeSize(shape, prim && Array.isArray(prim.size) ? prim.size : [0.1, 0.1, 0.1]) };
  }
  const grip: PropAsset['grip'] = {};
  for (const hand of ['right', 'left'] as const) {
    const g = raw.grip?.[hand];
    if (g && Array.isArray(g.position) && Array.isArray(g.rotation)) grip[hand] = { position: [...g.position] as Vec3, rotation: [...g.rotation] as Quat };
  }
  return {
    id: raw.id ?? newId('prop'),
    name: raw.name?.trim() || '소품',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    model,
    grip,
    workCode: typeof raw.workCode === 'string' ? raw.workCode : null,
    color: raw.color,
    thumbnail: raw.thumbnail,
    createdAt: raw.createdAt,
  };
}

/** 이 작품에서 쓸 수 있는 소품(공용 + 이 작품 소속) */
export function propsForWork(all: PropAsset[], workCode: string): PropAsset[] {
  return all.filter((p) => p.workCode === null || p.workCode === workCode);
}

/** 컷에 놓을 새 소품 인스턴스(자유 배치) */
export function createPropInstance(propId: string, position: Vec3 = [0, 0, 0], rotation: Quat = [0, 0, 0, 1]): PropInstance {
  return { id: newId('pi'), propId, position: [...position] as Vec3, rotation: [...rotation] as Quat };
}

export const HAND_LABEL: Record<Hand, string> = { right: '오른손', left: '왼손' };
export const HAND_BONE: Record<Hand, string> = { right: 'RightHand', left: 'LeftHand' };
