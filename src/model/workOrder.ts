import type { Work } from './types';

/** 작품 목록 순서: order가 작은 쪽이 위, order가 없는 작품은 뒤에서 코드 순 */
export function sortWorks<T>(items: T[], workOf: (item: T) => Work): T[] {
  return [...items].sort((a, b) => {
    const wa = workOf(a);
    const wb = workOf(b);
    const oa = wa.order ?? Number.POSITIVE_INFINITY;
    const ob = wb.order ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa < ob ? -1 : 1;
    return wa.code < wb.code ? -1 : wa.code > wb.code ? 1 : 0;
  });
}

/** 현재 순서(코드 배열)에서 한 칸 옮긴 뒤 모두에게 0부터 새 order를 준다. 못 옮기면 null */
export function moveWork(codes: string[], code: string, dir: -1 | 1): Array<{ code: string; order: number }> | null {
  const i = codes.indexOf(code);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= codes.length) return null;
  const next = [...codes];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((c, order) => ({ code: c, order }));
}
