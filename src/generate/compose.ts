import { splitRects, type GridLayout } from './batch';

/** 격자 합성·분할(브라우저 캔버스). 순수 좌표 계산은 batch.ts에 있다 */

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), type));
}

/** 투명 배경 캔버스(색 마스크 패스)를 흰 바탕에 올린다 */
export function onWhite(src: HTMLCanvasElement, color = '#ffffff'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c;
}

export interface ComposeOptions {
  /** 칸 왼쪽 위에 칸 번호 */
  labels?: boolean;
  background?: string;
  /** 컷 바깥 여백(화면비가 다른 컷) 색 */
  padding?: string;
  border?: string;
}

/**
 * 컷 이미지들을 격자 한 장으로 합성한다. 칸마다 테두리와 번호를 그리고, 빈 칸은 회색으로 둔다.
 * sources: 컷 번호 → 그 컷의 렌더(캔버스·비트맵)
 */
export function composeGrid(layout: GridLayout, sources: ReadonlyMap<number, CanvasImageSource>, opts: ComposeOptions = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = opts.background ?? '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const lw = Math.max(2, Math.round(layout.cellW / 256));
  ctx.lineWidth = lw;
  ctx.strokeStyle = opts.border ?? '#333333';
  // 빈 칸(컷 수 < 열×행)
  for (let i = layout.cells.length; i < layout.cols * layout.rows; i++) {
    const x = (i % layout.cols) * layout.cellW;
    const y = Math.floor(i / layout.cols) * layout.cellH;
    ctx.fillStyle = '#e4e4e4';
    ctx.fillRect(x, y, layout.cellW, layout.cellH);
    ctx.strokeRect(x + lw / 2, y + lw / 2, layout.cellW - lw, layout.cellH - lw);
  }
  const font = Math.max(16, Math.round(layout.cellW / 12));
  for (const cell of layout.cells) {
    if (cell.inner.h < cell.h || cell.inner.w < cell.w) {
      ctx.fillStyle = opts.padding ?? '#cfcfcf';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
    const src = sources.get(cell.cutNumber);
    if (src) ctx.drawImage(src, cell.inner.x, cell.inner.y, cell.inner.w, cell.inner.h);
    ctx.strokeRect(cell.x + lw / 2, cell.y + lw / 2, cell.w - lw, cell.h - lw);
    if (opts.labels) {
      const text = String(cell.index);
      ctx.font = `bold ${font}px sans-serif`;
      ctx.textBaseline = 'top';
      const pad = Math.round(font * 0.35);
      const tw = ctx.measureText(text).width;
      const bx = cell.inner.x + pad;
      const by = cell.inner.y + pad;
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + pad * 2, font + pad, Math.round(font / 4));
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, bx + pad, by + Math.round(pad / 2));
    }
  }
  return canvas;
}

/** 결과 격자 한 장을 칸(안쪽 영역)대로 잘라 컷 번호 → PNG로 돌려준다 */
export async function splitResult(result: Blob, layout: GridLayout): Promise<Map<number, Blob>> {
  const bmp = await createImageBitmap(result);
  try {
    const out = new Map<number, Blob>();
    for (const r of splitRects(layout, bmp.width, bmp.height)) {
      const c = document.createElement('canvas');
      c.width = r.w;
      c.height = r.h;
      c.getContext('2d')!.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      out.set(r.cutNumber, await canvasToBlob(c));
    }
    return out;
  } finally {
    bmp.close();
  }
}
