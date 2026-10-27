import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleImageRequest } from '../../serverless/openai-image/core';

const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function req(extra: Record<string, string> = {}): Request {
  const f = new FormData();
  f.set('prompt', '격자');
  f.set('provider', 'venice');
  f.set('size', '1024x1536');
  f.set('n', '2');
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  f.append('image[]', new File([png], 'a.png', { type: 'image/png' }));
  f.append('image[]', new File([png], 'b.png', { type: 'image/png' }));
  return new Request('https://fn.example/', { method: 'POST', body: f });
}

afterEach(() => vi.unstubAllGlobals());

describe('베니스 어댑터', () => {
  it('multi-edit에 images·modelId·aspect_ratio를 보내고 OpenAI 모양으로 돌려준다(안전 관련 값은 없음)', async () => {
    const calls: Array<{ url: string; form: FormData; auth: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, form: init.body as FormData, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(png, { headers: { 'Content-Type': 'image/png' } });
    });
    const res = await handleImageRequest(req({ model: 'gpt-image-2-edit' }), { OPENAI_API_KEY: '', VENICE_API_KEY: 'vk' });
    const body = (await res.json()) as { data: Array<{ b64_json: string }>; output_format: string; model: string };
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.output_format).toBe('png');
    expect(body.model).toBe('venice:gpt-image-2-edit');
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.venice.ai/api/v1/image/multi-edit');
    expect(calls[0].auth).toBe('Bearer vk');
    expect(calls[0].form.get('modelId')).toBe('gpt-image-2-edit');
    expect(calls[0].form.get('aspect_ratio')).toBe('2:3');
    expect(calls[0].form.getAll('images')).toHaveLength(2);
    for (const k of ['safe_mode', 'quality', 'moderation']) expect(calls[0].form.has(k)).toBe(false);
  });
  it('422는 moderation_blocked, 키가 없으면 안내', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'blocked' }), { status: 422 }));
    const res = await handleImageRequest(req(), { OPENAI_API_KEY: '', VENICE_API_KEY: 'vk' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('moderation_blocked');
    const none = await handleImageRequest(req(), { OPENAI_API_KEY: 'ok' });
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('not_configured');
  });
});
