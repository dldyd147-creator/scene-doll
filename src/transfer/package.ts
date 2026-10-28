/**
 * 이동 패키지(.scenedoll) 만들기·읽기·합치기. 저장소 백엔드(StorageBackend)만 알고 화면·Electron을 모른다.
 * 형식: zip. manifest.json + data/<작업 폴더와 같은 상대 경로>. 규칙은 scene-doll-spec.md '7단계'.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { StorageBackend } from '../storage/backend';
import { decideFile, isSafePath, isValidWorkCode, ownerOf, renameWorkPath, rewriteWorkCodeJson, suggestCode, type ConflictPolicy, type FileInfo } from './merge';

export const PACKAGE_FORMAT = 'scene-doll-package';
export const PACKAGE_VERSION = 1;
export const PACKAGE_EXT = 'scenedoll';

export interface ExportOptions {
  /** 내보낼 작품 코드들 */
  works: string[];
  /** 공용 라이브러리(씬·포즈·손포즈·소품) */
  shared: boolean;
  /** 생성 후보 PNG */
  generated: boolean;
  /** 출력 PNG */
  output: boolean;
}

export interface ManifestWork {
  code: string;
  name: string;
  updatedAt: string;
  episodes: number;
  characters: number;
  files: number;
  bytes: number;
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  includes: { shared: boolean; generated: boolean; output: boolean };
  works: ManifestWork[];
  shared: { scenes: number; poses: number; handPoses: number; props: number };
  files: number;
  bytes: number;
}

export type Progress = (done: number, total: number, label: string) => void;

const textExt = /\.(json|md|txt)$/i;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

/** 안에 넣지 않는 파일(키·토큰이 들어갈 수 있는 연결 설정) */
export function isExcluded(path: string): boolean {
  return /(^|\/)연결설정\.json$/.test(path) || /(^|\/)keys?\.json$/i.test(path);
}

async function walk(backend: StorageBackend, dir: string, out: string[]): Promise<void> {
  const items = await backend.list(dir).catch(() => []);
  for (const it of items) {
    const p = dir ? `${dir}/${it.name}` : it.name;
    if (it.kind === 'directory') await walk(backend, p, out);
    else out.push(p);
  }
}

/** 내보낼 파일 경로 목록 */
export async function collectPaths(backend: StorageBackend, opts: ExportOptions): Promise<string[]> {
  const out: string[] = [];
  for (const code of opts.works) {
    await walk(backend, `작품/${code}`, out);
    if (opts.generated) await walk(backend, `생성/${code}`, out);
    if (opts.output) await walk(backend, `출력/${code}`, out);
  }
  if (opts.shared) await walk(backend, '공용', out);
  return out.filter((p) => !isExcluded(p));
}

async function readBytes(backend: StorageBackend, path: string): Promise<Uint8Array | null> {
  if (textExt.test(path)) {
    const t = await backend.readText(path);
    return t === null ? null : enc.encode(t);
  }
  const b = await backend.readBinary(path);
  return b ? new Uint8Array(b) : null;
}

function jsonField(bytes: Uint8Array, key: string): unknown {
  try {
    return (JSON.parse(dec.decode(bytes)) as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** 패키지를 만든다. 반환한 data가 .scenedoll 파일 내용이다 */
export async function buildPackage(backend: StorageBackend, opts: ExportOptions, progress?: Progress, app = 'scene-doll'): Promise<{ data: Uint8Array; manifest: PackageManifest }> {
  const paths = await collectPaths(backend, opts);
  const zippable: Zippable = {};
  const works = new Map<string, ManifestWork>();
  const shared = { scenes: 0, poses: 0, handPoses: 0, props: 0 };
  let bytes = 0;
  let files = 0;
  for (const [i, path] of paths.entries()) {
    progress?.(i, paths.length, path);
    const data = await readBytes(backend, path);
    if (!data) continue;
    // PNG·GLB는 이미 압축돼 있어 저장만(빠름), 텍스트는 압축
    zippable[`data/${path}`] = [data, { level: textExt.test(path) ? 6 : 0 }];
    bytes += data.length;
    files++;
    const s = path.split('/');
    if (s[0] === '작품' || s[0] === '생성' || s[0] === '출력') {
      let w = works.get(s[1]);
      if (!w) works.set(s[1], (w = { code: s[1], name: s[1], updatedAt: '', episodes: 0, characters: 0, files: 0, bytes: 0 }));
      w.files++;
      w.bytes += data.length;
      if (path === `작품/${s[1]}/작품.json`) {
        w.name = String(jsonField(data, 'name') ?? s[1]);
        w.updatedAt = String(jsonField(data, 'updatedAt') ?? '');
      }
      if (s[0] === '작품' && s[2] === '회차' && s[4] === '회차.json') w.episodes++;
      if (s[0] === '작품' && s[2] === '캐릭터' && s.length === 4 && s[3].endsWith('.json') && jsonField(data, 'temporary') !== true) w.characters++;
    } else if (s[0] === '공용' && s[2]?.endsWith('.json')) {
      if (s[1] === '씬') shared.scenes++;
      else if (s[1] === '포즈') shared.poses++;
      else if (s[1] === '손포즈') shared.handPoses++;
      else if (s[1] === '소품') shared.props++;
    }
  }
  const manifest: PackageManifest = {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    app,
    includes: { shared: opts.shared, generated: opts.generated, output: opts.output },
    works: [...works.values()].sort((a, b) => a.code.localeCompare(b.code)),
    shared,
    files,
    bytes,
  };
  zippable['manifest.json'] = [enc.encode(JSON.stringify(manifest, null, 2)), { level: 6 }];
  progress?.(paths.length, paths.length, '압축');
  return { data: zipSync(zippable), manifest };
}

export interface OpenedPackage {
  manifest: PackageManifest;
  /** 상대 경로(data/ 제외) → 내용 */
  files: Map<string, Uint8Array>;
}

export class PackageError extends Error {}

/** zip을 읽어 검증한다. 형식·버전이 맞지 않거나 위험한 경로가 있으면 PackageError */
export function openPackage(data: Uint8Array): OpenedPackage {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new PackageError('씬 돌 이동 파일(.scenedoll)이 아니거나 손상된 파일입니다');
  }
  const mf = entries['manifest.json'];
  if (!mf) throw new PackageError('manifest.json이 없습니다. 씬 돌 이동 파일이 아닙니다');
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(dec.decode(mf)) as PackageManifest;
  } catch {
    throw new PackageError('manifest.json을 읽지 못했습니다');
  }
  if (manifest.format !== PACKAGE_FORMAT) throw new PackageError('씬 돌 이동 파일이 아닙니다');
  if (typeof manifest.version !== 'number' || manifest.version > PACKAGE_VERSION) throw new PackageError(`더 새로운 버전(${manifest.version})으로 만든 파일입니다. 프로그램을 업데이트하세요`);
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('data/') || name.endsWith('/')) continue;
    const rel = name.slice(5);
    if (!isSafePath(rel)) throw new PackageError(`안전하지 않은 경로가 들어 있어 불러오지 않습니다: ${name}`);
    if (isExcluded(rel)) continue;
    files.set(rel, bytes);
  }
  return { manifest, files };
}

export interface ImportSummary {
  works: Array<ManifestWork & { conflict: boolean }>;
  shared: PackageManifest['shared'];
  characters: number;
  files: number;
  bytes: number;
  exportedAt: string;
}

/** 불러오기 전 요약: 매니페스트가 아니라 실제 들어 있는 파일에서 센다 */
export async function summarizePackage(backend: StorageBackend, pkg: OpenedPackage): Promise<ImportSummary> {
  const works = new Map<string, ManifestWork>();
  const shared = { scenes: 0, poses: 0, handPoses: 0, props: 0 };
  let bytes = 0;
  for (const [path, data] of pkg.files) {
    bytes += data.length;
    const s = path.split('/');
    if (s[0] === '작품' || s[0] === '생성' || s[0] === '출력') {
      if (!isValidWorkCode(s[1])) continue;
      let w = works.get(s[1]);
      if (!w) works.set(s[1], (w = { code: s[1], name: s[1], updatedAt: '', episodes: 0, characters: 0, files: 0, bytes: 0 }));
      w.files++;
      w.bytes += data.length;
      if (path === `작품/${s[1]}/작품.json`) {
        w.name = String(jsonField(data, 'name') ?? s[1]);
        w.updatedAt = String(jsonField(data, 'updatedAt') ?? '');
      }
      if (s[0] === '작품' && s[2] === '회차' && s[4] === '회차.json') w.episodes++;
      if (s[0] === '작품' && s[2] === '캐릭터' && s.length === 4 && s[3].endsWith('.json') && jsonField(data, 'temporary') !== true) w.characters++;
    } else if (s[0] === '공용' && s[2]?.endsWith('.json')) {
      if (s[1] === '씬') shared.scenes++;
      else if (s[1] === '포즈') shared.poses++;
      else if (s[1] === '손포즈') shared.handPoses++;
      else if (s[1] === '소품') shared.props++;
    }
  }
  const list: ImportSummary['works'] = [];
  for (const w of [...works.values()].sort((a, b) => a.code.localeCompare(b.code))) list.push({ ...w, conflict: await backend.exists(`작품/${w.code}/작품.json`) });
  return { works: list, shared, characters: list.reduce((n, w) => n + w.characters, 0), files: pkg.files.size, bytes, exportedAt: pkg.manifest.exportedAt };
}

export interface ImportChoice {
  /** 겹치는 작품의 처리. 겹치지 않으면 무시된다 */
  policy: ConflictPolicy;
  /** rename일 때 새 코드 */
  newCode?: string;
}

export interface ImportOptions {
  /** 불러올 작품(패키지 안의 코드). 없는 코드는 가져오지 않는다 */
  choices: Record<string, ImportChoice>;
  /** 공용 라이브러리 합치기 사용 여부 */
  shared: boolean;
}

export interface ImportResult {
  added: number;
  updated: number;
  kept: number;
  skippedWorks: string[];
  renamed: Array<{ from: string; to: string }>;
}

/** 각 작품의 기본 선택: 겹치면 합치기 */
export function defaultChoices(summary: ImportSummary, usedCodes: ReadonlySet<string>): Record<string, ImportChoice> {
  const out: Record<string, ImportChoice> = {};
  for (const w of summary.works) out[w.code] = { policy: 'merge', newCode: w.conflict ? suggestCode(w.code, usedCodes) : undefined };
  return out;
}

async function currentInfo(backend: StorageBackend, path: string): Promise<FileInfo> {
  if (!(await backend.exists(path))) return { exists: false };
  if (!path.endsWith('.json')) return { exists: true };
  try {
    const t = await backend.readText(path);
    const u = t ? (JSON.parse(t) as { updatedAt?: unknown }).updatedAt : undefined;
    return { exists: true, updatedAt: typeof u === 'string' ? u : undefined };
  } catch {
    return { exists: true };
  }
}

function packageInfo(path: string, data: Uint8Array): FileInfo {
  if (!path.endsWith('.json')) return { exists: true };
  const u = jsonField(data, 'updatedAt');
  return { exists: true, updatedAt: typeof u === 'string' ? u : undefined };
}

/** 합치기를 실제로 적용한다. 기존 파일은 지우지 않는다 */
export async function applyImport(backend: StorageBackend, pkg: OpenedPackage, opts: ImportOptions, progress?: Progress): Promise<ImportResult> {
  const result: ImportResult = { added: 0, updated: 0, kept: 0, skippedWorks: [], renamed: [] };
  const used = new Set<string>();
  for (const e of await backend.list('작품').catch(() => [])) used.add(e.name);
  for (const [code, c] of Object.entries(opts.choices)) {
    if (c.policy === 'rename') {
      const to = (c.newCode ?? '').toUpperCase();
      if (!isValidWorkCode(to) || used.has(to) || Object.entries(opts.choices).some(([k, o]) => k !== code && o.policy === 'rename' && o.newCode?.toUpperCase() === to)) throw new PackageError(`${code}의 새 코드(${c.newCode ?? ''})가 올바르지 않거나 이미 있습니다`);
    }
  }
  // JSON 먼저(주인의 승패를 알아야 보조 파일을 정한다)
  const ordered = [...pkg.files.keys()].sort((a, b) => Number(b.endsWith('.json')) - Number(a.endsWith('.json')) || a.localeCompare(b));
  const won = new Map<string, boolean>();
  const skipped = new Set<string>();
  let i = 0;
  for (const src of ordered) {
    progress?.(i++, ordered.length, src);
    const s = src.split('/');
    let policy: ConflictPolicy;
    let dest = src;
    let rename: { from: string; to: string } | null = null;
    if (s[0] === '작품' || s[0] === '생성' || s[0] === '출력') {
      const choice = opts.choices[s[1]];
      if (!choice) continue; // 선택하지 않은 작품
      const exists = await backend.exists(`작품/${s[1]}/작품.json`);
      policy = exists ? choice.policy : 'merge';
      if (exists && policy === 'skip') {
        skipped.add(s[1]);
        continue;
      }
      if (exists && policy === 'rename') {
        rename = { from: s[1], to: (choice.newCode ?? '').toUpperCase() };
        dest = renameWorkPath(src, rename.from, rename.to);
      }
    } else if (s[0] === '공용') {
      if (!opts.shared) continue;
      policy = 'merge';
    } else continue; // 알 수 없는 최상위는 가져오지 않는다
    const data = pkg.files.get(src)!;
    const cur = await currentInfo(backend, dest);
    const ownerSrc = ownerOf(src);
    const ownerDest = ownerSrc ? (rename ? renameWorkPath(ownerSrc, rename.from, rename.to) : ownerSrc) : null;
    const ownerWon = ownerDest ? won.get(ownerDest) : undefined;
    const action = decideFile(packageInfo(src, data), cur, policy, ownerWon);
    if (src.endsWith('.json')) won.set(dest, action !== 'keep');
    if (action === 'keep') {
      result.kept++;
      continue;
    }
    if (dest.endsWith('.json')) {
      let text = dec.decode(data);
      if (rename) text = rewriteWorkCodeJson(text, rename.from, rename.to);
      await backend.writeText(dest, text);
    } else {
      const copy = new Uint8Array(data);
      await backend.writeBinary(dest, copy.buffer as ArrayBuffer);
    }
    if (action === 'copy-new') result.added++;
    else result.updated++;
    if (rename && !result.renamed.some((r) => r.from === rename!.from)) result.renamed.push(rename);
  }
  result.skippedWorks = [...skipped];
  progress?.(ordered.length, ordered.length, '완료');
  return result;
}
