import { GenError } from '../engine';
import { bytesToBase64 } from './bytes';
import { defaultSleep, errorMessage, networkError, nearestRatio, parseWxH, statusError, type ProviderRequest, type ProviderResult } from './common';

/** docs.bfl.ml flux-3-image 요청 문서(2026-10-28)의 aspect_ratio 목록 */
export const BFL_RATIOS: Array<[string, number]> = [['21:9', 21 / 9], ['2:1', 2], ['16:9', 16 / 9], ['3:2', 3 / 2], ['7:5', 7 / 5], ['4:3', 4 / 3], ['5:4', 5 / 4], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['5:7', 5 / 7], ['2:3', 2 / 3], ['9:16', 9 / 16], ['1:2', 1 / 2], ['9:21', 9 / 21]];
export const BFL_ENDPOINT = 'https://api.bfl.ai/v1/flux-3-image';
export const BFL_MAX_IMAGES = 10;
const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** 픽셀 면적 → resolution 단계(768sq≈0.59MP, 1k≈1MP, 1.5k≈2MP, 2k≈4MP, 4k≈16MP) */
export function bflResolution(size: string): string {
  const d = parseWxH(size);
  if (!d) return '1k';
  const mp = (d.w * d.h) / 1_000_000;
  if (mp <= 0.7) return '768sq';
  if (mp <= 1.4) return '1k';
  if (mp <= 2.8) return '1.5k';
  if (mp <= 6) return '2k';
  return '4k';
}

/** 요청 본문. safety_tolerance는 보내지 않는다(서비스 기본값). grounding은 끈다(외부 이미지에 끌리지 않게) */
export function bflBody(req: Pick<ProviderRequest, 'prompt' | 'images' | 'size'>): Record<string, unknown> {
  return {
    prompt: req.prompt,
    images: req.images.map((i) => bytesToBase64(i.data)),
    aspect_ratio: nearestRatio(req.size, BFL_RATIOS) ?? 'auto',
    resolution: bflResolution(req.size),
    grounding: false,
  };
}

interface PollResult {
  status?: string;
  result?: { sample?: string };
  details?: unknown;
}

async function one(req: ProviderRequest): Promise<{ data: Uint8Array; mime: string; cost: number | null }> {
  const f = req.fetchFn ?? fetch;
  const sleep = req.sleep ?? defaultSleep;
  const headers = { 'x-key': req.apiKey };
  let submit: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      submit = await f(BFL_ENDPOINT, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(bflBody(req)), signal: req.signal });
    } catch (e) {
      throw networkError(e, req.signal, 'BFL');
    }
    if (submit.status !== 429) break;
    await sleep(2000 * 2 ** attempt, req.signal);
  }
  const submitRes = submit!;
  const submitText = await submitRes.text();
  if (!submitRes.ok) {
    const msg = errorMessage(submitText, submitRes.status);
    if (submitRes.status === 422 && /moderat|safety|content/i.test(msg)) throw new GenError('refused', `생성 거부: ${msg}`);
    throw statusError(submitRes.status, msg, 'BFL');
  }
  let task: { id?: string; polling_url?: string; cost?: number | null };
  try {
    task = JSON.parse(submitText);
  } catch {
    throw new GenError('server', `BFL 응답을 읽지 못했습니다: ${submitText.slice(0, 200)}`);
  }
  if (!task.polling_url) throw new GenError('server', 'BFL 응답에 polling_url이 없습니다');
  const started = Date.now();
  for (;;) {
    await sleep(POLL_MS, req.signal);
    if (Date.now() - started > POLL_TIMEOUT_MS) throw new GenError('server', 'BFL 생성이 5분 안에 끝나지 않았습니다');
    let res: Response;
    try {
      res = await f(task.polling_url, { headers, signal: req.signal });
    } catch (e) {
      throw networkError(e, req.signal, 'BFL');
    }
    const text = await res.text();
    if (!res.ok) throw statusError(res.status, errorMessage(text, res.status), 'BFL');
    let p: PollResult;
    try {
      p = JSON.parse(text);
    } catch {
      throw new GenError('server', 'BFL 상태 응답을 읽지 못했습니다');
    }
    const status = p.status ?? '';
    if (status === 'Ready') {
      const url = p.result?.sample;
      if (!url) throw new GenError('server', 'BFL 결과에 이미지 주소(result.sample)가 없습니다');
      // 결과 주소는 10분 뒤 만료되고 CORS가 없다 — 메인 프로세스에서 곧바로 내려받는다
      let img: Response;
      try {
        img = await f(url, { signal: req.signal });
      } catch (e) {
        throw networkError(e, req.signal, 'BFL 이미지 주소');
      }
      if (!img.ok) throw new GenError('server', `BFL 결과 이미지를 받지 못했습니다 (${img.status})`);
      return { data: new Uint8Array(await img.arrayBuffer()), mime: img.headers.get('Content-Type') || 'image/png', cost: typeof task.cost === 'number' ? task.cost : null };
    }
    if (status === 'Request Moderated' || status === 'Content Moderated') throw new GenError('refused', `생성 거부: BFL 안전 검사(${status})`);
    if (status === 'No Card Generated') throw new GenError('server', 'BFL이 이미지를 만들지 못했습니다(No Card Generated)');
    if (status === 'Error' || status === 'Failed') throw new GenError('server', `BFL 생성 실패: ${JSON.stringify(p.details ?? '').slice(0, 300)}`);
    if (status === 'Task not found') throw new GenError('server', 'BFL이 작업을 찾지 못했습니다(Task not found)');
    // Pending / Reasoning / Generating → 계속 기다린다
  }
}

/** BFL 직접 Flux 3. 후보 n장은 요청 n번을 병렬로 보낸다 */
export async function bflGenerate(req: ProviderRequest): Promise<ProviderResult> {
  if (!req.images.length) throw new GenError('request', '입력 이미지가 없습니다');
  if (req.images.length > BFL_MAX_IMAGES) throw new GenError('request', `BFL은 이미지를 최대 ${BFL_MAX_IMAGES}장까지 받습니다(${req.images.length}장)`);
  const settled = await Promise.allSettled(Array.from({ length: Math.max(1, req.n) }, () => one(req)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof one>>> => s.status === 'fulfilled').map((s) => s.value);
  if (!ok.length) throw (settled.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason;
  const costs = ok.map((o) => o.cost).filter((c): c is number => c !== null);
  return { images: ok.map((o) => o.data), mime: ok[0].mime, model: 'bfl:flux-3-image', costCredits: costs.length ? costs.reduce((a, b) => a + b, 0) : undefined };
}
