import type { Character, Cut, Episode, Work } from '../model/types';
import { createEpisode, normalizeCharacter } from '../model/defaults';
import type { Document, Thumbnails } from '../state/store';
import { pad3, type StorageBackend } from './backend';

/** 기획서의 폴더 구조 */
export const paths = {
  worksDir: () => '작품',
  workDir: (code: string) => `작품/${code}`,
  work: (code: string) => `작품/${code}/작품.json`,
  characterDir: (code: string) => `작품/${code}/캐릭터`,
  character: (code: string, id: string) => `작품/${code}/캐릭터/${id}.json`,
  characterFolder: (code: string, id: string) => `작품/${code}/캐릭터/${id}`,
  characterRefDir: (code: string, id: string) => `작품/${code}/캐릭터/${id}/레퍼런스`,
  characterRef: (code: string, id: string, file: string) => `작품/${code}/캐릭터/${id}/레퍼런스/${file}`,
  episodesDir: (code: string) => `작품/${code}/회차`,
  episodeDir: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}`,
  episode: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}/회차.json`,
  cutDir: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}/컷`,
  cut: (code: string, n: number, cutNo: number) => `작품/${code}/회차/${pad3(n)}/컷/${pad3(cutNo)}.json`,
  thumbnailDir: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}/썸네일`,
  thumbnail: (code: string, n: number, cutNo: number) => `작품/${code}/회차/${pad3(n)}/썸네일/${pad3(cutNo)}.png`,
  outputDir: (code: string, n: number) => `출력/${code}/${pad3(n)}`,
  packageDir: (code: string, n: number) => `패키지/${code}/${pad3(n)}`,
  packageCutDir: (code: string, n: number, cutNo: number) => `패키지/${code}/${pad3(n)}/${pad3(cutNo)}`,
  packageCharDir: (code: string, n: number) => `패키지/${code}/${pad3(n)}/캐릭터`,
};

const json = (v: unknown): string => JSON.stringify(v, null, 2);

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, data] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function bufferToDataUrl(buf: ArrayBuffer, mime = 'image/png'): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export interface EpisodeInfo {
  number: number;
  title?: string;
  cutCount: number;
  updatedAt: string;
}

/** 시작 화면(작품 관리)용 요약 */
export interface WorkInfo {
  work: Work;
  episodes: EpisodeInfo[];
  /** 등록 캐릭터(임시 제외) */
  characters: Character[];
}

/** 도메인 단위 저장·불러오기. 백엔드가 무엇이든 같은 폴더 구조로 쓴다 */
export class Repository {
  constructor(private backend: StorageBackend) {}

  async saveDocument(doc: Document): Promise<void> {
    const { work, episode, cuts, characters } = doc;
    const code = work.code;
    await this.backend.writeText(paths.work(code), json(work));
    const ep: Episode = { ...episode, workCode: code, cutOrder: cuts.map((c) => c.number) };
    await this.backend.writeText(paths.episode(code, ep.number), json(ep));
    for (const cut of cuts) await this.backend.writeText(paths.cut(code, ep.number, cut.number), json(cut));
    for (const ch of characters) await this.backend.writeText(paths.character(code, ch.id), json(ch));
    // 컷 목록에서 사라진 컷 파일 정리
    const existing = await this.backend.list(paths.cutDir(code, ep.number));
    const keep = new Set(cuts.map((c) => `${pad3(c.number)}.json`));
    for (const f of existing) if (f.kind === 'file' && f.name.endsWith('.json') && !keep.has(f.name)) await this.backend.remove(`${paths.cutDir(code, ep.number)}/${f.name}`);
  }

  /** 썸네일 저장. all=true면 전부 다시 쓰고 남는 파일은 지운다(번호가 바뀐 뒤) */
  async saveThumbnails(code: string, episodeNo: number, thumbnails: Thumbnails, numbers: number[], all: boolean): Promise<void> {
    const targets = all ? Object.keys(thumbnails).map(Number) : numbers;
    for (const n of targets) {
      const url = thumbnails[n];
      if (!url) continue;
      await this.backend.writeBinary(paths.thumbnail(code, episodeNo, n), dataUrlToBlob(url));
    }
    if (all) {
      const keep = new Set(Object.keys(thumbnails).map((n) => `${pad3(Number(n))}.png`));
      const existing = await this.backend.list(paths.thumbnailDir(code, episodeNo));
      for (const f of existing) if (f.kind === 'file' && !keep.has(f.name)) await this.backend.remove(`${paths.thumbnailDir(code, episodeNo)}/${f.name}`);
    }
  }

  async loadThumbnails(code: string, episodeNo: number, numbers: number[]): Promise<Thumbnails> {
    const out: Thumbnails = {};
    for (const n of numbers) {
      const buf = await this.backend.readBinary(paths.thumbnail(code, episodeNo, n));
      if (buf) out[n] = bufferToDataUrl(buf);
    }
    return out;
  }

  /** 출력 폴더에 파일 쓰기(PNG·md·json) */
  async writeOutput(code: string, episodeNo: number, name: string, data: string | Blob): Promise<void> {
    const path = `${paths.outputDir(code, episodeNo)}/${name}`;
    if (typeof data === 'string') await this.backend.writeText(path, data);
    else await this.backend.writeBinary(path, data);
  }

  outputFolder(code: string, episodeNo: number): string {
    return paths.outputDir(code, episodeNo);
  }

  /** AI 전달 패키지 폴더에 파일 쓰기. relPath는 패키지/{코드}/{회차}/ 아래 상대 경로 */
  async writePackage(code: string, episodeNo: number, relPath: string, data: string | Blob | ArrayBuffer): Promise<void> {
    const path = `${paths.packageDir(code, episodeNo)}/${relPath}`;
    if (typeof data === 'string') await this.backend.writeText(path, data);
    else await this.backend.writeBinary(path, data);
  }

  packageFolder(code: string, episodeNo: number): string {
    return paths.packageDir(code, episodeNo);
  }

  // ---------- 작품 ----------

  async loadWork(code: string): Promise<Work | null> {
    const t = await this.backend.readText(paths.work(code));
    return t ? (JSON.parse(t) as Work) : null;
  }

  async saveWork(work: Work): Promise<void> {
    await this.backend.writeText(paths.work(work.code), json(work));
  }

  /** 새 작품: 작품.json과 1화 회차 파일을 만든다 */
  async createWork(work: Work): Promise<void> {
    await this.saveWork(work);
    if (!(await this.backend.exists(paths.episode(work.code, 1)))) await this.saveEpisode(createEpisode(work.code, 1));
  }

  async deleteWork(code: string): Promise<void> {
    await this.backend.remove(paths.workDir(code));
  }

  async listWorks(): Promise<string[]> {
    const items = await this.backend.list(paths.worksDir());
    return items.filter((i) => i.kind === 'directory').map((i) => i.name).sort();
  }

  /** 시작 화면용: 모든 작품의 회차·캐릭터 요약 */
  async listWorksInfo(): Promise<WorkInfo[]> {
    const codes = await this.listWorks();
    const out: WorkInfo[] = [];
    for (const code of codes) {
      const work = await this.loadWork(code);
      if (!work) continue;
      const numbers = await this.listEpisodes(code);
      const episodes: EpisodeInfo[] = [];
      for (const n of numbers) {
        const ep = await this.loadEpisode(code, n);
        episodes.push({ number: n, title: ep?.title, cutCount: ep?.cutOrder.length ?? 0, updatedAt: ep?.updatedAt ?? work.updatedAt });
      }
      const characters = (await this.loadCharacters(code)).filter((c) => !c.temporary);
      out.push({ work, episodes, characters });
    }
    return out;
  }

  // ---------- 회차 ----------

  async loadEpisode(code: string, n: number): Promise<Episode | null> {
    const t = await this.backend.readText(paths.episode(code, n));
    return t ? (JSON.parse(t) as Episode) : null;
  }

  async saveEpisode(episode: Episode): Promise<void> {
    await this.backend.writeText(paths.episode(episode.workCode, episode.number), json(episode));
  }

  async deleteEpisode(code: string, n: number): Promise<void> {
    await this.backend.remove(paths.episodeDir(code, n));
  }

  async listEpisodes(code: string): Promise<number[]> {
    const items = await this.backend.list(paths.episodesDir(code));
    return items
      .filter((i) => i.kind === 'directory')
      .map((i) => parseInt(i.name, 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  }

  // ---------- 캐릭터 ----------

  async loadCharacters(code: string): Promise<Character[]> {
    const files = await this.backend.list(paths.characterDir(code));
    const out: Character[] = [];
    for (const f of files) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue;
      const t = await this.backend.readText(`${paths.characterDir(code)}/${f.name}`);
      if (t) out.push(normalizeCharacter(JSON.parse(t) as Partial<Character>));
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveCharacter(code: string, chr: Character): Promise<void> {
    await this.backend.writeText(paths.character(code, chr.id), json(chr));
  }

  /** 캐릭터 JSON과 레퍼런스 폴더를 함께 지운다 */
  async deleteCharacter(code: string, id: string): Promise<void> {
    await this.backend.remove(paths.character(code, id));
    await this.backend.remove(paths.characterFolder(code, id));
  }

  async saveReference(code: string, chrId: string, file: string, data: Blob | ArrayBuffer): Promise<void> {
    await this.backend.writeBinary(paths.characterRef(code, chrId, file), data);
  }

  async readReference(code: string, chrId: string, file: string): Promise<ArrayBuffer | null> {
    return this.backend.readBinary(paths.characterRef(code, chrId, file));
  }

  async deleteReference(code: string, chrId: string, file: string): Promise<void> {
    await this.backend.remove(paths.characterRef(code, chrId, file));
  }

  // ---------- 문서(회차 전체) ----------

  async loadDocument(code: string, episodeNo: number): Promise<Document | null> {
    const work = await this.loadWork(code);
    if (!work) return null;
    const epText = await this.backend.readText(paths.episode(code, episodeNo));
    const episode: Episode = epText ? (JSON.parse(epText) as Episode) : { workCode: code, number: episodeNo, cutOrder: [], updatedAt: work.updatedAt };
    const cuts: Cut[] = [];
    const order = episode.cutOrder.length
      ? episode.cutOrder
      : (await this.backend.list(paths.cutDir(code, episodeNo)))
          .filter((f) => f.kind === 'file' && f.name.endsWith('.json'))
          .map((f) => parseInt(f.name, 10))
          .filter((n) => !Number.isNaN(n))
          .sort((a, b) => a - b);
    for (const n of order) {
      const t = await this.backend.readText(paths.cut(code, episodeNo, n));
      if (t) cuts.push(JSON.parse(t) as Cut);
    }
    const characters = await this.loadCharacters(code);
    return { work, episode: { ...episode, cutOrder: cuts.map((c) => c.number) }, cuts, characters };
  }
}
