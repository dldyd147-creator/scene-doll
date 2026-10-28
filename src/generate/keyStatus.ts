import { create } from 'zustand';
import { native } from '../native';

/** 데스크톱의 API 키 보관 상태(어느 항목에 키가 있는지). 키 본문은 렌더러로 오지 않는다 */
interface KeyStatusState {
  loaded: boolean;
  available: boolean;
  ids: Set<string>;
  refresh: () => Promise<void>;
  save: (id: string, key: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  clear: (id: string) => Promise<void>;
}

export const useKeyStatus = create<KeyStatusState>((set, get) => ({
  loaded: false,
  available: false,
  ids: new Set(),
  async refresh() {
    if (!native) return set({ loaded: true, available: false, ids: new Set() });
    const s = await native.keys.status();
    set({ loaded: true, available: s.available, ids: new Set(s.ids) });
  },
  async save(id, key) {
    if (!native) return { ok: false, reason: '설치형 프로그램에서만 키를 저장할 수 있습니다' };
    const r = await native.keys.set(id, key);
    await get().refresh();
    return r;
  },
  async clear(id) {
    if (!native) return;
    await native.keys.clear(id);
    await get().refresh();
  },
}));
