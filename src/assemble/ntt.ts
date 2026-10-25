/** NTT 서버(/api/scene-doll)에 컷 그림 + 대사를 보내 CLIP 콘티(.clip 묶음 zip)를 받아 온다 */

import type { Cut, Episode, Work } from '../model/types';
import type { SourceKind } from './plan';

export interface NttMeta {
  title: string;
  code: string;
  episode: number;
  cuts: Array<{ number: number; aspect: number; scene: string; dialogue: Array<{ speaker: string; text: string; position: 'top' | 'bottom' }> }>;
}

/** 보낼 컷: 뺀 컷은 제외, 그림이 없어도 확정된 컷은 넣는다(NTT에서 파란 칸으로 나온다) */
export function clipCuts(cuts: Cut[], kinds: Record<number, SourceKind | undefined>, skip: number[]): Cut[] {
  return cuts.filter((c) => !skip.includes(c.number) && ((kinds[c.number] ?? 'none') !== 'none' || c.confirmed));
}

export function buildMeta(work: Work, episode: Episode, cuts: Cut[]): NttMeta {
  return {
    title: work.name,
    code: work.code,
    episode: episode.number,
    cuts: cuts.map((c) => ({
      number: c.number,
      aspect: c.aspect,
      scene: c.scriptNote ?? '',
      dialogue: (c.dialogue ?? []).filter((d) => d.text.trim()).map((d) => ({ speaker: d.speaker, text: d.text, position: d.position })),
    })),
  };
}

export class NttError extends Error {}

const base = (url: string) => url.trim().replace(/\/+$/, '');

async function failMessage(r: Response): Promise<string> {
  const body = (await r.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? `NTT 서버 오류(${r.status})`;
}

export interface MakeClipOptions {
  url: string;
  token: string;
  meta: NttMeta;
  images: Array<{ name: string; blob: Blob }>;
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  /** 진행을 묻는 간격(ms) */
  pollMs?: number;
}

/** 작업을 걸고 끝날 때까지 묻고 zip을 받는다 */
export async function makeClip(o: MakeClipOptions): Promise<Blob> {
  const f = o.fetchFn ?? fetch;
  const root = `${base(o.url)}/api/scene-doll`;
  const headers = { Authorization: `Bearer ${o.token.trim()}` };
  const form = new FormData();
  form.append('meta', JSON.stringify(o.meta));
  for (const im of o.images) form.append('images', im.blob, im.name);
  o.onProgress?.('NTT에 보내는 중…');
  let r: Response;
  try {
    r = await f(`${root}/clip`, { method: 'POST', headers, body: form, signal: o.signal });
  } catch {
    throw new NttError('NTT 서버에 연결하지 못했습니다. 주소와 인터넷 연결을 확인하세요.');
  }
  if (!r.ok) throw new NttError(await failMessage(r));
  const job = (await r.json()) as { id: string };
  for (;;) {
    await new Promise((res) => setTimeout(res, o.pollMs ?? 1500));
    if (o.signal?.aborted) throw new NttError('취소했습니다');
    const s = await f(`${root}/jobs/${job.id}`, { headers, signal: o.signal });
    if (!s.ok) throw new NttError(await failMessage(s));
    const st = (await s.json()) as { status: string; done: number; total: number; error: string };
    if (st.status === 'failed') throw new NttError(`CLIP을 만들지 못했습니다: ${st.error}`);
    o.onProgress?.(st.status === 'queued' ? 'NTT 서버 줄 서는 중…' : `CLIP 만드는 중 ${st.done}/${st.total}`);
    if (st.status === 'done') break;
  }
  const d = await f(`${root}/jobs/${job.id}/download`, { headers, signal: o.signal });
  if (!d.ok) throw new NttError(await failMessage(d));
  return d.blob();
}
