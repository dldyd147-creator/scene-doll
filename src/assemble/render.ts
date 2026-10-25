/** canvas 그리기(미리보기와 내보내기가 같이 쓴다) */

import { tailGeometry, type Measure, type ResolvedBubble } from './bubbles';
import type { PlanItem } from './plan';

export type Drawable = CanvasImageSource & { width: number; height: number };

let measureCtx: CanvasRenderingContext2D | null = null;

/** 화면 글꼴로 글자 폭을 재는 측정기 */
export function canvasMeasure(family: string): Measure {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  const ctx = measureCtx;
  return (text, px) => {
    ctx.font = `${px}px ${family}`;
    return ctx.measureText(text).width;
  };
}

export const strokeWidth = (cutW: number): number => Math.max(2, Math.round(cutW * 0.004));

/** 컷 바탕: 그림(폭에 맞춰) 또는 회색 자리표시 */
export function drawCutBase(ctx: CanvasRenderingContext2D, img: Drawable | null, w: number, h: number, label: string): void {
  if (img) {
    ctx.drawImage(img, 0, 0, w, h);
    return;
  }
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#777';
  ctx.font = `${Math.round(w * 0.04)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
}

function bodyPath(ctx: CanvasRenderingContext2D, b: ResolvedBubble): void {
  const { x, y, w, h } = b.rect;
  ctx.beginPath();
  if (b.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.25);
}

/** 말풍선 몸통 + 꼬리(글 제외). 꼬리와 몸통이 만나는 자리의 테두리선은 가린다 */
export function drawBubbleShape(ctx: CanvasRenderingContext2D, b: ResolvedBubble, lw: number, fill = '#ffffff', stroke = '#111111'): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  const g = b.tip ? tailGeometry(b.shape, b.rect, b.tip, Math.max(b.metrics.fontPx * 0.6, 10)) : null;
  if (g) {
    ctx.beginPath();
    ctx.moveTo(g.b1.x, g.b1.y);
    ctx.lineTo(g.tip.x, g.tip.y);
    ctx.lineTo(g.b2.x, g.b2.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  bodyPath(ctx, b);
  ctx.fill();
  ctx.stroke();
  if (g) {
    // 꼬리 밑변을 따라 지나가는 몸통 테두리를 흰색으로 덮는다
    const mx = (g.b1.x + g.b2.x) / 2;
    const my = (g.b1.y + g.b2.y) / 2;
    const dl = Math.hypot(g.tip.x - mx, g.tip.y - my) || 1;
    const dx = (g.tip.x - mx) / dl;
    const dy = (g.tip.y - my) / dl;
    const bl = Math.hypot(g.b2.x - g.b1.x, g.b2.y - g.b1.y) || 1;
    const ux = ((g.b2.x - g.b1.x) / bl) * lw * 1.2;
    const uy = ((g.b2.y - g.b1.y) / bl) * lw * 1.2;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(g.b1.x + ux - dx * lw * 1.6, g.b1.y + uy - dy * lw * 1.6);
    ctx.lineTo(g.b2.x - ux - dx * lw * 1.6, g.b2.y - uy - dy * lw * 1.6);
    ctx.lineTo(g.b2.x - ux + dx * lw * 0.9, g.b2.y - uy + dy * lw * 0.9);
    ctx.lineTo(g.b1.x + ux + dx * lw * 0.9, g.b1.y + uy + dy * lw * 0.9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawBubbleText(ctx: CanvasRenderingContext2D, b: ResolvedBubble, family: string, color = '#111111', ox = 0, oy = 0): void {
  const m = b.metrics;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${m.fontPx}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = b.rect.x + b.rect.w / 2 - ox;
  const top = b.rect.y + b.rect.h / 2 - m.textH / 2 - oy;
  m.lines.forEach((line, i) => ctx.fillText(line, cx, top + m.lineH * (i + 0.5)));
  ctx.restore();
}

export function drawBubbles(ctx: CanvasRenderingContext2D, bubbles: ResolvedBubble[], family: string, cutW: number): void {
  const lw = strokeWidth(cutW);
  for (const b of bubbles) {
    if (b.hidden) continue;
    drawBubbleShape(ctx, b, lw);
    drawBubbleText(ctx, b, family);
  }
}

/** 미리보기에서 고른 말풍선의 손잡이(꼬리 끝·폭) */
export function drawSelection(ctx: CanvasRenderingContext2D, b: ResolvedBubble, cutW: number): void {
  const r = Math.max(6, cutW * 0.01);
  ctx.save();
  ctx.strokeStyle = '#2f80ed';
  ctx.lineWidth = Math.max(2, cutW * 0.003);
  ctx.setLineDash([r, r]);
  ctx.strokeRect(b.rect.x - r, b.rect.y - r, b.rect.w + r * 2, b.rect.h + r * 2);
  ctx.setLineDash([]);
  ctx.fillStyle = '#2f80ed';
  ctx.beginPath();
  ctx.arc(b.rect.x + b.rect.w, b.rect.y + b.rect.h / 2, r, 0, Math.PI * 2);
  ctx.fill();
  if (b.tip) {
    ctx.fillStyle = '#eb5757';
    ctx.beginPath();
    ctx.arc(b.tip.x, b.tip.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** 컷 하나(그림 + 말풍선)를 ctx의 (0, y)에 그린다 */
export function drawCut(ctx: CanvasRenderingContext2D, item: PlanItem, img: Drawable | null, cutW: number, family: string): void {
  ctx.save();
  ctx.translate(0, item.y);
  ctx.beginPath();
  ctx.rect(0, 0, cutW, item.height);
  ctx.clip();
  drawCutBase(ctx, img, cutW, item.height, `컷 ${item.number}`);
  drawBubbles(ctx, item.bubbles, family, cutW);
  ctx.restore();
}
