/**
 * 이미지 생성 IPC 처리(메인 프로세스). 렌더러가 보낸 항목 id로 키를 꺼내 서비스 어댑터를 직접 부른다 — CORS·Worker 불필요.
 * 키는 응답·오류 문구 어디에도 싣지 않는다(redactKey).
 */
import type { ApiEntry, ApiService } from '../src/generate/apiList';
import { GenError } from '../src/generate/engine';
import { redactKey } from '../src/generate/keys';
import { runProvider } from '../src/generate/providers';
import type { NativeGenRequest, NativeGenResponse } from '../src/native';
import type { KeyStore } from './keystore';

const SERVICES: ApiService[] = ['venice', 'bfl', 'openai', 'custom'];
const active = new Map<string, AbortController>();

export function cancelGeneration(requestId: string): void {
  active.get(requestId)?.abort();
}

export async function runGeneration(req: NativeGenRequest, keys: KeyStore, fetchFn?: typeof fetch): Promise<NativeGenResponse> {
  if (!SERVICES.includes(req.service as ApiService)) return { ok: false, kind: 'config', message: `지원하지 않는 서비스: ${req.service}` };
  const key = await keys.get(req.apiId);
  if (!key) return { ok: false, kind: 'config', message: '이 항목의 API 키가 없습니다. 설정 > 이미지 생성 > API 목록에서 키를 넣으세요' };
  const entry: ApiEntry = { id: req.apiId, service: req.service as ApiService, label: req.apiId, model: req.model, baseUrl: req.baseUrl };
  const ctrl = new AbortController();
  active.set(req.requestId, ctrl);
  try {
    const out = await runProvider(entry, {
      prompt: req.prompt,
      images: req.images.map((i) => ({ name: i.name, data: new Uint8Array(i.data), mime: i.mime })),
      size: req.size,
      n: req.n,
      quality: req.quality,
      inputFidelity: req.inputFidelity,
      apiKey: key,
      signal: ctrl.signal,
      fetchFn,
    });
    const buffers = out.images.map((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    return { ok: true, images: buffers, mime: out.mime, model: out.model, usage: out.usage, costCredits: out.costCredits };
  } catch (e) {
    if (e instanceof GenError) return { ok: false, kind: e.kind, message: redactKey(e.message, key) };
    return { ok: false, kind: 'server', message: redactKey(e instanceof Error ? e.message : String(e), key) };
  } finally {
    active.delete(req.requestId);
  }
}
