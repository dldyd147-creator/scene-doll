import { useEffect } from 'react';
import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { cutBlock } from '../describe/text';
import { selectCurrentCut, useStore } from '../state/store';
import { useLibrary } from './library';
import { saveNow } from './save';

const THUMB_WIDTH = 192;

/** 현재 원고 카메라로 썸네일을 그린다(데이터 URL). width 기본은 컷 목록용 192px */
export function captureThumbnail(engine: Engine, aspect: number, width = THUMB_WIDTH): string {
  const canvas = engine.renderToCanvas(engine.manu.camera, width, width * aspect, { background: 'white' });
  return canvas.toDataURL('image/png');
}

/** 현재 컷의 설명 텍스트 블록을 만든다(엔진에 현재 컷이 적용된 상태) */
export function describeCurrentCut(engine: Engine): string {
  const s = useStore.getState();
  const cut = s.currentCut();
  return cutBlock(analyzeCut(engine, cut, s.characters), cut, s.work.code, s.episode.number, useLibrary.getState().props ?? []);
}

/**
 * 컷 확정(Ctrl+Enter): 원고뷰 카메라를 컷에 맞춘 뒤 설명 텍스트 생성 → 썸네일 → 확정 표시 → 다음 컷 → 자동 저장.
 * 다음 컷이 없으면 방금 확정한 씬을 복사한 컷이 생긴다. 썸네일은 저장되는 컷과 항상 같은 화면이다.
 */
export async function confirmCurrentCut(engine: Engine): Promise<void> {
  // 아직 기록 안 된 원고뷰 조작(휠 뒤 대기)과 화면에 보이는 카메라를 먼저 컷에 쓴다
  engine.flushCameraEdits();
  engine.syncCameraToCut();
  const s = useStore.getState();
  const cut = s.currentCut();
  const desc = describeCurrentCut(engine);
  const thumb = captureThumbnail(engine, cut.aspect);
  s.setThumbnail(cut.number, thumb);
  s.confirmCut(desc);
  await saveNow();
}

/** 썸네일만 다시 찍기(확정된 컷을 고친 뒤 등) */
export function refreshThumbnail(engine: Engine): void {
  const s = useStore.getState();
  const cut = s.currentCut();
  s.setThumbnail(cut.number, captureThumbnail(engine, cut.aspect));
}

/**
 * 확정된 컷을 고치면(카메라·돌·소품) 잠시 뒤 썸네일을 다시 찍어 컷 목록이 늘 원고뷰와 같게 한다.
 * 컷을 옮기는 것(번호가 바뀜)은 다시 찍지 않는다
 */
export function useThumbnailSync(engine: Engine): void {
  useEffect(() => {
    let timer = 0;
    const unsub = useStore.subscribe(selectCurrentCut, (cut, prev) => {
      if (!cut || !prev || cut === prev || cut.number !== prev.number || !cut.confirmed) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const s = useStore.getState();
        if (s.screen === 'editor' && s.currentCut() === cut) refreshThumbnail(engine);
      }, 350);
    });
    return () => {
      unsub();
      window.clearTimeout(timer);
    };
  }, [engine]);
}
