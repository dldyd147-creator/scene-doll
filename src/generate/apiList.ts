/**
 * 설정의 'API 목록'. 항목 하나 = 서비스 종류 + 표시 이름 + 모델 id. 키는 여기 없다(데스크톱은 메인 프로세스의 암호화 저장소).
 * 순수 로직(기본 목록·선택·키 필요 판정)만 둬서 시험한다.
 */
export type ApiService = 'venice' | 'bfl' | 'openai' | 'custom' | 'mock';

export interface ApiEntry {
  id: string;
  service: ApiService;
  label: string;
  /** 모델 id. mock은 비움 */
  model: string;
  /** custom(OpenAI 호환) 전용: 기준 주소. 예: https://example.com/v1 */
  baseUrl?: string;
  /** 기본 항목은 지울 수 없다 */
  builtin?: boolean;
}

export const SERVICE_LABEL: Record<ApiService, string> = {
  venice: '베니스',
  bfl: 'BFL 직접',
  openai: 'OpenAI',
  custom: '사용자 정의',
  mock: '모의',
};

/** 서비스별 한 번에 첨부할 수 있는 이미지 상한(격자 + 선화 + 마스크 + 레퍼런스) */
export const SERVICE_MAX_IMAGES: Record<ApiService, number> = { venice: 3, bfl: 10, openai: 16, custom: 16, mock: 99 };

export const DEFAULT_API_ID = 'venice-flux3';

export const DEFAULT_API_LIST: ApiEntry[] = [
  { id: 'venice-flux3', service: 'venice', label: '베니스 · Flux 3', model: 'flux-3-image-edit', builtin: true },
  { id: 'bfl-flux3', service: 'bfl', label: 'BFL 직접 · Flux 3', model: 'flux-3-image', builtin: true },
  { id: 'openai-default', service: 'openai', label: 'OpenAI · gpt-image-2.5', model: 'gpt-image-2.5-sunburst', builtin: true },
  { id: 'mock', service: 'mock', label: '모의 엔진(흐름 확인용)', model: '', builtin: true },
];

/** 웹 배포판에서도 쓸 수 있는 서비스(Worker 경유). BFL 직접·사용자 정의는 데스크톱 전용 */
export function availableOnWeb(service: ApiService): boolean {
  return service === 'openai' || service === 'venice' || service === 'mock';
}

export function needsKey(entry: ApiEntry): boolean {
  return entry.service !== 'mock';
}

export function maxImagesFor(entry: ApiEntry): number {
  return SERVICE_MAX_IMAGES[entry.service];
}

/** 저장된 목록을 읽을 때: 형식이 틀린 항목을 버리고 기본 항목이 항상 있게 한다 */
export function normalizeApiList(raw: unknown): ApiEntry[] {
  const out: ApiEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const r of raw as Array<Partial<ApiEntry>>) {
      if (!r || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue;
      if (!r.service || !(r.service in SERVICE_LABEL)) continue;
      seen.add(r.id);
      out.push({ id: r.id, service: r.service, label: String(r.label ?? r.id), model: String(r.model ?? ''), baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : undefined, builtin: !!r.builtin && DEFAULT_API_LIST.some((d) => d.id === r.id) });
    }
  }
  const merged: ApiEntry[] = [];
  for (const d of DEFAULT_API_LIST) {
    const saved = out.find((o) => o.id === d.id);
    // 기본 항목의 서비스는 고정, 모델·이름은 사용자가 바꾼 값을 존중한다
    merged.push(saved ? { ...d, label: saved.label || d.label, model: d.service === 'mock' ? '' : saved.model || d.model } : d);
  }
  for (const o of out) if (!DEFAULT_API_LIST.some((d) => d.id === o.id)) merged.push({ ...o, builtin: false });
  return merged;
}

/** 현재 항목 찾기. id가 없으면 기본 항목 */
export function selectedApi(list: ApiEntry[], id: string): ApiEntry {
  return list.find((e) => e.id === id) ?? list.find((e) => e.id === DEFAULT_API_ID) ?? list[0];
}

export function newCustomEntry(list: ApiEntry[], label: string, model: string, baseUrl: string): ApiEntry {
  let n = 1;
  while (list.some((e) => e.id === `custom-${n}`)) n++;
  return { id: `custom-${n}`, service: 'custom', label: label.trim() || `사용자 정의 ${n}`, model: model.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, '') };
}

export function removeEntry(list: ApiEntry[], id: string): ApiEntry[] {
  return list.filter((e) => !(e.id === id && !e.builtin));
}

export type KeyState = 'not-needed' | 'set' | 'missing';

/** keyIds: 키가 저장된 항목 id들 */
export function keyState(entry: ApiEntry, keyIds: ReadonlySet<string>): KeyState {
  if (!needsKey(entry)) return 'not-needed';
  return keyIds.has(entry.id) ? 'set' : 'missing';
}

export const KEY_STATE_LABEL: Record<KeyState, string> = { 'not-needed': '키 필요 없음', set: '설정됨', missing: '키 필요' };
