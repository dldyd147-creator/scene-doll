import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { cutBlock, episodeMarkdown, mdName, pngName } from '../describe/text';
import type { Cut } from '../model/types';
import { pad3 } from '../storage/backend';
import { storage } from '../storage';
import { useStore } from '../state/store';
import { saveNow } from './save';

export interface ExportProgress {
  done: number;
  total: number;
  current: string;
}

export interface ExportResult {
  folder: string;
  count: number;
  failed: string[];
  markdown: string;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png'));
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * 회차 일괄 출력: 확정된 컷을 원고 카메라·화면비 그대로 가로 width px로 렌더해
 * 출력/{작품코드}/{회차}/ 에 PNG + 컷별 JSON + 회차 설명 .md 를 쓴다.
 */
export async function exportEpisode(engine: Engine, onProgress: (p: ExportProgress) => void, signal?: { cancelled: boolean }): Promise<ExportResult> {
  const s = useStore.getState();
  const confirmed = s.cuts.filter((c) => c.confirmed);
  if (!confirmed.length) throw new Error('확정된 컷이 없습니다. 컷 확정(Ctrl+Enter) 뒤에 출력하세요.');
  const { work, episode, characters } = s;
  const width = work.output.width || 1024;
  const background = work.output.background;
  const repo = storage.repository;
  const folder = repo.outputFolder(work.code, episode.number);
  const failed: string[] = [];
  const blocks: string[] = [];
  const currentCut = s.currentCut();

  await saveNow();
  await engine.ensureTemplatesFor(confirmed);

  try {
    for (let i = 0; i < confirmed.length; i++) {
      if (signal?.cancelled) break;
      const cut: Cut = confirmed[i];
      onProgress({ done: i, total: confirmed.length, current: pngName(work.code, episode.number, cut.number) });
      engine.applyCut(cut);
      for (const rig of engine.dolls.values()) {
        rig.setCrosshair(work.output.crosshair);
        rig.setShading(work.output.shading && cut.light.shading);
        rig.setOutline(cut.outline);
      }
      await nextFrame();
      try {
        const canvas = engine.renderToCanvas(engine.manu.camera, width, width * cut.aspect, { background });
        const blob = await canvasToBlob(canvas);
        const analysis = analyzeCut(engine, cut, characters);
        const block = cutBlock(analysis, cut, work.code, episode.number);
        blocks.push(block);
        await repo.writeOutput(work.code, episode.number, pngName(work.code, episode.number, cut.number), blob);
        await repo.writeOutput(work.code, episode.number, `${work.code}_${pad3(episode.number)}_${pad3(cut.number)}.json`, JSON.stringify({ ...cut, desc: block }, null, 2));
      } catch (e) {
        failed.push(`${pad3(cut.number)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    // 원래 컷으로 복귀
    engine.applyCut(currentCut);
  }

  const markdown = episodeMarkdown(work, episode, confirmed, characters, blocks, width);
  await repo.writeOutput(work.code, episode.number, mdName(work.code, episode.number), markdown);
  onProgress({ done: confirmed.length, total: confirmed.length, current: '' });
  return { folder, count: confirmed.length - failed.length, failed, markdown };
}
