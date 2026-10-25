/** 컷 그림 읽기: 대표 후보 → 출력의 확정 컷 PNG → 썸네일 */

import { pngName } from '../describe/text';
import type { Cut } from '../model/types';
import { storage } from '../storage';
import type { Thumbnails } from '../state/store';
import type { SourceKind } from './plan';

export interface LoadedSource {
  kind: SourceKind;
  /** 읽은 곳(캐시 키) */
  key: string;
  /** 원본 파일 그대로(다시 인코딩하지 않는다) */
  blob: Blob | null;
  /** 미리보기용 주소(쓴 뒤 revoke) */
  url: string | null;
}

const none = (cut: Cut): LoadedSource => ({ kind: 'none', key: `none:${cut.number}`, blob: null, url: null });

async function readBlob(path: string): Promise<Blob | null> {
  const buf = await storage.backend.readBinary(path).catch(() => null);
  return buf ? new Blob([buf], { type: 'image/png' }) : null;
}

const make = (kind: SourceKind, key: string, blob: Blob): LoadedSource => ({ kind, key, blob, url: URL.createObjectURL(blob) });

/** 후보부터 차례로 시도한다. 대표 후보 파일이 없으면(지워졌으면) 다음 단계로 내려간다 */
export async function loadSource(cut: Cut, code: string, episodeNo: number, thumbnails: Thumbnails): Promise<LoadedSource> {
  const main = cut.generatedImages?.[0];
  if (main) {
    const b = await readBlob(main);
    if (b) return make('generated', main, b);
  }
  const outPath = `${storage.repository.outputFolder(code, episodeNo)}/${pngName(code, episodeNo, cut.number)}`;
  const out = await readBlob(outPath);
  if (out) return make('output', outPath, out);
  const thumb = thumbnails[cut.number];
  if (thumb) return make('thumbnail', `thumb:${cut.number}`, await (await fetch(thumb)).blob());
  return none(cut);
}

export function releaseSource(s: LoadedSource | undefined): void {
  if (s?.url) URL.revokeObjectURL(s.url);
}
