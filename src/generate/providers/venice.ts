import { GenError } from '../engine';
import { blobOf, errorMessage, networkError, nearestRatio, statusError, type ProviderRequest, type ProviderResult } from './common';

const BASE = 'https://api.venice.ai/api/v1';
export const VENICE_RATIOS: Array<[string, number]> = [['1:1', 1], ['3:2', 3 / 2], ['16:9', 16 / 9], ['21:9', 21 / 9], ['9:16', 9 / 16], ['2:3', 2 / 3], ['3:4', 3 / 4], ['4:3', 4 / 3], ['4:5', 4 / 5]];

/**
 * 베니스 이미지 편집(POST /image/multi-edit): 첫 장이 바탕 그림, 나머지는 함께 넣는 이미지. 한 번에 한 장이라 n번 나란히 보낸다.
 * 안전·수위 관련 값은 보내지 않는다(베니스 기본 동작). 422는 생성 거부로 분류한다.
 */
export async function veniceGenerate(req: ProviderRequest): Promise<ProviderResult> {
  const f = req.fetchFn ?? fetch;
  if (!req.images.length) throw new GenError('request', '베니스 편집에는 이미지가 한 장 이상 필요합니다');
  const ratio = nearestRatio(req.size, VENICE_RATIOS);
  const one = async (): Promise<{ data: Uint8Array; mime: string }> => {
    const fd = new FormData();
    fd.set('modelId', req.model);
    fd.set('prompt', req.prompt);
    for (const img of req.images) fd.append('images', blobOf(img), img.name);
    if (ratio) fd.set('aspect_ratio', ratio);
    let res: Response;
    try {
      res = await f(`${BASE}/image/multi-edit`, { method: 'POST', headers: { Authorization: `Bearer ${req.apiKey}` }, body: fd, signal: req.signal });
    } catch (e) {
      throw networkError(e, req.signal, '베니스');
    }
    if (!res.ok) {
      const msg = errorMessage(await res.text(), res.status);
      if (res.status === 422) throw new GenError('refused', `생성 거부: ${msg}`);
      throw statusError(res.status, msg, '베니스');
    }
    return { data: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('Content-Type') || 'image/png' };
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.max(1, req.n) }, one));
  const ok = settled.filter((s): s is PromiseFulfilledResult<{ data: Uint8Array; mime: string }> => s.status === 'fulfilled').map((s) => s.value);
  if (!ok.length) throw (settled.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason;
  return { images: ok.map((o) => o.data), mime: ok[0].mime, model: `venice:${req.model}` };
}
