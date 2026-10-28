import { describe, expect, it } from 'vitest';
import { imageLimitOf, modelOptionLabel, parseVeniceModels } from './veniceModels';

const raw = (id: string, spec: object) => ({ id, model_spec: { name: id, ...spec } });

describe('베니스 모델 목록', () => {
  const json = {
    data: [
      raw('flux', { pricing: { inpaint: { usd: 0.12 } }, constraints: { combineImages: true, maxInputImages: 6, promptCharacterLimit: 32000 }, privacy: 'anonymized' }),
      raw('seed', { uncensored: true, pricing: { inpaint: { usd: 0.05 } }, constraints: { combineImages: true, maxInputImages: 6, promptCharacterLimit: 10000 } }),
      raw('qw', { uncensored: true, privacy: 'private', pricing: { inpaint: { usd: 0.04 } }, constraints: { combineImages: true } }),
      raw('luma', { constraints: { combineImages: false } }),
      raw('off', { offline: true, constraints: { combineImages: true } }),
    ],
  };
  it('검열 없는 모델이 먼저, 합칠 수 없거나 오프라인인 모델은 뺀다', () => {
    const list = parseVeniceModels(json);
    expect(list.map((m) => m.id)).toEqual(['qw', 'seed', 'flux']);
    expect(list[0]).toMatchObject({ uncensored: true, privacy: 'private', maxImages: null, usd: 0.04 });
  });
  it('이미지 수 모르면 3장, 표시 문구', () => {
    const [qw, seed] = parseVeniceModels(json);
    expect(imageLimitOf(qw)).toBe(3);
    expect(imageLimitOf(seed)).toBe(6);
    expect(modelOptionLabel(seed)).toBe('seed — 검열 없음 · $0.05 · 이미지 6장 · 글 10000자');
  });
  it('엉뚱한 응답은 빈 배열', () => {
    expect(parseVeniceModels(null)).toEqual([]);
    expect(parseVeniceModels({ data: 'x' })).toEqual([]);
  });
});
