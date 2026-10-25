import type { StorageBackend } from '../backend';

const TEXT_EXT = new Set(['json', 'md', 'txt', 'csv']);

/** 확장자로 텍스트/이진 구분 */
export function isTextPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXT.has(ext);
}

export interface SyncProgress {
  copied: number;
  skipped: number;
  failed: string[];
  current: string;
}

/** dir 아래 모든 파일 경로(재귀) */
export async function walk(backend: StorageBackend, dir: string): Promise<string[]> {
  const out: string[] = [];
  const items = await backend.list(dir);
  for (const it of items) {
    const p = `${dir}/${it.name}`;
    if (it.kind === 'directory') out.push(...(await walk(backend, p)));
    else out.push(p);
  }
  return out;
}

/**
 * 한 백엔드의 폴더를 다른 백엔드로 복사한다(작업 폴더 → 공유 저장소 올리기, 반대도 같다).
 * overwrite=false면 이미 있는 파일은 건너뛴다. 진행은 onProgress로 알린다
 */
export async function copyTree(src: StorageBackend, dst: StorageBackend, dir: string, opts: { overwrite?: boolean; onProgress?: (p: SyncProgress) => void; signal?: { cancelled: boolean } } = {}): Promise<SyncProgress> {
  const progress: SyncProgress = { copied: 0, skipped: 0, failed: [], current: '' };
  const files = await walk(src, dir);
  for (const path of files) {
    if (opts.signal?.cancelled) break;
    progress.current = path;
    opts.onProgress?.({ ...progress });
    try {
      if (!opts.overwrite && (await dst.exists(path))) {
        progress.skipped++;
        continue;
      }
      if (isTextPath(path)) {
        const t = await src.readText(path);
        if (t === null) throw new Error('읽을 수 없음');
        await dst.writeText(path, t);
      } else {
        const b = await src.readBinary(path);
        if (!b) throw new Error('읽을 수 없음');
        await dst.writeBinary(path, b);
      }
      progress.copied++;
    } catch (e) {
      progress.failed.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  progress.current = '';
  opts.onProgress?.({ ...progress });
  return progress;
}
