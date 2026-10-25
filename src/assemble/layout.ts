/** 스트립 배치와 슬라이스 경계(순수 계산) */

export interface StripItem {
  number: number;
  /** 세로/가로 */
  aspect: number;
}

export interface Placed {
  number: number;
  y: number;
  height: number;
}

export interface StripLayout {
  width: number;
  height: number;
  cuts: Placed[];
}

export function layoutStrip(items: StripItem[], opt: { width: number; gutter: number; margin: number }): StripLayout {
  const cuts: Placed[] = [];
  let y = opt.margin;
  items.forEach((it, i) => {
    const height = Math.max(1, Math.round(opt.width * it.aspect));
    cuts.push({ number: it.number, y, height });
    y += height + (i < items.length - 1 ? opt.gutter : 0);
  });
  return { width: opt.width, height: items.length ? y + opt.margin : 0, cuts };
}

export interface Slice {
  y0: number;
  y1: number;
  /** 컷 안에서 억지로 자른 경계가 있다 */
  forced: boolean;
}

/**
 * 세로 maxHeight 이하로 컷 경계(거터 한가운데)에서만 자른다.
 * 한 구간이 한도를 넘는 단일 컷이면 컷 안에서 한도 높이로 자르고 forced 표시.
 */
export function planSlices(layout: StripLayout, maxHeight: number): Slice[] {
  const total = layout.height;
  if (total <= 0) return [];
  const bounds: number[] = [];
  for (let i = 0; i < layout.cuts.length - 1; i++) {
    const a = layout.cuts[i];
    const b = layout.cuts[i + 1];
    bounds.push(Math.round((a.y + a.height + b.y) / 2));
  }
  bounds.push(total);
  const out: Slice[] = [];
  let start = 0;
  while (start < total) {
    let end = -1;
    for (const b of bounds) if (b > start && b - start <= maxHeight) end = b;
    let forced = false;
    if (end < 0) {
      // 다음 경계까지가 한도보다 길다: 컷 안에서 자른다
      end = Math.min(total, start + maxHeight);
      forced = end < (bounds.find((b) => b > start) ?? total);
    }
    out.push({ y0: start, y1: end, forced });
    start = end;
  }
  return out;
}
