import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { cutBlock } from '../describe/text';
import { useStore } from '../state/store';
import { saveNow } from './save';

const THUMB_WIDTH = 192;

/** 현재 원고 카메라로 썸네일을 그린다(데이터 URL) */
export function captureThumbnail(engine: Engine, aspect: number): string {
  const canvas = engine.renderToCanvas(engine.manu.camera, THUMB_WIDTH, THUMB_WIDTH * aspect, { background: 'white' });
  return canvas.toDataURL('image/png');
}

/** 현재 컷의 설명 텍스트 블록을 만든다(엔진에 현재 컷이 적용된 상태) */
export function describeCurrentCut(engine: Engine): string {
  const s = useStore.getState();
  const cut = s.currentCut();
  return cutBlock(analyzeCut(engine, cut, s.characters), cut, s.work.code, s.episode.number);
}

/**
 * 컷 확정(Ctrl+Enter): 설명 텍스트 생성 → 썸네일 → 확정 표시 → 다음 컷 → 자동 저장.
 * 다음 컷이 없으면 방금 확정한 씬을 복사한 컷이 생긴다.
 */
export async function confirmCurrentCut(engine: Engine): Promise<void> {
  const s = useStore.getState();
  const cut = s.currentCut();
  const desc = describeCurrentCut(engine);
  const thumb = captureThumbnail(engine, cut.aspect);
  s.setThumbnail(cut.number, thumb);
  s.confirmCut(desc);
  await saveNow();
}

/** 썸네일만 다시 찍기(확정된 컷을 다시 열었을 때 등) */
export function refreshThumbnail(engine: Engine): void {
  const s = useStore.getState();
  const cut = s.currentCut();
  s.setThumbnail(cut.number, captureThumbnail(engine, cut.aspect));
}
