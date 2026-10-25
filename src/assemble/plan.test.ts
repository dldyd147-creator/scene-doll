import { describe, expect, it } from 'vitest';
import type { Cut } from '../model/types';
import { planExport } from './plan';

const cut = (n: number, confirmed = true): Cut => ({ number: n, confirmed, generatedImages: [] }) as unknown as Cut;

describe('원고 내보내기 계획', () => {
  it('그림이 있는 컷만 내보내고, 대표 후보가 아닌 그림·빠진 컷은 경고한다', () => {
    const p = planExport([cut(1), cut(2), cut(3, false), cut(4), cut(5)], { 1: 'generated', 2: 'output', 3: 'none', 4: 'none', 5: 'generated' }, [5]);
    expect(p.items.map((i) => i.number)).toEqual([1, 2]);
    expect(p.warnings).toHaveLength(3);
    expect(p.warnings[0]).toContain('확정 컷 PNG');
    expect(p.warnings[1]).toContain('뺐습니다');
    expect(p.warnings[2]).toContain('파란 칸');
  });
});

import { buildMeta, clipCuts, makeClip } from './ntt';

describe('NTT 연동', () => {
  const c = (n: number, confirmed: boolean, extra: Partial<Cut> = {}): Cut => ({ number: n, aspect: 1.5, confirmed, generatedImages: [], dialogue: [], ...extra }) as Cut;
  it('보낼 컷: 뺀 컷 제외, 그림 없는 확정 컷은 포함', () => {
    const r = clipCuts([c(1, true), c(2, false), c(3, false), c(4, true)], { 1: 'generated', 2: 'none', 3: 'output', 4: 'none' }, [1]);
    expect(r.map((x) => x.number)).toEqual([3, 4]);
  });
  it('meta: 대사·위치·지문을 싣고 빈 대사는 거른다', () => {
    const m = buildMeta({ name: '작품', code: 'TST' } as never, { number: 2 } as never, [c(1, true, { scriptNote: '장면', dialogue: [{ speaker: 'A', text: '안녕', position: 'bottom' }, { speaker: 'B', text: ' ', position: 'top' }] })]);
    expect(m).toEqual({ title: '작품', code: 'TST', episode: 2, cuts: [{ number: 1, aspect: 1.5, scene: '장면', dialogue: [{ speaker: 'A', text: '안녕', position: 'bottom' }] }] });
  });
  it('makeClip: 작업 걸기 → 진행 → 받기, 토큰은 Authorization 헤더로', async () => {
    const calls: string[] = [];
    let polls = 0;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url} ${(init?.headers as Record<string, string>)?.Authorization}`);
      if (url.endsWith('/clip')) return new Response(JSON.stringify({ id: 'j1' }), { status: 201 });
      if (url.endsWith('/download')) return new Response(new Uint8Array([1, 2, 3]));
      polls++;
      return new Response(JSON.stringify({ status: polls < 2 ? 'running' : 'done', done: 1, total: 1, error: '' }));
    }) as unknown as typeof fetch;
    const blob = await makeClip({ url: 'https://ntt.example/', token: ' tk ', meta: { title: '', code: 'T', episode: 1, cuts: [] }, images: [], fetchFn: fakeFetch, pollMs: 1 });
    expect(blob.size).toBe(3);
    expect(calls[0]).toBe('POST https://ntt.example/api/scene-doll/clip Bearer tk');
    expect(calls.at(-1)).toContain('/jobs/j1/download');
  });
  it('makeClip: 실패한 작업·서버 오류 메시지를 그대로 알린다', async () => {
    const bad = (async () => new Response(JSON.stringify({ message: '토큰이 맞지 않습니다.' }), { status: 401 })) as unknown as typeof fetch;
    await expect(makeClip({ url: 'x', token: 't', meta: { title: '', code: '', episode: 1, cuts: [] }, images: [], fetchFn: bad, pollMs: 1 })).rejects.toThrow('토큰이 맞지 않습니다.');
  });
});
