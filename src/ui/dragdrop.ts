import type { DragEvent } from 'react';

/** 에셋 패널에서 조작뷰로 끌어다 놓는 것: 캐릭터 돌·기본 돌(바닥 자리에 세움), 포즈(돌 위에 놓으면 적용), 소품(바닥에 놓거나 돌 위에 놓으면 오른손에) */
export type DragPayload = { kind: 'character'; id: string } | { kind: 'doll'; dollId: string; heightCm: number } | { kind: 'pose'; id: string } | { kind: 'prop'; id: string };

const MIME = 'application/x-scene-doll';
/** dragover 중에는 dataTransfer를 읽을 수 없어 끌기 시작할 때 따로 들고 있는다 */
let current: DragPayload | null = null;

export function startDrag(e: DragEvent, payload: DragPayload): void {
  current = payload;
  e.dataTransfer.setData(MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'copy';
}

export function endDrag(): void {
  current = null;
}

export function currentDrag(): DragPayload | null {
  return current;
}

export function isSceneDollDrag(e: DragEvent): boolean {
  return current !== null || Array.from(e.dataTransfer.types).includes(MIME);
}

export function dragPayload(e: DragEvent): DragPayload | null {
  if (current) return current;
  try {
    const t = e.dataTransfer.getData(MIME);
    return t ? (JSON.parse(t) as DragPayload) : null;
  } catch {
    return null;
  }
}
