import { GenError } from '../engine';

/** 서비스 어댑터 공통 형식. 데스크톱 메인 프로세스(Node)와 시험에서 쓴다. 키는 호출 인자로만 받고 어디에도 남기지 않는다 */
export interface ProviderImage {
  name: string;
  data: Uint8Array;
  mime: string;
}

export interface ProviderRequest {
  prompt: string;
  images: ProviderImage[];
  /** 'auto' 또는 'WIDTHxHEIGHT' */
  size: string;
  n: number;
  quality: string;
  inputFidelity?: 'high' | 'low';
  model: string;
  /** custom(OpenAI 호환) 기준 주소 */
  baseUrl?: string;
  apiKey: string;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  /** 폴링 대기(시험에서 0으로) */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ProviderResult {
  images: Uint8Array[];
  mime: string;
  model: string;
  usage?: Record<string, unknown>;
  /** BFL 응답의 비용(크레딧, 1크레딧=0.01달러) 합계 */
  costCredits?: number;
}

export function parseWxH(size: string): { w: number; h: number } | null {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(size.trim());
  return m ? { w: parseInt(m[1], 10), h: parseInt(m[2], 10) } : null;
}

/** WxH와 가장 가까운 화면비 문자열(로그 비율 거리). auto/해석 불가면 null */
export function nearestRatio(size: string, ratios: ReadonlyArray<readonly [string, number]>): string | null {
  const d = parseWxH(size);
  if (!d) return null;
  const r = d.w / d.h;
  return ratios.reduce((best, cur) => (Math.abs(Math.log(cur[1] / r)) < Math.abs(Math.log(best[1] / r)) ? cur : best))[0];
}

export const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GenError('cancelled', '취소됨'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new GenError('cancelled', '취소됨'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function blobOf(img: ProviderImage): Blob {
  return new Blob([img.data as BlobPart], { type: img.mime || 'image/png' });
}

/** fetch 실패(네트워크·취소)를 GenError로 */
export function networkError(e: unknown, signal: AbortSignal | undefined, where: string): GenError {
  if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return new GenError('cancelled', '취소됨');
  return new GenError('network', `${where}에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
}

/** 응답 본문에서 사람이 읽을 오류 문구 추출 */
export function errorMessage(text: string, status: number): string {
  let msg = text.slice(0, 400);
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string }; message?: string; detail?: unknown };
    const detail = Array.isArray(j.detail) ? (j.detail as Array<{ msg?: string }>).map((d) => d.msg).filter(Boolean).join('; ') : typeof j.detail === 'string' ? j.detail : '';
    msg = (typeof j.error === 'string' ? j.error : j.error?.message) || j.message || detail || msg;
  } catch {
    /* JSON 아님 */
  }
  return msg || `HTTP ${status}`;
}

/** 공통 상태 코드 분류 */
export function statusError(status: number, message: string, service: string): GenError {
  if (status === 401 || status === 403) return new GenError('auth', `${service} API 키가 맞지 않거나 권한이 없습니다 (${status}): ${message}`);
  if (status === 402) return new GenError('request', `${service} 잔액·크레딧이 부족합니다 (402): ${message}`);
  if (status === 429) return new GenError('server', `${service} 요청이 너무 많습니다(429). 잠시 뒤 다시 시도하세요: ${message}`);
  if (status >= 500) return new GenError('server', `${service} 서버 오류 (${status}): ${message}`);
  return new GenError('request', `${service} 요청 오류 (${status}): ${message}`);
}
