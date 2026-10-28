import { GenError, classifyHttpError } from '../engine';
import { base64ToBytes } from './bytes';
import { blobOf, networkError, type ProviderRequest, type ProviderResult } from './common';

const BASE = 'https://api.openai.com/v1';
const MODEL_RE = /^(gpt-image-[\w.-]+|chatgpt-image-latest)$/;

/** OpenAI 이미지 API(또는 호환 주소). 이미지가 있으면 /images/edits(multipart), 없으면 /images/generations(JSON) */
export async function openaiGenerate(req: ProviderRequest, custom = false): Promise<ProviderResult> {
  const f = req.fetchFn ?? fetch;
  const base = (custom ? req.baseUrl?.trim().replace(/\/+$/, '') : BASE) ?? '';
  if (!base || !/^https?:\/\//.test(base)) throw new GenError('config', '사용자 정의 항목의 기준 주소(http/https)를 넣으세요');
  if (!custom && !MODEL_RE.test(req.model)) throw new GenError('config', `지원하지 않는 OpenAI 모델 이름: ${req.model}`);
  const n = Math.max(1, Math.min(4, Math.round(req.n)));
  const model = req.model;
  const fidelityOk = !custom && req.inputFidelity && req.images.length > 0 && (model.startsWith('gpt-image-1.5') || (model.startsWith('gpt-image-1-mini') && req.inputFidelity === 'low'));
  let res: Response;
  try {
    if (req.images.length) {
      const fd = new FormData();
      fd.set('model', model);
      fd.set('prompt', req.prompt);
      for (const img of req.images) fd.append('image[]', blobOf(img), img.name);
      fd.set('size', req.size);
      fd.set('n', String(n));
      fd.set('quality', req.quality);
      fd.set('output_format', 'png');
      if (fidelityOk) fd.set('input_fidelity', req.inputFidelity!);
      res = await f(`${base}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${req.apiKey}` }, body: fd, signal: req.signal });
    } else {
      res = await f(`${base}/images/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: req.prompt, n, size: req.size, quality: req.quality, output_format: 'png' }),
        signal: req.signal,
      });
    }
  } catch (e) {
    throw networkError(e, req.signal, custom ? '사용자 정의 주소' : 'OpenAI');
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
  const images = (data ?? []).filter((d) => d.b64_json).map((d) => base64ToBytes(d.b64_json!));
  if (!images.length) throw new GenError('server', '응답에 base64(b64_json) 이미지가 없습니다');
  return { images, mime: 'image/png', model, usage: (body as { usage?: Record<string, unknown> }).usage };
}
