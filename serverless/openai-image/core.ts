/**
 * 씬 돌 이미지 생성 함수 — 공용 처리기. Cloudflare Worker(worker.ts)와 Vercel 함수(api/openai-image.ts)가 함께 쓴다.
 *
 * 브라우저(RemoteEngine) → multipart/form-data
 *   prompt(필수) · size('auto' | 'WxH') · n · quality · [input_fidelity] · [model] · image[]… (첫 장이 돌 격자, 그 뒤 선화·마스크·레퍼런스)
 * → 접근 토큰 검사 → OpenAI Images API
 *   이미지가 있으면 POST /v1/images/edits (multipart, image[] 그대로 전달), 없으면 POST /v1/images/generations (JSON)
 * → OpenAI 응답 JSON(data[].b64_json, usage, 오류는 error{message, code})을 상태 코드와 함께 그대로 돌려준다.
 *
 * OpenAI API 키는 이 함수의 환경 변수(비밀값)에만 있다. 브라우저에는 이 함수의 주소와 ACCESS_TOKEN만 둔다.
 * 문서(2026-10): gpt-image-1은 2026-10-23 종료. 기본 모델은 gpt-image-2.5-sunburst(edits 기본값, 여러 이미지 합성에 강함).
 */

export interface Env {
  OPENAI_API_KEY: string;
  /** 브라우저가 Authorization: Bearer <값> 으로 보내는 접근 토큰. 비우면 검사하지 않음(권장하지 않음) */
  ACCESS_TOKEN?: string;
  /** CORS 허용 출처. '*' 또는 쉼표로 구분한 목록(예: https://dldyd147-creator.github.io,http://localhost:5173) */
  ALLOWED_ORIGIN?: string;
  /** 기본 모델(요청의 model 필드가 없을 때) */
  OPENAI_IMAGE_MODEL?: string;
  /** 첨부 상한(기본 16 = API 상한) */
  MAX_IMAGES?: string;
  /** 후보 장수 상한(기본 4) */
  MAX_N?: string;
}

export const DEFAULT_MODEL = 'gpt-image-2.5-sunburst';
const OPENAI_BASE = 'https://api.openai.com/v1';
const QUALITIES = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^(gpt-image-[\w.-]+|chatgpt-image-latest)$/;
const MAX_PROMPT = 32_000;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) } });
}

function fail(message: string, code: string, status: number, origin: string): Response {
  return json({ error: { message, code, type: 'scene_doll_function' } }, status, origin);
}

/** ALLOWED_ORIGIN이 목록이면 요청 출처가 그 안에 있을 때만 그 출처를 돌려준다 */
function pickOrigin(request: Request, allowed: string | undefined): string {
  const conf = (allowed ?? '*').trim();
  if (!conf || conf === '*') return '*';
  const list = conf.split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') ?? '';
  return list.includes(origin) ? origin : list[0];
}

/** 길이 차이 외에는 시간이 같은 비교(토큰 비교용) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');
const int = (v: string | undefined, fallback: number): number => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export async function handleImageRequest(request: Request, env: Env): Promise<Response> {
  const origin = pickOrigin(request, env.ALLOWED_ORIGIN);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method === 'GET') return json({ ok: true, service: 'scene-doll-image', model: env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL, keyConfigured: !!env.OPENAI_API_KEY, tokenRequired: !!env.ACCESS_TOKEN }, 200, origin);
  if (request.method !== 'POST') return fail('POST로 보내세요', 'method_not_allowed', 405, origin);
  if (!env.OPENAI_API_KEY) return fail('함수에 OPENAI_API_KEY 환경 변수가 없습니다(wrangler secret put OPENAI_API_KEY)', 'not_configured', 500, origin);

  if (env.ACCESS_TOKEN) {
    const auth = request.headers.get('Authorization') ?? '';
    if (!safeEqual(auth, `Bearer ${env.ACCESS_TOKEN}`)) return fail('접근 토큰이 맞지 않습니다', 'invalid_token', 401, origin);
  }

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) return fail('multipart/form-data로 보내세요(prompt, size, n, quality, image[])', 'invalid_content_type', 400, origin);
  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    return fail(`본문을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'invalid_body', 400, origin);
  }

  const prompt = str(form.get('prompt')).trim();
  if (!prompt) return fail('prompt가 비어 있습니다', 'missing_prompt', 400, origin);
  if (prompt.length > MAX_PROMPT) return fail(`prompt가 ${MAX_PROMPT}자를 넘습니다(${prompt.length})`, 'prompt_too_long', 400, origin);

  const images = [...form.getAll('image[]'), ...form.getAll('image')].filter((v): v is File => typeof v !== 'string');
  const maxImages = Math.min(16, int(env.MAX_IMAGES, 16));
  if (images.length > maxImages) return fail(`첨부 이미지는 최대 ${maxImages}장입니다(${images.length}장)`, 'too_many_images', 400, origin);
  for (const f of images) if (f.size > MAX_IMAGE_BYTES) return fail(`이미지 한 장은 50MB 미만이어야 합니다: ${f.name}`, 'image_too_large', 400, origin);

  const model = str(form.get('model')).trim() || env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;
  if (!MODEL_RE.test(model)) return fail(`지원하지 않는 모델 이름: ${model}`, 'invalid_model', 400, origin);
  const size = str(form.get('size')).trim() || 'auto';
  if (!/^(auto|\d{2,4}x\d{2,4})$/.test(size)) return fail(`size는 auto 또는 WIDTHxHEIGHT: ${size}`, 'invalid_size', 400, origin);
  const n = Math.max(1, Math.min(int(env.MAX_N, 4), int(str(form.get('n')), 1)));
  // 안전 검사 강도: 'low'면 덜 엄격하게(gpt-image 계열 moderation 매개변수). 기본은 보내지 않음(auto)
  const lowModeration = str(form.get('moderation')).trim() === 'low';
  const qualityRaw = str(form.get('quality')).trim() || 'auto';
  const quality = QUALITIES.has(qualityRaw) ? qualityRaw : 'auto';
  // input_fidelity는 gpt-image-1.5만 받는다(gpt-image-2 계열은 항상 고충실도라 보내면 400). gpt-image-1-mini는 low만
  const fidelity = str(form.get('input_fidelity')).trim();
  const fidelityOk = (fidelity === 'high' || fidelity === 'low') && images.length > 0 && (model.startsWith('gpt-image-1.5') || (model.startsWith('gpt-image-1-mini') && fidelity === 'low'));

  let upstream: Response;
  try {
    if (images.length) {
      const fd = new FormData();
      fd.set('model', model);
      fd.set('prompt', prompt);
      for (const f of images) fd.append('image[]', f, f.name || 'image.png');
      fd.set('size', size);
      fd.set('n', String(n));
      fd.set('quality', quality);
      fd.set('output_format', 'png');
      if (lowModeration) fd.set('moderation', 'low');
      if (fidelityOk) fd.set('input_fidelity', fidelity);
      upstream = await fetch(`${OPENAI_BASE}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd });
    } else {
      upstream = await fetch(`${OPENAI_BASE}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, n, size, quality, output_format: 'png', ...(lowModeration ? { moderation: 'low' } : {}) }),
      });
    }
  } catch (e) {
    return fail(`OpenAI에 연결하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`, 'upstream_unreachable', 502, origin);
  }

  const text = await upstream.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: { message: text.slice(0, 500) || upstream.statusText, code: 'upstream_non_json', type: 'upstream' } };
  }
  if (upstream.ok && body && typeof body === 'object') (body as Record<string, unknown>).model = model;
  return json(body, upstream.status, origin);
}
