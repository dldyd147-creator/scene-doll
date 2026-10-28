/**
 * 작업 폴더 파일 입출력(메인 프로세스). 모든 경로는 '/'로 구분한 작업 폴더 기준 상대 경로이고,
 * 작업 폴더 밖으로 나가는 경로(.., 절대 경로, 드라이브 문자)는 거부한다. 쓰기는 임시 파일에 쓴 뒤 이름을 바꿔 중간에 끊겨도 파일이 깨지지 않는다.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class PathError extends Error {}

export function resolveInside(root: string, rel: string): string {
  const parts = rel.split('/').filter((p) => p.length > 0);
  if (rel.includes('\\') || rel.includes('\0') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/') || parts.some((p) => p === '..' || p === '.')) throw new PathError(`허용되지 않는 경로: ${rel}`);
  const abs = path.resolve(root, ...parts);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new PathError(`작업 폴더 밖의 경로: ${rel}`);
  return abs;
}

const TMP = '.tmp-write';

async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}${TMP}`;
  await fs.writeFile(tmp, data);
  try {
    await fs.rename(tmp, file);
  } catch {
    // 일부 환경(백신이 파일을 잡고 있을 때 등)에서 rename이 막히면 복사로 대신한다
    await fs.copyFile(tmp, file);
    await fs.rm(tmp, { force: true });
  }
}

export function createWorkFs(root: string) {
  return {
    async readText(rel: string): Promise<string | null> {
      try {
        return await fs.readFile(resolveInside(root, rel), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EISDIR') return null;
        throw e;
      }
    },
    async writeText(rel: string, text: string): Promise<void> {
      await atomicWrite(resolveInside(root, rel), text);
    },
    async readBinary(rel: string): Promise<Uint8Array | null> {
      try {
        return new Uint8Array(await fs.readFile(resolveInside(root, rel)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'EISDIR') return null;
        throw e;
      }
    },
    async writeBinary(rel: string, data: Uint8Array): Promise<void> {
      await atomicWrite(resolveInside(root, rel), data);
    },
    async list(rel: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
      try {
        const items = await fs.readdir(resolveInside(root, rel), { withFileTypes: true });
        return items.filter((d) => !d.name.endsWith(TMP) && (d.isFile() || d.isDirectory())).map((d) => ({ name: d.name, kind: d.isDirectory() ? ('directory' as const) : ('file' as const) }));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
        throw e;
      }
    },
    async remove(rel: string): Promise<void> {
      const abs = resolveInside(root, rel);
      if (abs === path.resolve(root)) throw new PathError('작업 폴더 자체는 지울 수 없습니다');
      await fs.rm(abs, { recursive: true, force: true });
    },
    async exists(rel: string): Promise<boolean> {
      try {
        await fs.access(resolveInside(root, rel));
        return true;
      } catch (e) {
        if (e instanceof PathError) throw e;
        return false;
      }
    },
  };
}

export type WorkFs = ReturnType<typeof createWorkFs>;
