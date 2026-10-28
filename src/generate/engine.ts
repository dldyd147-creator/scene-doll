import type { GenEngineKind, GenQuality, Settings } from '../state/settings';
import { SERVICE_LABEL, availableOnWeb, normalizeApiList, selectedApi, type ApiEntry } from './apiList';
import type { SceneDollNative } from '../native';

/**
 * 5단계 이미지 생성 엔진 인터페이스.
 * 입력: 컷 묶음을 합성한 돌 격자 PNG(+ 선화·마스크 격자 선택, 캐릭터 레퍼런스) + 프롬프트 → 출력: 후보 이미지(격자 한 장씩).
 * 구현은 둘: MockEngine(네트워크 없음, 파이프라인 확인용) / RemoteEngine(사용자가 배포한 서버리스 함수에 POST).
 * 화면과 데이터는 이 인터페이스만 알아 나중에 다른 엔진을 붙여도 그대로다.
 */

export type GenImageRole = 'grid' | 'line' | 'mask' | 'reference';

export interface GenInputImage {
  /** 함수에 보내는 파일 이름. 프롬프트의 '첨부 n' 설명과 맞춘다 */
  name: string;
  blob: Blob;
  role: GenImageRole;
}

export interface GenRequest {
  prompt: string;
  /** 첨부 순서대로. 첫 장이 돌 격자 */
  images: GenInputImage[];
  /** 'auto' 또는 'WIDTHxHEIGHT' */
  size: string;
  /** 후보 장수(n) */
  n: number;
  quality: GenQuality;
  /** 입력 충실도. 함수가 모델이 지원할 때만 전달한다(gpt-image-1.5) */
  inputFidelity?: 'high' | 'low';
  signal?: AbortSignal;
}

/** OpenAI Images API usage(토큰 과금 모델). 그대로 보관하고 표시만 한다 */
export interface GenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  [k: string]: unknown;
}

export interface GenResult {
  images: Blob[];
  model?: string;
  usage?: GenUsage;
  /** BFL 직접: 이번 요청의 비용(크레딧, 1크레딧=0.01달러) */
  costCredits?: number;
}

/** usage → '토큰 입력 1,234(이미지 1,000) · 출력 6,240'. 숫자가 없으면 null */
export function formatCost(credits: number | undefined): string | null {
  return credits === undefined ? null : `${credits.toFixed(credits % 1 ? 1 : 0)}크레딧(약 $${(credits / 100).toFixed(2)})`;
}

export function formatUsage(usage: GenUsage | undefined): string | null {
  if (!usage) return null;
  if (typeof usage.cost_credits === 'number') return formatCost(usage.cost_credits);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : null);
  const parts: string[] = [];
  const input = n(usage.input_tokens);
  if (input) {
    const img = n(usage.input_tokens_details?.image_tokens);
    parts.push(`입력 ${input}${img ? `(이미지 ${img})` : ''}`);
  }
  const output = n(usage.output_tokens);
  if (output) parts.push(`출력 ${output}`);
  if (!parts.length) {
    const total = n(usage.total_tokens);
    if (!total) return null;
    parts.push(`합계 ${total}`);
  }
  return `토큰 ${parts.join(' · ')}`;
}

/** refused: 생성 거부(모더레이션) · auth: 접근 토큰 · request: 요청 형식 · network · server · cancelled · config: 설정 부족 */
export type GenErrorKind = 'refused' | 'auth' | 'request' | 'network' | 'server' | 'cancelled' | 'config';

export class GenError extends Error {
  constructor(
    public readonly kind: GenErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GenError';
  }
}

export const GEN_ERROR_LABEL: Record<GenErrorKind, string> = {
  refused: '생성 거부',
  auth: '인증 실패',
  request: '요청 오류',
  network: '네트워크 오류',
  server: '서버 오류',
  cancelled: '취소됨',
  config: '설정 필요',
};

export interface GenEngine {
  readonly kind: GenEngineKind;
  readonly label: string;
  generate(req: GenRequest): Promise<GenResult>;
}

export function parseSize(size: string): { width: number; height: number } | null {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(size.trim());
  return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : null;
}

export function base64ToBlob(b64: string, mime = 'image/png'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new GenError('server', 'PNG 변환 실패'))), 'image/png'));
}

/**
 * 모의 엔진: 돌 격자 위에 반투명 색과 'MOCK' 글자를 얹어 돌려준다. 네트워크 없이 묶음 → 분할 → 저장 → 후보 선택 흐름을 확인하는 용도.
 * 프롬프트에 MOCK_REFUSE가 있으면 생성 거부를 흉내낸다(실패 경로 확인용).
 */
export class MockEngine implements GenEngine {
  readonly kind = 'mock' as const;
  readonly label = '모의 엔진';

  constructor(private readonly delayMs = 250) {}

  async generate(req: GenRequest): Promise<GenResult> {
    if (req.signal?.aborted) throw new GenError('cancelled', '취소됨');
    if (/MOCK_REFUSE/.test(req.prompt)) throw new GenError('refused', '모의 엔진: 프롬프트에 MOCK_REFUSE가 있어 생성 거부를 흉내냈습니다');
    const grid = req.images.find((i) => i.role === 'grid') ?? req.images[0];
    if (!grid) throw new GenError('request', '입력 이미지가 없습니다');
    const bmp = await createImageBitmap(grid.blob);
    try {
      const target = parseSize(req.size) ?? { width: bmp.width, height: bmp.height };
      const out: Blob[] = [];
      for (let k = 0; k < Math.max(1, req.n); k++) {
        await delay(this.delayMs, req.signal);
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = `hsla(${(k * 97 + 20) % 360}, 80%, 55%, 0.28)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(-Math.PI / 8);
        ctx.font = `bold ${Math.round(Math.min(canvas.width, canvas.height) / 6)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText('MOCK', 0, 0);
        ctx.font = `bold ${Math.round(Math.min(canvas.width, canvas.height) / 14)}px sans-serif`;
        ctx.fillText(`후보 ${k + 1} · ${req.quality}`, 0, Math.round(Math.min(canvas.width, canvas.height) / 7));
        ctx.restore();
        out.push(await canvasToBlob(canvas));
      }
      return { images: out, model: 'mock' };
    } finally {
      bmp.close();
    }
  }
}

interface UpstreamError {
  message?: string;
  code?: string;
  type?: string;
}

/** HTTP 오류 응답을 엔진 오류로 분류한다(OpenAI 응답을 함수가 그대로 넘긴 형태를 기준) */
export function classifyHttpError(status: number, body: unknown, text: string): GenError {
  const err = (body as { error?: UpstreamError } | null)?.error;
  const code = err?.code ?? '';
  const message = err?.message ?? (text ? text.slice(0, 300) : `HTTP ${status}`);
  if (code === 'moderation_blocked' || code === 'content_policy_violation' || /moderation|safety system|content policy/i.test(message)) return new GenError('refused', `생성 거부: ${message}`);
  if (status === 401 || status === 403) return new GenError('auth', `접근 토큰이 맞지 않거나 함수가 거부했습니다 (${status}): ${message}`);
  if (status === 413) return new GenError('request', `요청이 너무 큽니다(함수 본문 제한): ${message}`);
  if (status >= 500) return new GenError('server', `함수 또는 이미지 API 오류 (${status}): ${message}`);
  return new GenError('request', `요청 오류 (${status}): ${message}`);
}

/**
 * 원격 엔진: 설정의 엔드포인트(사용자가 배포한 서버리스 함수)에 multipart/form-data로 POST.
 * 필드: prompt · size · n · quality · (input_fidelity) · image[] (첨부 순서대로). 응답은 OpenAI Images API 응답 JSON 그대로(data[].b64_json).
 * OpenAI API 키는 함수의 환경 변수에만 있고 브라우저에는 함수 접근 토큰만 둔다.
 */
export class RemoteEngine implements GenEngine {
  readonly kind = 'remote' as const;
  readonly label = '원격(서버리스 함수)';

  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly provider: { name: 'openai' | 'venice'; model: string } = { name: 'openai', model: '' },
  ) {}

  async generate(req: GenRequest): Promise<GenResult> {
    const endpoint = this.endpoint.trim();
    if (!endpoint) throw new GenError('config', '설정 > 이미지 생성에 서버리스 함수 주소(엔드포인트)를 넣으세요');
    if (!/^https?:\/\//.test(endpoint)) throw new GenError('config', `엔드포인트는 http(s):// 주소여야 합니다: ${endpoint}`);
    if (!req.images.length) throw new GenError('request', '입력 이미지가 없습니다');
    const form = new FormData();
    form.set('prompt', req.prompt);
    form.set('size', req.size);
    form.set('n', String(Math.max(1, Math.round(req.n))));
    form.set('quality', req.quality);
    if (req.inputFidelity) form.set('input_fidelity', req.inputFidelity);
    if (this.provider.name === 'venice') {
      form.set('provider', 'venice');
      if (this.provider.model.trim()) form.set('model', this.provider.model.trim());
    }
    for (const img of req.images) form.append('image[]', img.blob, img.name);
    const headers: Record<string, string> = {};
    if (this.token.trim()) headers.Authorization = `Bearer ${this.token.trim()}`;
    let res: Response;
    try {
      res = await this.fetchFn(endpoint, { method: 'POST', headers, body: form, signal: req.signal });
    } catch (e) {
      if (req.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) throw new GenError('cancelled', '취소됨');
      throw new GenError('network', `함수에 연결하지 못했습니다(주소·CORS 확인): ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) throw classifyHttpError(res.status, body, text);
    const data = (body as { data?: Array<{ b64_json?: string }> } | null)?.data;
    if (!Array.isArray(data) || !data.length) throw new GenError('server', '응답에 이미지가 없습니다');
    const fmt = (body as { output_format?: string }).output_format;
    const mime = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
    const images: Blob[] = [];
    for (const d of data) if (d.b64_json) images.push(base64ToBlob(d.b64_json, mime));
    if (!images.length) throw new GenError('server', '응답 이미지가 base64(b64_json)가 아닙니다');
    return { images, model: (body as { model?: string }).model, usage: (body as { usage?: GenUsage }).usage };
  }
}

/** 데스크톱: 메인 프로세스가 API 목록 항목의 서비스를 직접 부른다(키는 메인 프로세스의 암호화 저장소) */
export class NativeEngine implements GenEngine {
  readonly kind = 'remote' as const;

  constructor(
    private readonly entry: ApiEntry,
    private readonly nativeApi: SceneDollNative,
  ) {}

  get label(): string {
    return `${SERVICE_LABEL[this.entry.service]} · ${this.entry.label}`;
  }

  async generate(req: GenRequest): Promise<GenResult> {
    if (!req.images.length) throw new GenError('request', '입력 이미지가 없습니다');
    if (req.signal?.aborted) throw new GenError('cancelled', '취소됨');
    const requestId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const images = await Promise.all(req.images.map(async (i) => ({ name: i.name, data: await i.blob.arrayBuffer(), mime: i.blob.type || 'image/png' })));
    const onAbort = () => void this.nativeApi.generate.cancel(requestId);
    req.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.nativeApi.generate.run({ requestId, apiId: this.entry.id, service: this.entry.service, model: this.entry.model, baseUrl: this.entry.baseUrl, prompt: req.prompt, images, size: req.size, n: req.n, quality: req.quality, inputFidelity: req.inputFidelity });
      if (!res.ok) throw new GenError(res.kind as GenErrorKind, res.message);
      const usage: GenUsage | undefined = res.usage || res.costCredits !== undefined ? { ...(res.usage ?? {}), ...(res.costCredits !== undefined ? { cost_credits: res.costCredits } : {}) } : undefined;
      return { images: res.images.map((b) => new Blob([b], { type: res.mime })), model: res.model, usage, costCredits: res.costCredits };
    } finally {
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** 이 환경에서 쓸 수 없는 항목(웹에서 BFL 직접 등) */
class UnavailableEngine implements GenEngine {
  readonly kind = 'remote' as const;
  constructor(
    readonly label: string,
    private readonly why: string,
  ) {}
  async generate(): Promise<GenResult> {
    throw new GenError('config', this.why);
  }
}

type EngineSettings = Pick<Settings, 'genEngine' | 'genEndpoint' | 'genToken'> & Partial<Pick<Settings, 'genProvider' | 'genVeniceModel' | 'genApiId' | 'genApis'>>;

/** 현재 선택한 API 목록 항목 (옛 설정만 있으면 그에 맞춰 고른다) */
export function currentApi(settings: EngineSettings): ApiEntry {
  const list = normalizeApiList(settings.genApis);
  if (settings.genApiId) return selectedApi(list, settings.genApiId);
  if (settings.genEngine === 'mock') return selectedApi(list, 'mock');
  return selectedApi(list, settings.genProvider === 'venice' ? 'venice-flux3' : 'openai-default');
}

/** 설정에서 고른 엔진. 데스크톱이면 직접 호출, 웹이면 Worker(함수) 경유 */
export function engineFor(settings: EngineSettings, nativeApi: SceneDollNative | null = typeof window !== 'undefined' ? (window.sceneDollNative ?? null) : null): GenEngine {
  const entry = currentApi(settings);
  if (entry.service === 'mock') return new MockEngine();
  if (nativeApi) return new NativeEngine(entry, nativeApi);
  if (!availableOnWeb(entry.service)) return new UnavailableEngine(`${SERVICE_LABEL[entry.service]} · ${entry.label}`, `${SERVICE_LABEL[entry.service]} 항목은 설치형 프로그램(데스크톱)에서만 쓸 수 있습니다. 웹에서는 베니스·OpenAI(함수 경유)·모의만 됩니다`);
  return new RemoteEngine(settings.genEndpoint, settings.genToken, undefined, { name: entry.service === 'venice' ? 'venice' : 'openai', model: entry.service === 'venice' ? entry.model : '' });
}
