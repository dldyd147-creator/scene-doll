/** 말풍선 계산(순수): 줄바꿈·크기·기본 배치·꼬리 기하·맞춤 판정. 글자 폭 측정은 주입받는다 */

import { bubbleKey, type BubbleOverride, type BubbleShape } from './model';

/** 한 줄 글자 폭(px) */
export type Measure = (text: string, fontPx: number) => number;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const LINE_HEIGHT = 1.35;
/** 타원은 글 상자보다 이만큼 크게 잡아야 글이 안에 들어간다 */
const ELLIPSE_K = 1.3;

/** 사용자가 쓴 줄바꿈을 지키며 maxW를 넘으면 공백(없으면 글자) 단위로 줄을 바꾼다 */
export function wrapText(text: string, maxW: number, fontPx: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    // 공백까지 붙은 덩어리 단위로 채우고, 덩어리 하나가 maxW보다 길면 글자 단위로 쪼갠다
    for (const word of para.split(/(?<= )/)) {
      if (measure((line + word).trimEnd(), fontPx) <= maxW) {
        line += word;
        continue;
      }
      if (line) {
        out.push(line.trimEnd());
        line = '';
      }
      if (measure(word.trimEnd(), fontPx) <= maxW) {
        line = word;
        continue;
      }
      for (const ch of word) {
        if (line && measure((line + ch).trimEnd(), fontPx) > maxW) {
          out.push(line.trimEnd());
          line = '';
        }
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export interface Metrics {
  lines: string[];
  fontPx: number;
  lineH: number;
  /** 글 상자 */
  textW: number;
  textH: number;
  /** 몸통 크기 */
  w: number;
  h: number;
}

const kx = (shape: BubbleShape) => (shape === 'ellipse' ? ELLIPSE_K : 1);

/** 자동 폭: 한 줄로 쓸 때 폭, 컷 폭의 22%~55% */
export function autoBodyWidth(text: string, shape: BubbleShape, fontPx: number, cutW: number, measure: Measure): number {
  const natural = Math.max(...text.split(/\r?\n/).map((l) => measure(l, fontPx)), fontPx);
  const w = (natural + fontPx * 1.6) * kx(shape);
  return Math.min(cutW * 0.55, Math.max(cutW * 0.22, w));
}

/** 몸통 폭 bodyW(px)에 글을 넣었을 때의 줄·크기 */
export function bubbleMetrics(text: string, shape: BubbleShape, bodyW: number, fontPx: number, measure: Measure): Metrics {
  const textMax = Math.max(fontPx, bodyW / kx(shape) - fontPx * 1.6);
  const lines = wrapText(text, textMax, fontPx, measure);
  const lineH = fontPx * LINE_HEIGHT;
  const textW = Math.min(textMax, Math.max(...lines.map((l) => measure(l, fontPx)), 0));
  const textH = lines.length * lineH;
  const h = shape === 'ellipse' ? (textH + fontPx * 0.8) * ELLIPSE_K : textH + fontPx * 1.4;
  return { lines, fontPx, lineH, textW, textH, w: bodyW, h };
}

export interface ResolvedBubble {
  key: string;
  index: number;
  speaker: string;
  text: string;
  shape: BubbleShape;
  /** 몸통 사각형(px, 컷 왼쪽 위 기준) */
  rect: Rect;
  metrics: Metrics;
  /** 꼬리 끝(px). 없으면 null */
  tip: Pt | null;
  hidden: boolean;
  /** 사용자가 만진 적이 있는가 */
  edited: boolean;
}

export interface ResolveOpts {
  cutW: number;
  cutH: number;
  fontPx: number;
  shape: BubbleShape;
  tail: boolean;
  measure: Measure;
}

export interface DialogueLike {
  speaker: string;
  text: string;
  position: 'top' | 'bottom';
}

/** 대사 + 덮어쓰기 → 그릴 말풍선(px). 안 만진 것은 위/아래 쌓기 기본 배치 */
export function resolveBubbles(cutNumber: number, dialogue: DialogueLike[], overrides: Record<string, BubbleOverride>, o: ResolveOpts): ResolvedBubble[] {
  const out: ResolvedBubble[] = [];
  const cursor = { top: o.cutH * 0.04, bottom: o.cutH * 0.04 };
  const count = { top: 0, bottom: 0 };
  dialogue.forEach((d, index) => {
    const key = bubbleKey(cutNumber, index);
    const ov = overrides[key];
    const text = ov?.text ?? d.text;
    const shape = ov?.shape ?? o.shape;
    const bodyW = ov?.w !== undefined ? ov.w * o.cutW : autoBodyWidth(text, shape, o.fontPx, o.cutW, o.measure);
    const metrics = bubbleMetrics(text, shape, bodyW, o.fontPx, o.measure);
    const side = d.position === 'bottom' ? 'bottom' : 'top';
    // 기본 위치: 오른쪽·왼쪽을 번갈아 위(또는 아래)에서부터 쌓는다. 쌓는 자리는 만졌든 안 만졌든 흐름을 지켜 소비한다
    const k = count[side]++;
    const gapY = o.cutH * 0.015;
    let dcx = k % 2 === 0 ? 0.66 : 0.34;
    dcx = Math.min(1 - metrics.w / o.cutW / 2 - 0.02, Math.max(metrics.w / o.cutW / 2 + 0.02, dcx));
    const dcy = side === 'top' ? (cursor.top + metrics.h / 2) / o.cutH : (o.cutH - cursor.bottom - metrics.h / 2) / o.cutH;
    cursor[side] += metrics.h * 0.8 + gapY;
    const cx = (ov?.cx ?? dcx) * o.cutW;
    const cy = (ov?.cy ?? dcy) * o.cutH;
    const rect: Rect = { x: cx - metrics.w / 2, y: cy - metrics.h / 2, w: metrics.w, h: metrics.h };
    let tip: Pt | null = null;
    if (ov?.tail === null) tip = null;
    else if (ov?.tail) tip = { x: ov.tail.x * o.cutW, y: ov.tail.y * o.cutH };
    else if (o.tail) tip = defaultTip(rect, side, o);
    out.push({ key, index, speaker: d.speaker, text, shape, rect, metrics, tip, hidden: !!ov?.hidden, edited: !!ov });
  });
  return out;
}

/** 자동 꼬리 끝: 컷 안쪽(그림 쪽)을 향해 글자 한 줄 반쯤 나간다 */
export function defaultTip(rect: Rect, side: 'top' | 'bottom', o: Pick<ResolveOpts, 'cutW' | 'cutH' | 'fontPx'>): Pt {
  const cx = rect.x + rect.w / 2;
  const reach = Math.max(o.fontPx * 1.5, o.cutH * 0.05);
  const x = cx + (o.cutW / 2 - cx) * 0.25;
  return side === 'top' ? { x, y: rect.y + rect.h + reach } : { x, y: rect.y - reach };
}

export interface TailGeom {
  b1: Pt;
  b2: Pt;
  tip: Pt;
}

/** 꼬리 삼각형: 몸통 가장자리의 두 점 + 끝. 끝이 몸통 안이면 null */
export function tailGeometry(shape: BubbleShape, rect: Rect, tip: Pt, baseHalf: number): TailGeom | null {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (inBody(shape, rect, tip)) return null;
  if (shape === 'ellipse') {
    const a = rect.w / 2;
    const b = rect.h / 2;
    const th = Math.atan2((tip.y - cy) / b, (tip.x - cx) / a);
    const d = baseHalf / ((a + b) / 2);
    const at = (t: number): Pt => ({ x: cx + a * Math.cos(t), y: cy + b * Math.sin(t) });
    return { b1: at(th - d), b2: at(th + d), tip };
  }
  // 둥근 사각형: 중심 → 끝 반직선이 사각형과 만나는 변에서 변을 따라 ± baseHalf (둥근 모서리는 피함)
  const r = Math.min(rect.w, rect.h) * 0.25;
  const dx = tip.x - cx;
  const dy = tip.y - cy;
  const tx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  const hx = cx + dx * t;
  const hy = cy + dy * t;
  if (tx <= ty) {
    const lo = rect.y + r;
    const hi = rect.y + rect.h - r;
    const c = Math.min(hi - baseHalf, Math.max(lo + baseHalf, hy));
    return { b1: { x: hx, y: c - baseHalf }, b2: { x: hx, y: c + baseHalf }, tip };
  }
  const lo = rect.x + r;
  const hi = rect.x + rect.w - r;
  const c = Math.min(hi - baseHalf, Math.max(lo + baseHalf, hx));
  return { b1: { x: c - baseHalf, y: hy }, b2: { x: c + baseHalf, y: hy }, tip };
}

export function inBody(shape: BubbleShape, rect: Rect, p: Pt): boolean {
  if (shape === 'ellipse') {
    const a = rect.w / 2;
    const b = rect.h / 2;
    const nx = (p.x - rect.x - a) / a;
    const ny = (p.y - rect.y - b) / b;
    return nx * nx + ny * ny <= 1;
  }
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

export type Hit = { key: string; part: 'body' | 'tip' | 'width' };

/** 위에 그려진(뒤에 있는) 말풍선부터 손잡이 → 몸통 순으로 맞춘다 */
export function hitTest(bubbles: ResolvedBubble[], p: Pt, handle: number): Hit | null {
  const live = bubbles.filter((b) => !b.hidden);
  for (let i = live.length - 1; i >= 0; i--) {
    const b = live[i];
    if (b.tip && Math.hypot(p.x - b.tip.x, p.y - b.tip.y) <= handle) return { key: b.key, part: 'tip' };
    if (Math.hypot(p.x - (b.rect.x + b.rect.w), p.y - (b.rect.y + b.rect.h / 2)) <= handle) return { key: b.key, part: 'width' };
  }
  for (let i = live.length - 1; i >= 0; i--) if (inBody(live[i].shape, live[i].rect, p)) return { key: live[i].key, part: 'body' };
  return null;
}
