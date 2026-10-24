import { useEffect, useRef } from 'react';
import { Engine } from '../engine/Engine';
import { selectCurrentCut, useStore } from '../state/store';

/** 엔진을 한 번 만들고 스토어와 양방향으로 묶는다 */
export function useEngine(): Engine {
  const ref = useRef<Engine | null>(null);
  if (!ref.current) {
    ref.current = new Engine({
      commit: (mutate) => useStore.getState().commitCut(mutate),
      select: (sel) => useStore.getState().select(sel),
      hint: (text) => useStore.getState().setStatusHint(text),
    });
  }
  const engine = ref.current;

  useEffect(() => {
    engine.mount();
    const s = useStore.getState();
    engine.applySettings(s.settings);
    engine.applyCut(selectCurrentCut(s));
    engine.applySelection(s.selection);
    engine.applyMode(s.mode);
    const unsubs = [
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
