/** 6단계 원고 내보내기 계획(순수): 어떤 컷을 어떤 그림으로 내보낼지. 합치는 일은 NTT가 한다 */

import type { Cut } from '../model/types';

/** 컷 그림의 출처: 대표 후보 → 출력의 확정 컷 PNG → 썸네일 → 없음 */
export type SourceKind = 'generated' | 'output' | 'thumbnail' | 'none';

export const SOURCE_LABEL: Record<SourceKind, string> = { generated: '생성 후보', output: '확정 컷 PNG', thumbnail: '썸네일', none: '그림 없음' };

export interface ExportItem {
  number: number;
  kind: SourceKind;
}

export interface ExportPlan {
  items: ExportItem[];
  warnings: string[];
}

/** 그림이 있는 컷만 내보낸다(NTT가 그림 없는 컷은 파란 칸으로 둔다). 대표 후보가 아닌 그림·빠진 컷은 경고 */
export function planExport(cuts: Cut[], kinds: Record<number, SourceKind | undefined>, skip: number[] = []): ExportPlan {
  const items: ExportItem[] = [];
  const warnings: string[] = [];
  for (const c of cuts) {
    if (skip.includes(c.number)) continue;
    const kind = kinds[c.number] ?? 'none';
    if (kind === 'none') {
      warnings.push(c.confirmed ? `컷 ${c.number}: 생성 후보가 없어 내보내지 않습니다(NTT에서 파란 칸으로 나옵니다)` : `컷 ${c.number}: 확정도 후보도 없어 뺐습니다`);
      continue;
    }
    if (kind !== 'generated') warnings.push(`컷 ${c.number}: 생성 후보가 없어 ${SOURCE_LABEL[kind]}로 대신합니다`);
    items.push({ number: c.number, kind });
  }
  return { items, warnings };
}
