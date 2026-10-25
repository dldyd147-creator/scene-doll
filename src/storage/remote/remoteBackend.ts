import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageBackend } from '../backend';

const BUCKET = 'scene-doll';

interface FileRow {
  path: string;
  kind: 'text' | 'bin';
  content: string | null;
  object_key: string | null;
}

/** 경로가 dir 바로 아래인 항목 이름과 종류(평평한 경로 목록에서 디렉터리 구조를 만든다) */
export function childrenOf(paths: string[], dir: string): Array<{ name: string; kind: 'file' | 'directory' }> {
  const prefix = dir ? `${dir.replace(/\/+$/, '')}/` : '';
  const out = new Map<string, 'file' | 'directory'>();
  for (const p of paths) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const i = rest.indexOf('/');
    if (i < 0) out.set(rest, 'file');
    else if (out.get(rest.slice(0, i)) !== 'directory') out.set(rest.slice(0, i), 'directory');
  }
  return [...out.entries()].map(([name, kind]) => ({ name, kind }));
}

function newObjectKey(): string {
  const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `bin/${raw.slice(0, 4)}/${raw}`;
}

export function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'glb' ? 'model/gltf-binary' : 'application/octet-stream';
}

/** 오류 메시지를 사람이 읽을 수 있게 */
function fail(what: string, error: { message?: string } | null): never {
  throw new Error(`공유 저장소 ${what} 실패: ${error?.message ?? '알 수 없는 오류'}`);
}

/**
 * 공유 저장소 백엔드(Supabase). 경로 → 파일 모델을 그대로 지킨다:
 * 텍스트(JSON·md)는 files 표의 content, 이진 파일은 scene-doll 버킷의 불투명한 객체(files.object_key)에 둔다.
 */
export class RemoteBackend implements StorageBackend {
  readonly kind = 'remote' as const;

  constructor(
    private readonly sb: SupabaseClient,
    private readonly userEmail: string | null,
  ) {}

  get label(): string {
    return this.userEmail ? `공유 · ${this.userEmail}` : '공유 저장소';
  }

  private async row(path: string): Promise<FileRow | null> {
    const { data, error } = await this.sb.from('files').select('path,kind,content,object_key').eq('path', path).maybeSingle();
    if (error) fail('읽기', error);
    return (data as FileRow | null) ?? null;
  }

  async readText(path: string): Promise<string | null> {
    const r = await this.row(path);
    return r && r.kind === 'text' ? (r.content ?? '') : null;
  }

  async writeText(path: string, text: string): Promise<void> {
    const { error } = await this.sb.from('files').upsert({ path, kind: 'text', content: text, object_key: null, size: text.length, updated_by_email: this.userEmail }, { onConflict: 'path' });
    if (error) fail('쓰기', error);
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const r = await this.row(path);
    if (!r || r.kind !== 'bin' || !r.object_key) return null;
    const { data, error } = await this.sb.storage.from(BUCKET).download(r.object_key);
    if (error || !data) return null;
    return data.arrayBuffer();
  }

  async writeBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeOf(path) });
    const existing = await this.row(path);
    const key = existing?.object_key ?? newObjectKey();
    const up = await this.sb.storage.from(BUCKET).upload(key, blob, { upsert: true, contentType: blob.type || mimeOf(path) });
    if (up.error) fail('파일 올리기', up.error);
    const { error } = await this.sb.from('files').upsert({ path, kind: 'bin', content: null, object_key: key, size: blob.size, updated_by_email: this.userEmail }, { onConflict: 'path' });
    if (error) fail('쓰기', error);
  }

  async list(dir: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> {
    const clean = dir.replace(/\/+$/, '');
    const { data, error } = await this.sb.from('files').select('path').like('path', clean ? `${clean}/%` : '%');
    if (error) fail('목록', error);
    return childrenOf(((data ?? []) as Array<{ path: string }>).map((r) => r.path), clean);
  }

  async remove(path: string): Promise<void> {
    const clean = path.replace(/\/+$/, '');
    const { data, error } = await this.sb.from('files').select('path,object_key').or(`path.eq.${clean},path.like.${clean}/%`);
    if (error) fail('지우기', error);
    const rows = ((data ?? []) as Array<{ path: string; object_key: string | null }>).filter((r) => r.path === clean || r.path.startsWith(`${clean}/`));
    if (!rows.length) return;
    const keys = rows.map((r) => r.object_key).filter((k): k is string => !!k);
    if (keys.length) await this.sb.storage.from(BUCKET).remove(keys);
    const del = await this.sb.from('files').delete().in('path', rows.map((r) => r.path));
    if (del.error) fail('지우기', del.error);
  }

  async exists(path: string): Promise<boolean> {
    const clean = path.replace(/\/+$/, '');
    const { data, error } = await this.sb.from('files').select('path').or(`path.eq.${clean},path.like.${clean}/%`).limit(1);
    if (error) fail('확인', error);
    return ((data ?? []) as Array<{ path: string }>).some((r) => r.path === clean || r.path.startsWith(`${clean}/`));
  }
}
