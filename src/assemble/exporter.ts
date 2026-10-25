/** NTT용 컷 그림 내보내기 → 출력/{코드}/{회차}/원고/{코드}_{회차}_{컷}.png */

import { pngName } from '../describe/text';
import type { Episode, Work } from '../model/types';
import { storage } from '../storage';
import { logAction } from '../storage/remote/service';
import type { LoadedSource } from './images';
import type { ExportPlan } from './plan';

export const ASSEMBLE_DIR = '원고';

export interface AssembleExportResult {
  folder: string;
  files: string[];
  warnings: string[];
}

/** 이전 내보내기에서 남은 컷 그림(이번에 빠진 컷)은 지우고 새로 쓴다 */
export async function exportCutImages(work: Work, episode: Episode, plan: ExportPlan, sources: Record<number, LoadedSource>, onProgress?: (msg: string) => void): Promise<AssembleExportResult> {
  if (!plan.items.length) throw new Error('내보낼 컷 그림이 없습니다');
  const repo = storage.repository;
  const folder = `${repo.outputFolder(work.code, episode.number)}/${ASSEMBLE_DIR}`;
  const old = await storage.backend.list(folder).catch(() => []);
  for (const f of old) if (f.kind === 'file' && f.name.endsWith('.png')) await storage.backend.remove(`${folder}/${f.name}`);
  const files: string[] = [];
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i];
    const blob = sources[it.number]?.blob;
    if (!blob) continue;
    onProgress?.(`${i + 1}/${plan.items.length}`);
    const name = pngName(work.code, episode.number, it.number);
    await repo.writeOutput(work.code, episode.number, `${ASSEMBLE_DIR}/${name}`, blob);
    files.push(name);
  }
  logAction('assemble', `${episode.number}화 컷 그림 ${files.length}장`, plan.warnings.length ? { warnings: plan.warnings.length } : null, work.code);
  return { folder, files, warnings: plan.warnings };
}
