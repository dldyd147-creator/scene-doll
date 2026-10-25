import { useEffect, useRef } from 'react';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';
import { confirmCurrentCut } from './cuts';
import { saveNow } from './save';

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * 단축키(기획서 '단축키' 표). 기본 편집은 클립스튜디오, 시점은 스케치업, 나머지는 씬 돌 고유.
 * `(백틱)은 씬 검색기 토글.
 */
export function useShortcuts(engine: Engine): void {
  const clipboard = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // 시작 화면(작품 관리)에서는 편집 단축키를 받지 않는다
      if (s.screen !== 'editor') return;

      // `(백틱): 씬 검색기 토글. 자판 배열과 무관하게 물리 키(code)로 보되, code가 비는 환경은 글자로 본다. 입력란에서는 글자로 둔다
      if ((e.code === 'Backquote' || e.key === '`') && !ctrl && !e.altKey && !isTyping(e)) {
        e.preventDefault();
        if (s.sceneBrowserOpen) s.setSceneBrowserOpen(false);
        else if (!s.sceneSaveOpen) s.openSceneBrowser();
        return;
      }
      // 씬 검색기·씬 저장이 열려 있으면 Esc만 받는다(아래 씬이 바뀌지 않게)
      if (s.sceneBrowserOpen || s.sceneSaveOpen) {
        if (e.key === 'Escape') {
          s.setSceneBrowserOpen(false);
          s.setSceneSaveOpen(false);
        }
        return;
      }

      // 입력란에서도 Ctrl+Enter(컷 확정)·Ctrl+S(저장)는 받는다
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        void confirmCurrentCut(engine);
        return;
      }
      if (ctrl && key === 's') {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (isTyping(e)) return;
      // G/R 모달 변형 중에는 Interaction이 키를 처리한다
      if (engine.interaction?.modalActive) return;

      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
        return;
      }
      if ((ctrl && key === 'y') || (ctrl && e.shiftKey && key === 'z')) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (ctrl && key === 'c') {
        if (s.selection.dollId) clipboard.current = s.selection.dollId;
        return;
      }
      if (ctrl && key === 'v') {
        if (clipboard.current && s.currentCut().dolls.some((d) => d.id === clipboard.current)) {
          e.preventDefault();
          s.duplicateDoll(clipboard.current, 0);
        }
        return;
      }
      if (ctrl) return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (s.selection.dollId) {
            e.preventDefault();
            s.removeDoll(s.selection.dollId);
          }
          return;
        case 'Escape':
          if (s.settingsOpen) s.setSettingsOpen(false);
          else if (s.exportOpen) s.setExportOpen(false);
          else if (s.helpOpen) s.setHelpOpen(false);
          else if (s.galleryOpen) s.setGalleryOpen(false);
          else if (s.mode !== 'direct') s.setMode('direct');
          else s.select({ dollId: null, bone: null });
          return;
        case 'Tab':
          e.preventDefault();
          engine.toggleViewWithManuscript();
          return;
        case 'PageUp':
          e.preventDefault();
          s.prevCut();
          return;
        case 'PageDown':
          e.preventDefault();
          s.nextCut();
          return;
      }
      switch (key) {
        case 'g':
        case 'm':
          if (e.altKey) {
            // Alt+G: 위치 초기화(블렌더식)
            e.preventDefault();
            engine.resetSelectedDoll('position');
            return;
          }
          if (engine.interaction?.startModal('move')) e.preventDefault();
          return;
        case 'r':
          if (e.altKey) {
            // Alt+R: 회전 초기화(블렌더식)
            e.preventDefault();
            engine.resetSelectedDoll('rotation');
            return;
          }
          if (engine.interaction?.startModal('rotate')) e.preventDefault();
          return;
        case 'q':
          s.setMode('direct');
          return;
        case 'w':
          s.setMode('translate');
          return;
        case 'e':
          s.setMode('rotate');
          return;
        case 'f':
          engine.focusSelected();
          return;
        case 'z':
          if (e.shiftKey) engine.fitAll();
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
}
