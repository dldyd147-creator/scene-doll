import type { Character, Cut, Episode, Work } from '../model/types';
import type { Document, Thumbnails } from '../state/store';
import { pad3, type StorageBackend } from './backend';

/** 기획서의 폴더 구조 */
export const paths = {
  worksDir: () => '작품',
  workDir: (code: string) => `작품/${code}`,
  work: (code: string) => `작품/${code}/작품.json`,
  characterDir: (code: string) => `작품/${code}/캐릭터`,
  character: (code: string, id: string) => `작품/${code}/캐릭터/${id}.json`,
  episodesDir: (code: string) => `작품/${code}/회차`,
  episodeDir: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}`,
  episode: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}/회차.json`,
  cutDir: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}/컷`,
  cut: (code: string, n: number, cutNo: number) => `작품/${code}/회차/${pad3(n)}/컷/${pad3(cutNo)}.json`,
  thumbnailDir: (code: string, n: number) => `작품/${code}/회차/${pad3(n)}/썸네일`,
  thumbnail: (code: string, n: number, cutNo: number) => `작품/${code}/회차/${pad3(n)}/썸네일/${pad3(cutNo)}.png`,
  outputDir: (code: string, n: number) => `출력/${code}/${pad3(n)}`,
  packageDir: (code: string, n: number) => `패키지/${code}/${pad3(n)}`,
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

  async loadWork(code: string): Promise<Work | null> {
    const t = await this.backend.readText(paths.work(code));
    return t ? (JSON.parse(t) as Work) : null;
  }

  async loadCharacters(code: string): Promise<Character[]> {
    const files = await this.backend.list(paths.characterDir(code));
    const out: Character[] = [];
    for (const f of files) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue;
      const t = await this.backend.readText(`${paths.characterDir(code)}/${f.name}`);
      if (t) out.push(JSON.parse(t) as Character);
    }
    return out;
  }

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

  async listWorks(): Promise<string[]> {
    const items = await this.backend.list(paths.worksDir());
    return items.filter((i) => i.kind === 'directory').map((i) => i.name).sort();
  }

  async listEpisodes(code: string): Promise<number[]> {
    const items = await this.backend.list(paths.episodesDir(code));
    return items
      .filter((i) => i.kind === 'directory')
      .map((i) => parseInt(i.name, 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  }
}
