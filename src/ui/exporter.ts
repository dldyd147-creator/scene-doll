import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { cutBlock, episodeMarkdown, mdName, passName, pngName } from '../describe/text';
import type { Cut } from '../model/types';
import { pad3 } from '../storage/backend';
import { storage } from '../storage';
import { useStore } from '../state/store';
import { buildCutPackage, characterFolders, writeCharacterSheets, writeCutPackage, writeEpisodeSummary, type CutPackage } from './packager';
import { useLibrary } from './library';
import { saveNow } from './save';

export interface ExportProgress {
  done: number;
  total: number;
  current: string;
}

export interface ExportResult {
  folder: string;
  /** AI 전달 패키지 폴더(추출했을 때) */
  packageFolder: string | null;
  count: number;
  failed: string[];
  markdown: string;
}

export interface ExportOptions {
  /** 출력과 함께 AI 전달 패키지(패키지/{작품}/{회차}/)도 추출 */
  withPackage: boolean;
  /** 컷별 출력 묶음(선화·깊이·색 마스크)도 함께 쓴다(출력 폴더 + 패키지 컷 폴더) */
  withBundle?: boolean;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png'));
}

/** 다음 프레임까지 기다린다. 탭이 뒤로 가 있으면 rAF가 멈추므로 시간 제한을 둔다 */
const nextFrame = () =>
  new Promise<void>((r) => {
    const t = window.setTimeout(r, 80);
    requestAnimationFrame(() => {
      window.clearTimeout(t);
      r();
    });
  });

/**
 * 회차 일괄 출력: 확정된 컷을 원고 카메라·화면비 그대로 가로 width px로 렌더해
 * 출력/{작품코드}/{회차}/ 에 PNG + 컷별 JSON + 회차 설명 .md 를 쓴다.
 * withPackage면 같은 렌더로 패키지/{작품코드}/{회차}/ 에 컷 폴더(PNG·패키지 JSON·프롬프트)·캐릭터 시트·회차 요약을 함께 쓴다.
 */
export async function exportEpisode(engine: Engine, onProgress: (p: ExportProgress) => void, signal?: { cancelled: boolean }, opts: ExportOptions = { withPackage: true }): Promise<ExportResult> {
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
  const packages: CutPackage[] = [];
  const folders = characterFolders(characters);
  const propAssets = useLibrary.getState().props ?? [];
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
        const block = cutBlock(analysis, cut, work.code, episode.number, propAssets);
        blocks.push(block);
        await repo.writeOutput(work.code, episode.number, pngName(work.code, episode.number, cut.number), blob);
        await repo.writeOutput(work.code, episode.number, `${work.code}_${pad3(episode.number)}_${pad3(cut.number)}.json`, JSON.stringify({ ...cut, desc: block }, null, 2));
        // 출력 묶음: 선화·깊이·색 마스크(같은 카메라·크기)
        const images: Partial<Record<'line' | 'depth' | 'mask', string>> = {};
        if (opts.withBundle) {
          for (const pass of ['line', 'depth', 'mask'] as const) {
            onProgress({ done: i, total: confirmed.length, current: `${pngName(work.code, episode.number, cut.number)} · ${pass}` });
            const passCanvas = engine.renderPass(engine.manu.camera, width, width * cut.aspect, pass);
            const passBlob = await canvasToBlob(passCanvas);
            const name = passName(work.code, episode.number, cut.number, pass);
            await repo.writeOutput(work.code, episode.number, name, passBlob);
            if (opts.withPackage) await repo.writePackage(work.code, episode.number, `${pad3(cut.number)}/${name}`, passBlob);
            images[pass] = name;
          }
        }
        if (opts.withPackage) {
          const pkg = buildCutPackage(work, episode, cut, analysis, characters, folders, width, block);
          if (opts.withBundle) pkg.images = { line: images.line!, depth: images.depth!, mask: images.mask! };
          await writeCutPackage(pkg, blob);
          packages.push(pkg);
        }
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
  let packageFolder: string | null = null;
  if (opts.withPackage && packages.length) {
    const used = new Set<string>();
    for (const p of packages) for (const c of p.characters) used.add(c.characterId);
    await writeCharacterSheets(work, episode, characters.filter((c) => used.has(c.id)), folders);
    await writeEpisodeSummary(work, episode, width, packages, characters, folders, markdown);
    packageFolder = repo.packageFolder(work.code, episode.number);
  }
  onProgress({ done: confirmed.length, total: confirmed.length, current: '' });
  return { folder, packageFolder, count: confirmed.length - failed.length, failed, markdown };
}
