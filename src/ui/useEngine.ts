import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';
import { selectCurrentCut, useStore } from '../state/store';
import { storage } from '../storage';
import { useLibrary } from './library';

/** 엔진을 한 번 만들고 스토어와 양방향으로 묶는다 */
export function useEngine(): Engine {
  const ref = useRef<Engine | null>(null);
  if (!ref.current) {
    ref.current = new Engine({
      commit: (mutate) => useStore.getState().commitCut(mutate),
      select: (sel) => useStore.getState().select(sel),
      hint: (text) => useStore.getState().setStatusHint(text),
      setCutCamera: (n, camera) => useStore.getState().setCutCamera(n, camera),
      propModel: (asset) => storage.repository.readPropModel(asset.id),
    });
  }
  const engine = ref.current;

  useEffect(() => {
    engine.mount();
    if (import.meta.env.DEV) {
      void import('../storage').then((m) => {
        (window as unknown as { __sceneDoll: unknown }).__sceneDoll = { engine, store: useStore, storage: m.storage };
      });
    }
    const s = useStore.getState();
    engine.applySettings(s.settings);
    engine.applyCut(selectCurrentCut(s));
    engine.applySelection(s.selection);
    engine.applyMode(s.mode);
    // 등록 소품 정의를 엔진에 넣어 준다(라이브러리가 바뀔 때마다)
    engine.setPropAssets(useLibrary.getState().props ?? []);
    let lastProps = useLibrary.getState().props;
    void useLibrary.getState().loadProps();
    const unsubs = [
      useLibrary.subscribe((st) => {
        if (st.props !== lastProps) {
          lastProps = st.props;
          engine.setPropAssets(st.props ?? []);
        }
      }),
      useStore.subscribe(selectCurrentCut, (cut) => engine.applyCut(cut)),
      useStore.subscribe((st) => st.settings, (settings) => engine.applySettings(settings)),
      useStore.subscribe((st) => st.selection, (sel) => engine.applySelection(sel)),
      useStore.subscribe((st) => st.mode, (mode) => engine.applyMode(mode)),
    ];
    return () => {
      unsubs.forEach((u) => u());
      engine.dispose();
      ref.current = null;
    };
  }, [engine]);

  return engine;
}
