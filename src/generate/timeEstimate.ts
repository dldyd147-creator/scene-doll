/**
 * 이미지 생성 예상 시간. 묶음은 차례로 보내고(묶음 안 후보는 나란히), 묶음 하나가 걸린 시간을 API 항목별로 기억해
 * 다음 예상에 쓴다. 기록이 없으면 서비스별 대략값을 쓰고 '대략'이라고 밝힌다. 순수 계산만 두고 저장은 얇게 감싼다.
 */
import type { ApiEntry, ApiService } from './apiList';

/** 기록이 없을 때 묶음 하나(보내기→결과)에 걸리는 대략 초. 실측이 아니라 추정이라 첫 생성 뒤에는 기록으로 바뀐다 */
export const DEFAULT_BATCH_SECONDS: Record<ApiService, number> = { venice: 40, bfl: 40, openai: 60, custom: 60, mock: 2 };

/** API 항목 id → 최근 묶음 소요 초(오래된 것부터) */
export type TimeHistory = Record<string, number[]>;

const KEEP = 10;

export interface PerBatch {
  seconds: number;
  basis: 'history' | 'default';
  samples: number;
}

export function recordDuration(h: TimeHistory, apiId: string, seconds: number): TimeHistory {
  if (!Number.isFinite(seconds) || seconds <= 0) return h;
  return { ...h, [apiId]: [...(h[apiId] ?? []), Math.round(seconds * 10) / 10].slice(-KEEP) };
}

/** 묶음 하나의 예상 초: 기록이 있으면 중앙값(가끔 느린 한 번에 휘둘리지 않게), 없으면 서비스 기본값 */
export function perBatchSeconds(h: TimeHistory, api: ApiEntry): PerBatch {
  const list = (h[api.id] ?? []).filter((x) => x > 0);
  if (!list.length) return { seconds: DEFAULT_BATCH_SECONDS[api.service], basis: 'default', samples: 0 };
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return { seconds: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, basis: 'history', samples: list.length };
}

/** 보내기 전 전체 예상(초) */
export function estimateTotal(per: PerBatch, batchCount: number): number {
  return per.seconds * Math.max(0, batchCount);
}

/** 실행 중 남은 예상(초): 끝낸 묶음 수와 지금 묶음에서 지난 시간을 반영 */
export function estimateRemaining(per: PerBatch, batchCount: number, done: number, elapsedInCurrent: number): number {
  const left = Math.max(0, batchCount - done);
  if (!left) return 0;
  return Math.max(per.seconds * 0.1, per.seconds - Math.max(0, elapsedInCurrent)) + per.seconds * (left - 1);
}

/** 사람이 읽는 길이: 45초 · 2분 30초 · 1시간 5분 */
export function formatDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const r = s % 60;
    return r ? `${m}분 ${r}초` : `${m}분`;
  }
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

/** 5초 단위로 어림해서 보여 준다(1분 넘으면 10초 단위). 정확한 척하지 않기 위해 앞에 '약'을 붙인다 */
export function roughDuration(seconds: number): string {
  const step = seconds >= 60 ? 10 : 5;
  return `약 ${formatDuration(Math.max(step, Math.round(seconds / step) * step))}`;
}

const KEY = 'scene-doll.genTimes';

export function loadTimeHistory(): TimeHistory {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as TimeHistory;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveTimeHistory(h: TimeHistory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* 저장 못 해도 예상만 덜 정확해질 뿐 */
  }
}
