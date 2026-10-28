import { describe, expect, it } from 'vitest';
import { DEFAULT_API_LIST } from './apiList';
import { estimateRemaining, estimateTotal, formatDuration, perBatchSeconds, recordDuration, roughDuration } from './timeEstimate';

const venice = DEFAULT_API_LIST[0];

describe('생성 예상 시간', () => {
  it('기록이 없으면 서비스 기본값, 있으면 중앙값', () => {
    expect(perBatchSeconds({}, venice)).toEqual({ seconds: 40, basis: 'default', samples: 0 });
    let h = recordDuration({}, venice.id, 30);
    h = recordDuration(h, venice.id, 200);
    h = recordDuration(h, venice.id, 34);
    expect(perBatchSeconds(h, venice)).toEqual({ seconds: 34, basis: 'history', samples: 3 });
    expect(perBatchSeconds(recordDuration(h, venice.id, 36), venice).seconds).toBe(35);
  });
  it('기록은 최근 10개만, 이상한 값은 무시', () => {
    let h = {};
    for (let i = 1; i <= 12; i++) h = recordDuration(h, 'x', i);
    expect((h as Record<string, number[]>).x).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(recordDuration({}, 'x', 0)).toEqual({});
    expect(recordDuration({}, 'x', NaN)).toEqual({});
  });
  it('전체·남은 시간', () => {
    const per = { seconds: 40, basis: 'default' as const, samples: 0 };
    expect(estimateTotal(per, 5)).toBe(200);
    expect(estimateRemaining(per, 5, 0, 0)).toBe(200);
    expect(estimateRemaining(per, 5, 2, 15)).toBe(25 + 80);
    expect(estimateRemaining(per, 5, 2, 90)).toBe(4 + 80); // 예상보다 오래 걸려도 0이 되지 않는다
    expect(estimateRemaining(per, 5, 5, 0)).toBe(0);
  });
  it('표시 문구', () => {
    expect(formatDuration(45)).toBe('45초');
    expect(formatDuration(150)).toBe('2분 30초');
    expect(formatDuration(120)).toBe('2분');
    expect(formatDuration(3900)).toBe('1시간 5분');
    expect(roughDuration(47)).toBe('약 45초');
    expect(roughDuration(2)).toBe('약 5초');
    expect(roughDuration(158)).toBe('약 2분 40초');
  });
});
