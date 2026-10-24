import { useEffect } from 'react';
import { useStore } from '../state/store';
import { initStorage, saveNow } from './save';

/** 시작 시 저장소 연결, 주기 자동 저장, 닫기 전 경고 */
export function useAutosave(): void {
  useEffect(() => {
    void initStorage();
  }, []);

  const seconds = useStore((s) => s.settings.autosaveSeconds);
  useEffect(() => {
    const ms = Math.max(10, seconds) * 1000;
    const t = window.setInterval(() => {
      if (useStore.getState().dirty) void saveNow();
    }, ms);
    return () => window.clearInterval(t);
  }, [seconds]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
