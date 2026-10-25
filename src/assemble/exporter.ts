/** 원고 내보내기: 전체 스트립 PNG · 슬라이스 PNG · 레이어 PSD → 출력/{코드}/{회차}/원고/ */

import type { Episode, Work } from '../model/types';
import { pad3 } from '../storage/backend';
import { storage } from '../storage';
import { logAction } from '../storage/remote/service';
import type { ResolvedBubble } from './bubbles';
import type { AssemblySettings } from './model';
import { SOURCE_LABEL, type Plan } from './plan';
import { drawBubbleShape, drawBubbleText, drawCut, drawCutBase, newCanvas, strokeWidth, type Drawable } from './render';

export const ASSEMBLE_DIR = '원고';
/** 브라우저 canvas와 PSD의 한계 */
const MAX_CANVAS_SIDE = 32767;
const MAX_CANVAS_AREA = 268_000_000;
const MAX_PSD_SIDE = 30000;

export interface AssembleExportResult {
  folder: string;
  stripFile: string;
  sliceFiles: string[];
  psdFile: string | null;
  /** PSD를 못 만든 이유 */
  psdNote: string | null;
  warnings: string[];
}

export interface AssembleExportInput {
  work: Work;
  episode: Episode;
  plan: Plan;
  settings: AssemblySettings;
  images: Record<number, Drawable | null>;
  onProgress?: (msg: string) => void;
}

const toBlob = (c: HTMLCanvasElement): Promise<Blob> => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 변환 실패'))), 'image/png'));

export const baseName = (work: Work, episode: Episode): string => `${work.code}_${pad3(episode.number)}`;

export async function exportAssembly(inp: AssembleExportInput): Promise<AssembleExportResult> {
  const { work, episode, plan, settings, images } = inp;
  const say = inp.onProgress ?? (() => undefined);
  const W = plan.layout.width;
  const H = plan.layout.height;
  if (!plan.items.length) throw new Error('조립할 컷이 없습니다');
  if (H > MAX_CANVAS_SIDE || W * H > MAX_CANVAS_AREA) throw new Error(`스트립이 너무 큽니다(${W}×${H}px). 폭이나 컷 수를 줄이세요`);
  const repo = storage.repository;
  const folder = `${repo.outputFolder(work.code, episode.number)}/${ASSEMBLE_DIR}`;
  const base = baseName(work, episode);
  const warnings = [...plan.warnings];

  // 1) 전체 스트립
  say('스트립 그리는 중…');
  const strip = newCanvas(W, H);
  const sctx = strip.getContext('2d')!;
  sctx.fillStyle = settings.background;
  sctx.fillRect(0, 0, W, H);
  for (const it of plan.items) drawCut(sctx, it, images[it.number] ?? null, W, settings.fontFamily);
  const stripName = `${base}_원고_전체.png`;
  await repo.writeOutput(work.code, episode.number, `${ASSEMBLE_DIR}/${stripName}`, await toBlob(strip));

  // 2) 슬라이스(이전 내보내기에서 남은 슬라이스는 지운다)
  const old = await storage.backend.list(folder).catch(() => []);
  for (const f of old) if (f.kind === 'file' && f.name.startsWith(`${base}_슬라이스_`)) await storage.backend.remove(`${folder}/${f.name}`);
  const sliceFiles: string[] = [];
  const digits = Math.max(2, String(plan.slices.length).length);
  for (let i = 0; i < plan.slices.length; i++) {
    const sl = plan.slices[i];
    say(`슬라이스 ${i + 1}/${plan.slices.length}`);
    const c = newCanvas(W, sl.y1 - sl.y0);
    c.getContext('2d')!.drawImage(strip, 0, sl.y0, W, sl.y1 - sl.y0, 0, 0, W, sl.y1 - sl.y0);
    const name = `${base}_슬라이스_${String(i + 1).padStart(digits, '0')}.png`;
    await repo.writeOutput(work.code, episode.number, `${ASSEMBLE_DIR}/${name}`, await toBlob(c));
    sliceFiles.push(name);
  }

  // 3) PSD
  let psdFile: string | null = null;
  let psdNote: string | null = null;
  if (H > MAX_PSD_SIDE) {
    psdNote = `PSD는 세로 ${MAX_PSD_SIDE}px까지라 ${H}px 스트립은 건너뛰었습니다`;
    warnings.push(psdNote);
  } else {
    try {
      say('PSD 만드는 중…');
      const bytes = await buildPsd(plan, settings, images);
      psdFile = `${base}_원고.psd`;
      await repo.writeOutput(work.code, episode.number, `${ASSEMBLE_DIR}/${psdFile}`, new Blob([bytes as BlobPart], { type: 'image/vnd.adobe.photoshop' }));
    } catch (e) {
      psdNote = `PSD 만들기 실패: ${e instanceof Error ? e.message : String(e)}`;
      warnings.push(psdNote);
    }
  }

  // 4) 구성 요약
  const summary = {
    width: W,
    height: H,
    settings,
    slices: plan.slices.map((s, i) => ({ file: sliceFiles[i], y0: s.y0, y1: s.y1, forced: s.forced })),
    cuts: plan.items.map((it) => ({ cut: it.number, y: it.y, height: it.height, image: SOURCE_LABEL[it.kind], bubbles: it.bubbles.filter((b) => !b.hidden).length })),
    warnings,
    exportedAt: new Date().toISOString(),
  };
  await repo.writeOutput(work.code, episode.number, `${ASSEMBLE_DIR}/${base}_원고_구성.json`, JSON.stringify(summary, null, 2));
  logAction('assemble', `${episode.number}화 슬라이스 ${sliceFiles.length}장${psdFile ? ' + PSD' : ''}`, { cuts: plan.items.length, height: H, warnings: warnings.length || undefined }, work.code);
  return { folder, stripFile: stripName, sliceFiles, psdFile, psdNote, warnings };
}

/** 레이어가 문서 밖으로 나가지 않게 자른 영역 */
function clampBox(x0: number, y0: number, x1: number, y1: number, W: number, H: number) {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(W, Math.ceil(x1));
  const bottom = Math.min(H, Math.ceil(y1));
  return { left, top, right, bottom, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/**
 * 레이어 PSD: 바닥 '배경', 컷마다 그룹 [그림, 말풍선 n(모양), 대사 n(글 레이어)].
 * 글 레이어에는 우리가 계산한 줄바꿈을 그대로 박고(\r), 같은 글을 미리 그린 비트맵도 넣는다.
 */
export async function buildPsd(plan: Plan, settings: AssemblySettings, images: Record<number, Drawable | null>): Promise<Uint8Array> {
  const { writePsd } = await import('ag-psd');
  const W = plan.layout.width;
  const H = plan.layout.height;
  const lw = strokeWidth(W);

  const bg = newCanvas(W, H);
  const bctx = bg.getContext('2d')!;
  bctx.fillStyle = settings.background;
  bctx.fillRect(0, 0, W, H);

  const groups = plan.items.map((it) => {
    const art = newCanvas(W, it.height);
    drawCutBase(art.getContext('2d')!, images[it.number] ?? null, W, it.height, `컷 ${it.number}`);
    const children: Array<Record<string, unknown>> = [{ name: `컷 ${pad3(it.number)} 그림`, top: it.y, left: 0, canvas: art }];
    it.bubbles.forEach((b, n) => {
      if (b.hidden) return;
      children.push(...bubbleLayers(b, n + 1, it.y, W, it.height, lw, settings));
    });
    return { name: `컷 ${pad3(it.number)}`, opened: true, children };
  });

  const psd = {
    width: W,
    height: H,
    children: [{ name: '배경', top: 0, left: 0, canvas: bg }, ...groups],
  };
  const buf = writePsd(psd as never, { generateThumbnail: true });
  return new Uint8Array(buf);
}

/** 말풍선 하나 → [모양 레이어, 글 레이어] (컷 좌표 → 문서 좌표는 cutY를 더한다) */
function bubbleLayers(b: ResolvedBubble, n: number, cutY: number, W: number, cutH: number, lw: number, settings: AssemblySettings): Array<Record<string, unknown>> {
  // 모양: 몸통 + 꼬리를 감싸는 영역
  const xs = [b.rect.x, b.rect.x + b.rect.w];
  const ys = [b.rect.y, b.rect.y + b.rect.h];
  if (b.tip) {
    xs.push(b.tip.x);
    ys.push(b.tip.y);
  }
  const pad = lw * 2;
  const box = clampBox(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad, W, cutH);
  const shape = newCanvas(box.w, box.h);
  const sctx = shape.getContext('2d')!;
  sctx.translate(-box.left, -box.top);
  drawBubbleShape(sctx, b, lw);

  // 글: 몸통 폭의 가운데 정렬 상자
  const m = b.metrics;
  const tl = clampBox(b.rect.x, b.rect.y + b.rect.h / 2 - m.textH / 2, b.rect.x + b.rect.w, b.rect.y + b.rect.h / 2 + m.textH / 2, W, cutH);
  const textCanvas = newCanvas(tl.w, tl.h);
  const tctx = textCanvas.getContext('2d')!;
  drawBubbleText(tctx, b, settings.fontFamily, '#111111', tl.left, tl.top);
  const text = m.lines.join('\r');
  return [
    { name: `말풍선 ${n}`, top: cutY + box.top, left: box.left, canvas: shape },
    {
      name: `대사 ${n}`,
      top: cutY + tl.top,
      left: tl.left,
      canvas: textCanvas,
      text: {
        text,
        transform: [1, 0, 0, 1, tl.left, cutY + tl.top],
        antiAlias: 'smooth',
        orientation: 'horizontal',
        shapeType: 'box',
        boxBounds: [0, 0, tl.w, tl.h],
        style: { font: { name: settings.psdFont }, fontSize: m.fontPx, autoLeading: false, leading: m.lineH, fillColor: { r: 17, g: 17, b: 17 }, fillFlag: true },
        paragraphStyle: { justification: 'center' },
      },
    },
  ];
}
