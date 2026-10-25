/** 조립 계획(순수): 어떤 컷을 어떤 그림으로 몇 px에 놓고 말풍선을 어떻게 그릴지 */

import type { Cut } from '../model/types';
import { resolveBubbles, type Measure, type ResolvedBubble } from './bubbles';
import { layoutStrip, planSlices, type Slice, type StripLayout } from './layout';
import type { Assembly } from './model';

/** 컷 그림의 출처: 대표 후보 → 출력의 확정 컷 PNG → 썸네일 → 없음(회색 자리표시) */
export type SourceKind = 'generated' | 'output' | 'thumbnail' | 'none';

export const SOURCE_LABEL: Record<SourceKind, string> = { generated: '생성 후보', output: '확정 컷 PNG', thumbnail: '썸네일', none: '자리표시' };

export interface SourceInfo {
  kind: SourceKind;
  /** 그림 가로·세로(px). none이면 0 */
  width: number;
  height: number;
}

export interface PlanItem {
  number: number;
  y: number;
  height: number;
  kind: SourceKind;
  bubbles: ResolvedBubble[];
}

export interface Plan {
  layout: StripLayout;
  slices: Slice[];
  items: PlanItem[];
  fontPx: number;
  warnings: string[];
}

/** 글자 크기: 폭의 3.6% × 배율 */
export const fontPxFor = (width: number, fontScale: number): number => Math.max(8, Math.round(width * 0.036 * fontScale));

export function buildPlan(cuts: Cut[], sources: Record<number, SourceInfo | undefined>, a: Assembly, measure: Measure): Plan {
  const s = a.settings;
  const warnings: string[] = [];
  const used: Cut[] = [];
  for (const c of cuts) {
    if (a.skip.includes(c.number)) continue;
    const src = sources[c.number];
    if (!src || src.kind === 'none') {
      if (!c.confirmed) {
        warnings.push(`컷 ${c.number}: 확정도 후보도 없어 뺐습니다`);
        continue;
      }
      warnings.push(`컷 ${c.number}: 그림이 없어 회색 자리표시로 대체했습니다`);
    } else if (src.kind !== 'generated') {
      warnings.push(`컷 ${c.number}: 생성 후보가 없어 ${SOURCE_LABEL[src.kind]}로 대체했습니다`);
    }
    used.push(c);
  }
  const aspectOf = (c: Cut): number => {
    const src = sources[c.number];
    return src && src.width > 0 ? src.height / src.width : c.aspect;
  };
  const layout = layoutStrip(
    used.map((c) => ({ number: c.number, aspect: aspectOf(c) })),
    { width: s.width, gutter: s.gutter, margin: s.margin },
  );
  const fontPx = fontPxFor(s.width, s.fontScale);
  const items: PlanItem[] = used.map((c, i) => {
    const p = layout.cuts[i];
    return {
      number: c.number,
      y: p.y,
      height: p.height,
      kind: sources[c.number]?.kind ?? 'none',
      bubbles: resolveBubbles(c.number, c.dialogue ?? [], a.bubbles, { cutW: s.width, cutH: p.height, fontPx, shape: s.shape, tail: s.tail, measure }),
    };
  });
  const slices = planSlices(layout, s.sliceMax);
  const forced = slices.filter((x) => x.forced).length;
  if (forced) warnings.push(`컷 하나가 슬라이스 한도 ${s.sliceMax}px보다 길어 컷 안에서 ${forced}곳을 잘랐습니다`);
  for (const it of items) {
    for (const b of it.bubbles) {
      if (!b.hidden && (b.rect.x < 0 || b.rect.y < 0 || b.rect.x + b.rect.w > s.width || b.rect.y + b.rect.h > it.height)) warnings.push(`컷 ${it.number}: 말풍선 '${b.text.slice(0, 8)}'이(가) 컷 밖으로 나갑니다`);
    }
  }
  return { layout, slices, items, fontPx, warnings };
}
