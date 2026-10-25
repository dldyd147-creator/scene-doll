import { describe, expect, it } from 'vitest';
import { classifyHttpError, GenError, parseSize, RemoteEngine } from './engine';

function png(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
}

describe('원격 엔진', () => {
  it('multipart로 prompt·size·n·quality·image[]를 보내고 b64_json을 이미지로 돌려준다', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ data: [{ b64_json: btoa('abc') }, { b64_json: btoa('xyz') }], output_format: 'png', model: 'gpt-image-2.5-sunburst', usage: { total_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const eng = new RemoteEngine('https://fn.example.workers.dev/', 'tok-123', fakeFetch);
    const res = await eng.generate({
      prompt: '지시',
      images: [
        { name: 'grid.png', blob: png([1, 2, 3]), role: 'grid' },
        { name: 'ref_A_1.png', blob: png([4]), role: 'reference' },
      ],
      size: '2048x3072',
      n: 2,
      quality: 'high',
      inputFidelity: 'high',
    });
    expect(res.images.length).toBe(2);
    expect(await res.images[0].text()).toBe('abc');
    expect(res.images[0].type).toBe('image/png');
    expect(res.model).toBe('gpt-image-2.5-sunburst');
    expect(res.usage).toEqual({ total_tokens: 10 });

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://fn.example.workers.dev/');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    const form = calls[0].init.body as FormData;
    expect(form.get('prompt')).toBe('지시');
    expect(form.get('size')).toBe('2048x3072');
    expect(form.get('n')).toBe('2');
    expect(form.get('quality')).toBe('high');
    expect(form.get('input_fidelity')).toBe('high');
    const files = form.getAll('image[]') as File[];
    expect(files.map((f) => f.name)).toEqual(['grid.png', 'ref_A_1.png']);
    expect(files[0].size).toBe(3);
  });

  it('엔드포인트가 없으면 설정 오류, 이미지가 없으면 요청 오류', async () => {
    await expect(new RemoteEngine('', 't').generate({ prompt: 'p', images: [{ name: 'g.png', blob: png([1]), role: 'grid' }], size: 'auto', n: 1, quality: 'auto' })).rejects.toMatchObject({ kind: 'config' });
    await expect(new RemoteEngine('https://x.example', 't').generate({ prompt: 'p', images: [], size: 'auto', n: 1, quality: 'auto' })).rejects.toMatchObject({ kind: 'request' });
  });

  it('네트워크 실패 → network, 응답에 이미지가 없으면 server', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(new RemoteEngine('https://x.example', '', failing).generate({ prompt: 'p', images: [{ name: 'g.png', blob: png([1]), role: 'grid' }], size: 'auto', n: 1, quality: 'auto' })).rejects.toMatchObject({ kind: 'network' });
    const empty = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(new RemoteEngine('https://x.example', '', empty).generate({ prompt: 'p', images: [{ name: 'g.png', blob: png([1]), role: 'grid' }], size: 'auto', n: 1, quality: 'auto' })).rejects.toMatchObject({ kind: 'server' });
  });

  it('HTTP 오류 분류: 생성 거부·인증·요청·서버', () => {
    const refused = classifyHttpError(400, { error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } }, '');
    expect(refused).toBeInstanceOf(GenError);
    expect(refused.kind).toBe('refused');
    expect(refused.message).toContain('생성 거부');
    expect(classifyHttpError(401, { error: { message: 'invalid access token', code: 'invalid_token' } }, '').kind).toBe('auth');
    expect(classifyHttpError(403, null, 'forbidden').kind).toBe('auth');
    expect(classifyHttpError(400, { error: { message: 'Invalid size', code: 'invalid_value' } }, '').kind).toBe('request');
    expect(classifyHttpError(413, null, '').kind).toBe('request');
    expect(classifyHttpError(502, null, 'Bad Gateway').kind).toBe('server');
    expect(classifyHttpError(500, { error: { message: 'content policy violation' } }, '').kind).toBe('refused');
  });

  it('크기 문자열', () => {
    expect(parseSize('1024x1536')).toEqual({ width: 1024, height: 1536 });
    expect(parseSize('auto')).toBeNull();
    expect(parseSize('10x10')).toEqual({ width: 10, height: 10 });
  });
});
