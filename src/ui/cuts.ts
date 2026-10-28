import { useEffect } from 'react';
import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { cutBlock } from '../describe/text';
import { selectCurrentCut, useStore } from '../state/store';
import { logAction } from '../storage/remote/service';
import { useLibrary } from './library';
import { saveNow } from './save';

const THUMB_WIDTH = 192;

/** 현재 원고 카메라로 썸네일을 그린다(데이터 URL). width 기본은 컷 목록용 192px. 원고뷰에 바닥 격자가 보이면 썸네일에도 같이 그려 두 화면이 같게 한다 */
export function captureThumbnail(engine: Engine, aspect: number, width = THUMB_WIDTH): string {
  const canvas = engine.renderToCanvas(engine.manu.camera, width, width * aspect, { background: 'white', showGrid: useStore.getState().settings.manuscriptGrid });
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
  if (useStore.getState().readOnly) {
    useStore.getState().setStatusHint('보기 전용 회차라 확정할 수 없습니다(다른 사람이 작업 중)');
    return;
  }
  // 아직 기록 안 된 원고뷰 조작(휠 뒤 대기)과 화면에 보이는 카메라를 먼저 컷에 쓴다
  engine.flushCameraEdits();
  engine.syncCameraToCut();
  const s = useStore.getState();
  const cut = s.currentCut();
  const desc = describeCurrentCut(engine);
  const thumb = captureThumbnail(engine, cut.aspect);
  s.setThumbnail(cut.number, thumb);
  s.confirmCut(desc);
  logAction('confirm', `${s.episode.number}화 컷 ${cut.number}`, null, s.work.code);
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

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** 확정 컷들의 썸네일을 지금 코드로 모두 다시 찍는다. 현재 컷은 그대로 돌아온다 */
export async function refreshAllThumbnails(engine: Engine): Promise<number> {
  const s = useStore.getState();
  const confirmed = s.cuts.filter((c) => c.confirmed);
  if (!confirmed.length) return 0;
  const back = s.currentCut();
  await engine.ensureTemplatesFor(confirmed);
  try {
    for (const cut of confirmed) {
      engine.applyCut(cut);
      await nextFrame();
      useStore.getState().setThumbnail(cut.number, captureThumbnail(engine, cut.aspect));
    }
  } finally {
    engine.applyCut(useStore.getState().cuts.find((c) => c.number === back.number) ?? back);
  }
  return confirmed.length;
}

const REPAIR_KEY = 'scene-doll.thumbRepair.v1';

/**
 * 고해상도(화면 배율 1.25·1.5·2) 화면에서 옛 버전이 썸네일을 확대해 잘라 저장했다. 회차를 처음 열 때 한 번 모두 다시 찍는다.
 * 배율 1인 화면은 문제가 없었으므로 건드리지 않는다
 */
export function useThumbnailRepair(engine: Engine): void {
  const screen = useStore((s) => s.screen);
  const key = useStore((s) => `${s.work.code}/${s.episode.number}`);
  useEffect(() => {
    if (screen !== 'editor' || window.devicePixelRatio === 1) return;
    let done: string[] = [];
    try {
      done = JSON.parse(localStorage.getItem(REPAIR_KEY) ?? '[]') as string[];
    } catch {
      /* 읽지 못하면 처음인 것으로 */
    }
    if (done.includes(key)) return;
    const t = window.setTimeout(() => {
      const st = useStore.getState();
      if (st.screen !== 'editor' || `${st.work.code}/${st.episode.number}` !== key || st.readOnly) return;
      void refreshAllThumbnails(engine).then(() => {
        try {
          localStorage.setItem(REPAIR_KEY, JSON.stringify([...done, key]));
        } catch {
          /* 다음에 다시 시도 */
        }
      });
    }, 2000);
    return () => window.clearTimeout(t);
  }, [engine, screen, key]);
}
