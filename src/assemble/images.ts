/** 컷 그림 읽기: 대표 후보 → 출력의 확정 컷 PNG → 썸네일 */

import { pngName } from '../describe/text';
import type { Cut } from '../model/types';
import { storage } from '../storage';
import type { Thumbnails } from '../state/store';
import type { SourceInfo, SourceKind } from './plan';

export interface LoadedSource {
  kind: SourceKind;
  /** 읽은 곳(캐시 키) */
  key: string;
  bitmap: ImageBitmap | null;
}

export const infoOf = (s: LoadedSource): SourceInfo => ({ kind: s.kind, width: s.bitmap?.width ?? 0, height: s.bitmap?.height ?? 0 });

async function bitmapFrom(blob: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function readBitmap(path: string): Promise<ImageBitmap | null> {
  const buf = await storage.backend.readBinary(path).catch(() => null);
  return buf ? bitmapFrom(new Blob([buf], { type: 'image/png' })) : null;
}

/** 후보부터 차례로 시도한다. 대표 후보 파일이 없으면(지워졌으면) 다음 단계로 내려간다 */
export async function loadSource(cut: Cut, code: string, episodeNo: number, thumbnails: Thumbnails): Promise<LoadedSource> {
  const main = cut.generatedImages?.[0];
  if (main) {
    const bmp = await readBitmap(main);
    if (bmp) return { kind: 'generated', key: main, bitmap: bmp };
  }
  const outPath = `${storage.repository.outputFolder(code, episodeNo)}/${pngName(code, episodeNo, cut.number)}`;
  const out = await readBitmap(outPath);
  if (out) return { kind: 'output', key: outPath, bitmap: out };
  const thumb = thumbnails[cut.number];
  if (thumb) {
    const bmp = await bitmapFrom(await (await fetch(thumb)).blob());
    if (bmp) return { kind: 'thumbnail', key: `thumb:${cut.number}`, bitmap: bmp };
  }
  return { kind: 'none', key: `none:${cut.number}`, bitmap: null };
}
