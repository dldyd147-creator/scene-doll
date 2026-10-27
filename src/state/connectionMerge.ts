/** 연결 설정 복원의 순수 계산(저장소와 무관, 시험 대상) */
import type { Settings } from './settings';

export const CONNECTION_KEYS = ['genEngine', 'genEndpoint', 'genToken', 'genProvider', 'genVeniceModel', 'nttUrl', 'nttToken'] as const;
export type ConnKey = (typeof CONNECTION_KEYS)[number];

export function pickConnection(s: Settings): Pick<Settings, ConnKey> {
  const out: Partial<Pick<Settings, ConnKey>> = {};
  for (const k of CONNECTION_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out as Pick<Settings, ConnKey>;
}

/** 저장된 연결 설정 중 이 브라우저에 비어 있는 토큰·주소를 채운다(이미 입력한 값은 덮어쓰지 않는다) */
export function mergeConnection(current: Settings, saved: Partial<Pick<Settings, ConnKey>>): Partial<Settings> {
  const patch: Partial<Settings> = {};
  const fill = <K extends ConnKey>(k: K, empty: (v: Settings[K]) => boolean) => {
    const v = saved[k];
    if (v !== undefined && v !== '' && empty(current[k])) (patch as Record<string, unknown>)[k] = v;
  };
  fill('genEndpoint', (v) => !v);
  fill('genToken', (v) => !v);
  fill('nttUrl', (v) => !v);
  fill('nttToken', (v) => !v);
  fill('genVeniceModel', (v) => !v);
  // 토큰까지 복원되는 경우에만 엔진·서비스 선택도 따른다
  if (patch.genToken || patch.genEndpoint) {
    if (saved.genEngine) patch.genEngine = saved.genEngine;
    if (saved.genProvider) patch.genProvider = saved.genProvider;
  }
  return patch;
}

