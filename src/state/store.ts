import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Character, Cut, DollInstance, Episode, Gender, Work } from '../model/types';
import { createCut, createEpisode, createTemporaryCharacter, createWork, defaultDollFor, nowIso, pickColor } from '../model/defaults';
import { newId } from '../model/ids';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

export interface Selection {
  dollId: string | null;
  bone: string | null;
}

export type ToolMode = 'direct' | 'translate' | 'rotate';

export interface Document {
  work: Work;
  episode: Episode;
  cuts: Cut[];
  characters: Character[];
}

export interface StoreState extends Document {
  currentCutIndex: number;
  selection: Selection;
  mode: ToolMode;
  settings: Settings;
  settingsOpen: boolean;
  assetPanelOpen: boolean;
  past: Cut[];
  future: Cut[];
  storageKind: 'none' | 'folder' | 'browser';
  folderName: string | null;
  dirty: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  statusHint: string;

  currentCut: () => Cut;
  /** 현재 컷을 바꾸고 되돌리기 기록을 남긴다 */
  commitCut: (mutate: (cut: Cut) => void) => void;
  undo: () => void;
  redo: () => void;
  select: (sel: Selection) => void;
  setMode: (mode: ToolMode) => void;
  addDoll: (gender: Gender, heightCm: number) => string;
  removeDoll: (id: string) => void;
  /** 돌 복제. offsetX=0이면 같은 자리에 붙여넣기 */
  duplicateDoll: (id: string, offsetX?: number) => string | null;
  setDollColor: (id: string, color: string) => void;
  setDollHeight: (id: string, heightCm: number) => void;
  renameCharacter: (id: string, name: string) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  resetSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
  setAssetPanelOpen: (open: boolean) => void;
  setWorkCode: (code: string) => void;
  setWorkName: (name: string) => void;
  setEpisodeNumber: (n: number) => void;
  loadDocument: (doc: Document) => void;
  setStorage: (kind: 'none' | 'folder' | 'browser', folderName: string | null) => void;
  markSaved: () => void;
  setSaveError: (msg: string | null) => void;
  setStatusHint: (hint: string) => void;
  snapshotDocument: () => Document;
}

function initialDocument(): Document {
  const work = createWork();
  return { work, episode: createEpisode(work.code, 1), cuts: [createCut(1)], characters: [] };
}

export const useStore = create<StoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initialDocument(),
    currentCutIndex: 0,
    selection: { dollId: null, bone: null },
    mode: 'direct',
    settings: loadSettings(),
    settingsOpen: false,
    assetPanelOpen: true,
    past: [],
    future: [],
    storageKind: 'none',
    folderName: null,
    dirty: false,
    lastSavedAt: null,
    saveError: null,
    statusHint: '',

    currentCut: () => get().cuts[get().currentCutIndex],

    commitCut: (mutate) => {
      const s = get();
      const before = s.cuts[s.currentCutIndex];
      const next = structuredClone(before);
      mutate(next);
      next.updatedAt = nowIso();
      const past = [...s.past, before];
      const limit = Math.max(10, s.settings.undoLimit);
      if (past.length > limit) past.splice(0, past.length - limit);
      const cuts = s.cuts.slice();
      cuts[s.currentCutIndex] = next;
      set({ cuts, past, future: [], dirty: true });
    },

    undo: () => {
      const s = get();
      if (!s.past.length) return;
      const past = s.past.slice();
      const prev = past.pop()!;
      const cuts = s.cuts.slice();
      const current = cuts[s.currentCutIndex];
      cuts[s.currentCutIndex] = prev;
      const sel = s.selection.dollId && !prev.dolls.some((d) => d.id === s.selection.dollId) ? { dollId: null, bone: null } : s.selection;
      set({ cuts, past, future: [current, ...s.future], dirty: true, selection: sel });
    },

    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const [next, ...future] = s.future;
      const cuts = s.cuts.slice();
      const current = cuts[s.currentCutIndex];
      cuts[s.currentCutIndex] = next;
      const sel = s.selection.dollId && !next.dolls.some((d) => d.id === s.selection.dollId) ? { dollId: null, bone: null } : s.selection;
      set({ cuts, past: [...s.past, current], future, dirty: true, selection: sel });
    },

    select: (sel) => {
      const cur = get().selection;
      if (cur.dollId === sel.dollId && cur.bone === sel.bone) return;
      set({ selection: sel });
    },

    setMode: (mode) => set({ mode }),

    addDoll: (gender, heightCm) => {
      const s = get();
      const cut = s.currentCut();
      const used = s.characters.map((c) => c.color);
      const color = pickColor(used);
      const character = createTemporaryCharacter(s.work.code, gender, heightCm, color, s.characters.length + 1);
      const id = newId('doll');
      // 새 돌은 기존 돌과 겹치지 않게 옆으로 비켜 놓는다
      const offsetX = cut.dolls.length === 0 ? 0 : (cut.dolls.length % 2 === 1 ? 1 : -1) * Math.ceil(cut.dolls.length / 2) * 0.7;
      const inst: DollInstance = {
        id,
        characterId: character.id,
        dollId: defaultDollFor(gender).id,
        heightCm,
        color,
        position: [offsetX, 0, 0],
        rotation: [0, 0, 0, 1],
        joints: {},
      };
      set({ characters: [...s.characters, character] });
      get().commitCut((c) => {
        c.dolls.push(inst);
      });
      set({ selection: { dollId: id, bone: null } });
      return id;
    },

    removeDoll: (id) => {
      get().commitCut((c) => {
        c.dolls = c.dolls.filter((d) => d.id !== id);
      });
      const sel = get().selection;
      if (sel.dollId === id) set({ selection: { dollId: null, bone: null } });
    },

    duplicateDoll: (id, offsetX = 0.6) => {
      const s = get();
      const src = s.currentCut().dolls.find((d) => d.id === id);
      if (!src) return null;
      const srcChar = s.characters.find((c) => c.id === src.characterId);
      const color = pickColor(s.characters.map((c) => c.color));
      const character = createTemporaryCharacter(
        s.work.code,
        srcChar?.info.gender === 'female' ? 'female' : 'male',
        src.heightCm,
        color,
        s.characters.length + 1,
      );
      const newId_ = newId('doll');
      const copy: DollInstance = structuredClone(src);
      copy.id = newId_;
      copy.characterId = character.id;
      copy.color = color;
      copy.position = [src.position[0] + offsetX, src.position[1], src.position[2]];
      set({ characters: [...s.characters, character] });
      get().commitCut((c) => {
        c.dolls.push(copy);
      });
      set({ selection: { dollId: newId_, bone: null } });
      return newId_;
    },

    setDollColor: (id, color) => {
      const s = get();
      const inst = s.currentCut().dolls.find((d) => d.id === id);
      if (!inst) return;
      set({ characters: s.characters.map((c) => (c.id === inst.characterId ? { ...c, color } : c)) });
      get().commitCut((c) => {
        const d = c.dolls.find((x) => x.id === id);
        if (d) d.color = color;
      });
    },

    setDollHeight: (id, heightCm) => {
      const s = get();
      const inst = s.currentCut().dolls.find((d) => d.id === id);
      if (!inst) return;
      set({ characters: s.characters.map((c) => (c.id === inst.characterId ? { ...c, heightCm } : c)) });
      get().commitCut((c) => {
        const d = c.dolls.find((x) => x.id === id);
        if (d) d.heightCm = heightCm;
      });
    },

    renameCharacter: (id, name) => {
      set({ characters: get().characters.map((c) => (c.id === id ? { ...c, name } : c)), dirty: true });
    },

    updateSettings: (partial) => {
      const settings = { ...get().settings, ...partial };
      saveSettings(settings);
      set({ settings });
    },

    resetSettings: () => {
      saveSettings(DEFAULT_SETTINGS);
      set({ settings: { ...DEFAULT_SETTINGS } });
    },

    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setAssetPanelOpen: (open) => set({ assetPanelOpen: open }),

    setWorkCode: (code) => {
      const clean = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
      const s = get();
      set({
        work: { ...s.work, code: clean || 'TMP', updatedAt: nowIso() },
        episode: { ...s.episode, workCode: clean || 'TMP' },
        characters: s.characters.map((c) => ({ ...c, workCode: clean || 'TMP' })),
        dirty: true,
      });
    },

    setWorkName: (name) => set({ work: { ...get().work, name, updatedAt: nowIso() }, dirty: true }),

    setEpisodeNumber: (n) => {
      const num = Math.max(1, Math.min(999, Math.round(n) || 1));
      set({ episode: { ...get().episode, number: num, updatedAt: nowIso() }, dirty: true });
    },

    loadDocument: (doc) => {
      set({
        work: doc.work,
        episode: doc.episode,
        cuts: doc.cuts.length ? doc.cuts : [createCut(1)],
        characters: doc.characters,
        currentCutIndex: 0,
        past: [],
        future: [],
        selection: { dollId: null, bone: null },
        dirty: false,
      });
    },

    setStorage: (kind, folderName) => set({ storageKind: kind, folderName }),
    markSaved: () => set({ dirty: false, lastSavedAt: nowIso(), saveError: null }),
    setSaveError: (msg) => set({ saveError: msg }),
    setStatusHint: (hint) => {
      if (get().statusHint !== hint) set({ statusHint: hint });
    },

    snapshotDocument: () => {
      const s = get();
      return { work: s.work, episode: s.episode, cuts: s.cuts, characters: s.characters };
    },
  })),
);

/** 현재 컷 선택자(엔진 구독용) */
export const selectCurrentCut = (s: StoreState): Cut => s.cuts[s.currentCutIndex];
