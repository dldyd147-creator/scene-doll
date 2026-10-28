import { describe, expect, it } from 'vitest';
import { GenError } from '../engine';
import { bflBody, bflGenerate, bflResolution } from './bfl';
import { openaiGenerate } from './openai';
import { veniceGenerate } from './venice';
import type { ProviderImage, ProviderRequest } from './common';

const img = (n: number): ProviderImage => ({ name: `a${n}.png`, data: new Uint8Array([1, 2, 3, n]), mime: 'image/png' });
const base: ProviderRequest = { prompt: 'p', images: [img(1), img(2)], size: '1024x1536', n: 1, quality: 'auto', model: 'm', apiKey: 'KEY-1234567', sleep: async () => undefined };
const jsonRes = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('BFL 직접 Flux 3', () => {
  it('요청 본문: 문서의 필드만, safety_tolerance는 보내지 않는다', () => {
    const b = bflBody(base);
    expect(Object.keys(b).sort()).toEqual(['aspect_ratio', 'grounding', 'images', 'prompt', 'resolution']);
    expect(b.aspect_ratio).toBe('2:3');
    expect(b.resolution).toBe('1.5k');
    expect(b.grounding).toBe(false);
    expect((b.images as string[]).length).toBe(2);
    expect(JSON.stringify(b)).not.toContain('safety');
  });
  it('해상도 단계', () => {
    expect(bflResolution('512x512')).toBe('768sq');
    expect(bflResolution('1024x1024')).toBe('1k');
    expect(bflResolution('1536x1024')).toBe('1.5k');
    expect(bflResolution('auto')).toBe('1k');
  });
  it('제출 → 폴링 → 다운로드, x-key 헤더, 비용 합산', async () => {
    const calls: Array<{ url: string; key: string | null; method: string }> = [];
    let polls = 0;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, key: headers.get('x-key'), method: init?.method ?? 'GET' });
      if (url === 'https://api.bfl.ai/v1/flux-3-image') return jsonRes({ id: 't1', polling_url: 'https://api.bfl.ai/v1/get_result?id=t1', cost: 5 });
      if (url.startsWith('https://api.bfl.ai/v1/get_result')) return jsonRes(++polls < 2 ? { status: 'Pending' } : { status: 'Ready', result: { sample: 'https://delivery.example/img.png' } });
      return new Response(new Uint8Array([9, 9, 9]), { headers: { 'Content-Type': 'image/png' } });
    }) as typeof fetch;
    const r = await bflGenerate({ ...base, n: 2, fetchFn });
    expect(r.images).toHaveLength(2);
    expect(Array.from(r.images[0])).toEqual([9, 9, 9]);
    expect(r.costCredits).toBe(10);
    expect(calls[0]).toMatchObject({ method: 'POST', key: 'KEY-1234567' });
    expect(calls.filter((c) => c.url.startsWith('https://delivery')).every((c) => c.key === null)).toBe(true);
  });
  it('모더레이션·키 오류·장수 초과를 구분한다', async () => {
    const moderated = (async (input: RequestInfo | URL) => (String(input).includes('get_result') ? jsonRes({ status: 'Request Moderated' }) : jsonRes({ id: 't', polling_url: 'https://api.bfl.ai/v1/get_result?id=t' }))) as typeof fetch;
    await expect(bflGenerate({ ...base, fetchFn: moderated })).rejects.toMatchObject({ kind: 'refused' });
    const unauth = (async () => jsonRes({ detail: 'Not authenticated' }, 403)) as typeof fetch;
    await expect(bflGenerate({ ...base, fetchFn: unauth })).rejects.toMatchObject({ kind: 'auth' });
    const credits = (async () => jsonRes({ detail: 'Insufficient credits' }, 402)) as typeof fetch;
    await expect(bflGenerate({ ...base, fetchFn: credits })).rejects.toThrow(/크레딧/);
    await expect(bflGenerate({ ...base, images: Array.from({ length: 11 }, (_, i) => img(i)) })).rejects.toBeInstanceOf(GenError);
  });
});

describe('베니스', () => {
  it('multi-edit에 modelId·images·aspect_ratio를 보내고 안전 값은 보내지 않는다', async () => {
    let form: FormData | null = null;
    let auth = '';
    const fetchFn = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      form = init?.body as FormData;
      auth = new Headers(init?.headers).get('Authorization') ?? '';
      return new Response(new Uint8Array([7, 7]), { headers: { 'Content-Type': 'image/png' } });
    }) as typeof fetch;
    const r = await veniceGenerate({ ...base, model: 'flux-3-image-edit', n: 2, fetchFn });
    expect(r.images).toHaveLength(2);
    expect(auth).toBe('Bearer KEY-1234567');
    const f = form as unknown as FormData;
    expect(f.get('modelId')).toBe('flux-3-image-edit');
    expect(f.getAll('images')).toHaveLength(2);
    expect(f.get('aspect_ratio')).toBe('2:3');
    expect([...f.keys()].some((k) => /safe|moder|nsfw/i.test(k))).toBe(false);
  });
  it('422는 생성 거부', async () => {
    const fetchFn = (async () => jsonRes({ error: 'blocked' }, 422)) as typeof fetch;
    await expect(veniceGenerate({ ...base, fetchFn })).rejects.toMatchObject({ kind: 'refused' });
  });
});

describe('OpenAI', () => {
  it('edits에 image[]를 보내 b64를 받는다', async () => {
    const fetchFn = (async (u: RequestInfo | URL) => {
      expect(String(u)).toBe('https://api.openai.com/v1/images/edits');
      return jsonRes({ data: [{ b64_json: btoa('abc') }], usage: { input_tokens: 5 } });
    }) as typeof fetch;
    const r = await openaiGenerate({ ...base, model: 'gpt-image-2.5-sunburst', fetchFn });
    expect(new TextDecoder().decode(r.images[0])).toBe('abc');
    expect(r.usage).toEqual({ input_tokens: 5 });
  });
  it('사용자 정의는 기준 주소가 필요하다', async () => {
    await expect(openaiGenerate({ ...base, model: 'x' }, true)).rejects.toMatchObject({ kind: 'config' });
  });
});
