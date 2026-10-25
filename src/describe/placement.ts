import type { DollAnalysis } from './analyze';

/**
 * 화면 안 인물 둘 이상의 앞뒤·좌우 관계(순수 로직, three 없음).
 * 실제 생성 검증(2026-10-25)에서 나란히 앉은 두 인물(카메라 거리 차 2cm)이 '중앙 뒤 / 중앙 앞'으로 적힌 것을 고쳤다:
 * 거리 차가 작으면 앞뒤를 붙이지 않고, 같은 칸(왼쪽·중앙·오른쪽)에 둘 이상이면 서로의 좌우를 적는다.
 */

/** 앞뒤를 가르는 최소 거리 차: 0.3m와 가장 가까운 인물 거리의 12% 중 큰 값. 그보다 작으면 나란히 있는 것으로 본다 */
export const DEPTH_SPLIT = { minMeters: 0.3, minRatio: 0.12 } as const;

/** 같은 칸 안에서 좌우를 가르는 최소 화면 간격(NDC 단위, 화면 폭의 4%). 더 가까우면 겹친 것으로 보고 앞뒤만 쓴다 */
export const SIDE_SPLIT = 0.08;

type Placeable = Pick<DollAnalysis, 'xZone' | 'depthZone' | 'distance' | 'screenX' | 'relation' | 'colorName'>;

/**
 * 앞뒤(depthZone)와 좌우 관계(relation)를 정해 입력에 써 넣는다.
 * - 앞뒤: 거리 폭이 DEPTH_SPLIT 이상일 때만. 가까운 1/3은 '앞', 먼 1/3은 '뒤', 사이는 '중간'.
 * - 좌우: 같은 xZone의 다른 인물 중 화면 간격이 SIDE_SPLIT 이상인 가장 가까운 이웃을 기준으로 '파랑 돌 왼쪽'처럼.
 */
export function refinePlacement(dolls: Placeable[]): void {
  for (const d of dolls) {
    d.depthZone = null;
    d.relation = null;
  }
  if (dolls.length < 2) return;
  const dists = dolls.map((d) => d.distance);
  const near = Math.min(...dists);
  const far = Math.max(...dists);
  const spread = far - near;
  if (spread >= Math.max(DEPTH_SPLIT.minMeters, DEPTH_SPLIT.minRatio * near)) {
    for (const d of dolls) d.depthZone = d.distance <= near + spread / 3 ? '앞' : d.distance >= far - spread / 3 ? '뒤' : '중간';
  }
  for (const d of dolls) {
    const x = d.screenX;
    if (x === undefined) continue;
    let best: Placeable | null = null;
    let bestGap = Infinity;
    for (const o of dolls) {
      if (o === d || o.xZone !== d.xZone || o.screenX === undefined) continue;
      const gap = Math.abs(o.screenX - x);
      if (gap < SIDE_SPLIT || gap >= bestGap) continue;
      best = o;
      bestGap = gap;
    }
    if (best) d.relation = `${best.colorName} 돌 ${x < best.screenX! ? '왼쪽' : '오른쪽'}`;
  }
}

/** 위치 문구: '중앙', '왼쪽 앞', '중앙 (파랑 돌 왼쪽)'. 설명 텍스트·씬 라이브러리 칩·AI 패키지가 같이 쓴다 */
export function placementLabel(d: Pick<DollAnalysis, 'xZone' | 'depthZone' | 'relation'>): string {
  const base = d.depthZone ? `${d.xZone} ${d.depthZone}` : d.xZone;
  return d.relation ? `${base} (${d.relation})` : base;
}
