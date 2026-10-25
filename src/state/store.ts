import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Character, Cut, DollInstance, Episode, GripTransform, Hand, PropInstance, Quat, SceneLibraryItem, Vec3, Work } from '../model/types';
import { createCut, createEpisode, createTemporaryCharacter, createWork, dollAsset, nowIso, pickColor } from '../model/defaults';
import { dollsFromScene, type SlotAssignments } from '../model/library';
import { createPropInstance } from '../model/props';
import { newId } from '../model/ids';
import { applyScriptToCuts, type ApplyPlan, type CutScript, type DialogueLine } from '../script/ntt';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

export interface Selection {
  dollId: string | null;
  bone: string | null;
  /** 원고 카메라가 선택됨(조작뷰의 카메라 아이콘) */
  camera?: boolean;
  /** 선택한 소품(컷의 소품 인스턴스 ID) */
  propId?: string | null;
}

/** 컷에 없는 돌·소품을 가리키는 선택은 푼다 */
function validSelection(sel: Selection, cut: Cut): Selection {
  if (sel.dollId && !cut.dolls.some((d) => d.id === sel.dollId)) return { dollId: null, bone: null };
  if (sel.propId && !cut.props.some((p) => p.id === sel.propId)) return { dollId: null, bone: null };
  return sel;
}

export const NO_SELECTION: Selection = { dollId: null, bone: null };

export type ToolMode = 'direct' | 'translate' | 'rotate';

export interface Document {
  work: Work;
  episode: Episode;
  cuts: Cut[];
  characters: Character[];
}

/** 컷 번호 → 썸네일 데이터 URL */
export type Thumbnails = Record<number, string>;

export interface StoreState extends Document {
  currentCutIndex: number;
  selection: Selection;
  mode: ToolMode;
  settings: Settings;
  settingsOpen: boolean;
  exportOpen: boolean;
  helpOpen: boolean;
  galleryOpen: boolean;
  assetPanelOpen: boolean;
  past: Cut[];
  future: Cut[];
  storageKind: 'none' | 'folder' | 'browser';
  folderName: string | null;
  dirty: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  statusHint: string;
  thumbnails: Thumbnails;
  /** 저장소에 아직 안 쓴 썸네일 컷 번호 */
  thumbnailDirty: number[];
  /** 컷 번호가 바뀌어 저장소의 썸네일 파일을 모두 다시 써야 함 */
  thumbnailsRenumbered: boolean;
  /** 시작 화면(작품 관리) / 편집 화면 */
  screen: 'start' | 'editor';
  /** 캐릭터 관리 대화상자가 열린 작품코드(null이면 닫힘) */
  characterManagerFor: string | null;
  /** 씬 검색기(` 키) 열림. 열 때 미리 고를 씬 ID */
  sceneBrowserOpen: boolean;
  sceneBrowserSelectId: string | null;
  /** 씬 저장 대화상자 */
  sceneSaveOpen: boolean;
  /** 글콘티(NTT 엑셀) 가져오기 대화상자 */
  scriptImportOpen: boolean;
  /** 글콘티 없이도 원고뷰 위아래의 대사·지문 칸을 보이게(이 세션만) */
  scriptBlocksForced: boolean;

  currentCut: () => Cut;
  /** 현재 컷을 바꾸고 되돌리기 기록을 남긴다 */
  commitCut: (mutate: (cut: Cut) => void) => void;
  undo: () => void;
  redo: () => void;
  select: (sel: Selection) => void;
  setMode: (mode: ToolMode) => void;
  /** 내장 돌(dollId)을 현재 컷에 추가하고 임시 캐릭터를 등록한다. position을 주면 그 자리(드래그앤드롭) */
  addDoll: (dollId: string, heightCm: number, position?: Vec3) => string;
  removeDoll: (id: string) => void;
  /** 돌 복제. offsetX=0이면 같은 자리에 붙여넣기 */
  duplicateDoll: (id: string, offsetX?: number) => string | null;
  setDollColor: (id: string, color: string) => void;
  setDollHeight: (id: string, heightCm: number) => void;
  renameCharacter: (id: string, name: string) => void;
  updateSettings: (partial: Partial<Settings>) => void;
  resetSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  setAssetPanelOpen: (open: boolean) => void;
  setWorkCode: (code: string) => void;
  setWorkName: (name: string) => void;
  setEpisodeNumber: (n: number) => void;
  updateOutputSettings: (partial: Partial<Work['output']>) => void;
  loadDocument: (doc: Document, thumbnails?: Thumbnails) => void;
  setStorage: (kind: 'none' | 'folder' | 'browser', folderName: string | null) => void;
  markSaved: () => void;
  setSaveError: (msg: string | null) => void;
  setStatusHint: (hint: string) => void;
  snapshotDocument: () => Document;
  setScreen: (screen: 'start' | 'editor') => void;
  setCharacterManagerFor: (code: string | null) => void;
  /** 저장소에서 다시 읽은 캐릭터로 바꾼다. 아직 저장 안 된 임시 캐릭터는 남긴다 */
  setCharacters: (chars: Character[]) => void;
  /** 등록 캐릭터의 돌(성별 돌·키·고정색)을 현재 컷에 추가. position을 주면 그 자리(드래그앤드롭) */
  addCharacterDoll: (characterId: string, position?: Vec3) => string | null;
  /** 돌에 캐릭터 지정. null이면 임시 캐릭터로 되돌린다 */
  assignCharacter: (dollId: string, characterId: string | null) => void;
  setEpisodeTitle: (title: string) => void;

  // 소품(3단계)
  /** 등록 소품을 현재 컷에 자유 배치. position이 없으면 앞쪽에 비켜 놓는다 */
  addProp: (propId: string, position?: Vec3) => string;
  removeProp: (id: string) => void;
  /** 소품 복제(자유 배치는 옆으로 비켜, 손에 쥔 것은 같은 손에 같은 오프셋) */
  duplicateProp: (id: string) => string | null;
  /** 손에 쥐어 주기: 쥐기 오프셋(손 뼈 로컬)으로 바꿔 적는다 */
  attachProp: (id: string, dollId: string, hand: Hand, grip: GripTransform) => void;
  updateProp: (id: string, patch: Partial<Omit<PropInstance, 'id'>>) => void;

  // 씬 라이브러리
  openSceneBrowser: (selectId?: string | null) => void;
  setSceneBrowserOpen: (open: boolean) => void;
  setSceneSaveOpen: (open: boolean) => void;
  /**
   * 씬 라이브러리 항목을 현재 컷에 넣는다. replace: 씬 전체 교체(돌·소품·카메라·화면비), add: 돌만 추가.
   * 슬롯마다 지정한 캐릭터의 돌(성별 돌·키·고정색)로 들어오고, 비운 슬롯은 임시 캐릭터가 된다.
   */
  applyLibraryScene: (item: SceneLibraryItem, assignments: SlotAssignments, mode: 'replace' | 'add') => void;

  // 글콘티(NTT)
  setScriptImportOpen: (open: boolean) => void;
  setScriptBlocksForced: (on: boolean) => void;
  /** 글콘티(컷별 대사·지문·비고)를 회차 컷에 반영. 모자란 컷은 마지막 컷을 복사해 만들고 글콘티에 없는 컷은 그대로 둔다 */
  applyScript: (scripts: CutScript[], source: { fileName: string; importedAt: string }) => ApplyPlan;
  /** 현재 컷의 대사·지문을 고친다(메모처럼 되돌리기 기록 없음) */
  setCutScript: (partial: { dialogue?: DialogueLine[]; scriptNote?: string }) => void;

  // 컷 확정·목록
  /** 현재 컷을 확정(설명 텍스트 기록)하고 다음 컷으로. 다음 컷이 없으면 현재 씬을 복사해 만든다 */
  confirmCut: (desc: string) => void;
  goToCut: (index: number) => void;
  nextCut: () => void;
  prevCut: () => void;
  insertCutAfter: (index: number) => void;
  deleteCut: (index: number) => void;
  moveCut: (index: number, delta: number) => void;
  setCutMemo: (memo: string) => void;
  setThumbnail: (cutNumber: number, dataUrl: string) => void;
  markThumbnailsSaved: () => void;
}

function initialDocument(): Document {
  const work = createWork();
  return { work, episode: createEpisode(work.code, 1), cuts: [createCut(1)], characters: [] };
}

/** 컷 복사본: 같은 씬, 새 번호, 미확정 */
function copyCut(src: Cut, number: number): Cut {
  return { ...structuredClone(src), number, confirmed: false, desc: '', memo: '', generatedImages: [], updatedAt: nowIso() };
}

/** 컷 번호를 1부터 다시 매기고 썸네일 키도 옮긴다 */
function renumber(cuts: Cut[], thumbnails: Thumbnails): { cuts: Cut[]; thumbnails: Thumbnails; changed: boolean } {
  const next: Thumbnails = {};
  let changed = false;
  const out = cuts.map((c, i) => {
    const n = i + 1;
    if (thumbnails[c.number]) next[n] = thumbnails[c.number];
    if (c.number !== n) changed = true;
    return c.number === n ? c : { ...c, number: n };
  });
  return { cuts: out, thumbnails: next, changed };
}

export const useStore = create<StoreState>()(
  subscribeWithSelector((set, get) => ({
    ...initialDocument(),
    currentCutIndex: 0,
    selection: { dollId: null, bone: null },
    mode: 'direct',
    settings: loadSettings(),
    settingsOpen: false,
    exportOpen: false,
    helpOpen: false,
    galleryOpen: false,
    assetPanelOpen: true,
    past: [],
    future: [],
    storageKind: 'none',
    folderName: null,
    dirty: false,
    lastSavedAt: null,
    saveError: null,
    statusHint: '',
    thumbnails: {},
    thumbnailDirty: [],
    thumbnailsRenumbered: false,
    screen: 'start',
    characterManagerFor: null,
    sceneBrowserOpen: false,
    sceneBrowserSelectId: null,
    sceneSaveOpen: false,
    scriptImportOpen: false,
    scriptBlocksForced: false,

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
      set({ cuts, past, future: [current, ...s.future], dirty: true, selection: validSelection(s.selection, prev) });
    },

    redo: () => {
      const s = get();
      if (!s.future.length) return;
      const [next, ...future] = s.future;
      const cuts = s.cuts.slice();
      const current = cuts[s.currentCutIndex];
      cuts[s.currentCutIndex] = next;
      set({ cuts, past: [...s.past, current], future, dirty: true, selection: validSelection(s.selection, next) });
    },

    select: (sel) => {
      const cur = get().selection;
      if (cur.dollId === sel.dollId && cur.bone === sel.bone && !!cur.camera === !!sel.camera && (cur.propId ?? null) === (sel.propId ?? null)) return;
      set({ selection: sel });
    },

    setMode: (mode) => set({ mode }),

    addDoll: (dollId, heightCm, position) => {
      const s = get();
      const cut = s.currentCut();
      const used = s.characters.map((c) => c.color);
      const color = pickColor(used);
      const asset = dollAsset(dollId);
      const character = createTemporaryCharacter(s.work.code, asset.id, heightCm, color, s.characters.length + 1);
      const id = newId('doll');
      // 새 돌은 기존 돌과 겹치지 않게 옆으로 비켜 놓는다(끌어다 놓은 자리가 있으면 거기)
      const offsetX = cut.dolls.length === 0 ? 0 : (cut.dolls.length % 2 === 1 ? 1 : -1) * Math.ceil(cut.dolls.length / 2) * 0.7;
      const inst: DollInstance = {
        id,
        characterId: character.id,
        dollId: asset.id,
        heightCm,
        color,
        position: position ? [position[0], 0, position[2]] : [offsetX, 0, 0],
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
        const doll = c.dolls.find((d) => d.id === id);
        c.dolls = c.dolls.filter((d) => d.id !== id);
        // 그 돌이 쥐고 있던 소품은 돌이 있던 자리에 내려놓는다
        for (const p of c.props) {
          if (p.attachedTo?.dollInstanceId === id) {
            delete p.attachedTo;
            p.position = doll ? [doll.position[0], 0.8, doll.position[2]] : [0, 0.8, 0];
            p.rotation = [0, 0, 0, 1];
          }
        }
      });
      const sel = get().selection;
      if (sel.dollId === id) set({ selection: { dollId: null, bone: null } });
    },

    duplicateDoll: (id, offsetX = 0.6) => {
      const s = get();
      const src = s.currentCut().dolls.find((d) => d.id === id);
      if (!src) return null;
      const color = pickColor(s.characters.map((c) => c.color));
      const character = createTemporaryCharacter(s.work.code, src.dollId, src.heightCm, color, s.characters.length + 1);
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
      // 임시 캐릭터는 돌을 따라 바뀌고, 등록 캐릭터는 캐릭터 관리에서만 바꾼다(여기서는 이 돌만)
      set({ characters: s.characters.map((c) => (c.id === inst.characterId && c.temporary ? { ...c, color } : c)) });
      get().commitCut((c) => {
        const d = c.dolls.find((x) => x.id === id);
        if (d) d.color = color;
      });
    },

    setDollHeight: (id, heightCm) => {
      const s = get();
      const inst = s.currentCut().dolls.find((d) => d.id === id);
      if (!inst) return;
      set({ characters: s.characters.map((c) => (c.id === inst.characterId && c.temporary ? { ...c, heightCm } : c)) });
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
    setExportOpen: (open) => set({ exportOpen: open }),
    setHelpOpen: (open) => set({ helpOpen: open }),
    setGalleryOpen: (open) => set({ galleryOpen: open }),
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

    updateOutputSettings: (partial) => {
      const w = get().work;
      set({ work: { ...w, output: { ...w.output, ...partial }, updatedAt: nowIso() }, dirty: true });
    },

    loadDocument: (doc, thumbnails = {}) => {
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
        thumbnails,
        thumbnailDirty: [],
        thumbnailsRenumbered: false,
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
      return { work: s.work, episode: { ...s.episode, cutOrder: s.cuts.map((c) => c.number) }, cuts: s.cuts, characters: s.characters };
    },

    setScreen: (screen) => set({ screen }),
    setCharacterManagerFor: (code) => set({ characterManagerFor: code }),

    setCharacters: (chars) => {
      const s = get();
      const kept = s.characters.filter((c) => c.temporary && !chars.some((d) => d.id === c.id));
      set({ characters: [...chars, ...kept] });
    },

    addCharacterDoll: (characterId, position) => {
      const s = get();
      const chr = s.characters.find((c) => c.id === characterId);
      if (!chr) return null;
      const cut = s.currentCut();
      const id = newId('doll');
      const offsetX = cut.dolls.length === 0 ? 0 : (cut.dolls.length % 2 === 1 ? 1 : -1) * Math.ceil(cut.dolls.length / 2) * 0.7;
      const inst: DollInstance = {
        id,
        characterId: chr.id,
        dollId: dollAsset(chr.dollId).id,
        heightCm: chr.heightCm,
        color: chr.color,
        position: position ? [position[0], 0, position[2]] : [offsetX, 0, 0],
        rotation: [0, 0, 0, 1],
        joints: {},
      };
      get().commitCut((c) => {
        c.dolls.push(inst);
      });
      set({ selection: { dollId: id, bone: null } });
      return id;
    },

    assignCharacter: (dollId, characterId) => {
      const s = get();
      const inst = s.currentCut().dolls.find((d) => d.id === dollId);
      if (!inst) return;
      if (characterId) {
        const chr = s.characters.find((c) => c.id === characterId);
        if (!chr) return;
        get().commitCut((c) => {
          const d = c.dolls.find((x) => x.id === dollId);
          if (!d) return;
          d.characterId = chr.id;
          d.color = chr.color;
          d.heightCm = chr.heightCm;
          d.dollId = dollAsset(chr.dollId).id;
        });
        return;
      }
      // 지정 해제: 새 임시 캐릭터를 붙인다
      const color = pickColor(s.characters.map((c) => c.color));
      const character = createTemporaryCharacter(s.work.code, inst.dollId, inst.heightCm, color, s.characters.length + 1);
      set({ characters: [...s.characters, character] });
      get().commitCut((c) => {
        const d = c.dolls.find((x) => x.id === dollId);
        if (!d) return;
        d.characterId = character.id;
        d.color = color;
      });
    },

    setEpisodeTitle: (title) => set({ episode: { ...get().episode, title, updatedAt: nowIso() }, dirty: true }),

    // ---------- 소품 ----------

    addProp: (propId, position) => {
      const cut = get().currentCut();
      const n = cut.props.length;
      // 자리를 안 주면 돌 앞쪽(+Z)에 가로로 비켜 놓는다
      const inst = createPropInstance(propId, position ?? [((n % 3) - 1) * 0.4, position?.[1] ?? 0, 0.6]);
      get().commitCut((c) => {
        c.props.push(inst);
      });
      set({ selection: { dollId: null, bone: null, propId: inst.id } });
      return inst.id;
    },

    removeProp: (id) => {
      get().commitCut((c) => {
        c.props = c.props.filter((p) => p.id !== id);
      });
      if (get().selection.propId === id) set({ selection: { dollId: null, bone: null } });
    },

    duplicateProp: (id) => {
      const src = get().currentCut().props.find((p) => p.id === id);
      if (!src) return null;
      const copy: PropInstance = { ...structuredClone(src), id: newId('pi') };
      if (!copy.attachedTo) copy.position = [src.position[0] + 0.3, src.position[1], src.position[2]];
      get().commitCut((c) => {
        c.props.push(copy);
      });
      set({ selection: { dollId: null, bone: null, propId: copy.id } });
      return copy.id;
    },

    attachProp: (id, dollId, hand, grip) => {
      const s = get();
      if (!s.currentCut().dolls.some((d) => d.id === dollId)) return;
      get().commitCut((c) => {
        const p = c.props.find((x) => x.id === id);
        if (!p) return;
        p.attachedTo = { dollInstanceId: dollId, hand };
        p.position = [...grip.position] as Vec3;
        p.rotation = [...grip.rotation] as Quat;
      });
    },

    updateProp: (id, patch) => {
      get().commitCut((c) => {
        const i = c.props.findIndex((x) => x.id === id);
        if (i < 0) return;
        const next: PropInstance = { ...c.props[i], ...patch };
        if (!next.attachedTo) delete next.attachedTo;
        c.props[i] = next;
      });
    },

    // ---------- 씬 라이브러리 ----------

    openSceneBrowser: (selectId = null) => set({ sceneBrowserOpen: true, sceneBrowserSelectId: selectId, sceneSaveOpen: false }),
    setSceneBrowserOpen: (open) => set(open ? { sceneBrowserOpen: true } : { sceneBrowserOpen: false, sceneBrowserSelectId: null }),
    setSceneSaveOpen: (open) => set({ sceneSaveOpen: open }),

    applyLibraryScene: (item, assignments, mode) => {
      const s = get();
      const { dolls, newCharacters, props } = dollsFromScene(item, assignments, s.characters, s.work.code);
      if (newCharacters.length) set({ characters: [...s.characters, ...newCharacters] });
      get().commitCut((c) => {
        if (mode === 'replace') {
          c.dolls = dolls;
          c.props = props;
          c.camera = { ...item.camera, position: [...item.camera.position] as Vec3 };
          c.aspect = item.aspect;
        } else {
          c.dolls.push(...dolls);
          c.props.push(...props);
        }
      });
      set({ selection: mode === 'add' && dolls.length ? { dollId: dolls[0].id, bone: null } : NO_SELECTION, sceneBrowserOpen: false, sceneBrowserSelectId: null });
    },

    // ---------- 글콘티(NTT) ----------

    setScriptImportOpen: (open) => set({ scriptImportOpen: open }),
    setScriptBlocksForced: (on) => set({ scriptBlocksForced: on }),

    applyScript: (scripts, source) => {
      const s = get();
      const now = nowIso();
      const { cuts, plan } = applyScriptToCuts(s.cuts, scripts, now);
      set({ cuts, episode: { ...s.episode, scriptSource: source, cutOrder: cuts.map((c) => c.number), updatedAt: now }, past: [], future: [], dirty: true });
      return plan;
    },

    setCutScript: (partial) => {
      const s = get();
      const cuts = s.cuts.slice();
      cuts[s.currentCutIndex] = { ...cuts[s.currentCutIndex], ...partial, updatedAt: nowIso() };
      set({ cuts, dirty: true });
    },

    // ---------- 컷 ----------

    confirmCut: (desc) => {
      const s = get();
      const cuts = s.cuts.slice();
      const cur: Cut = { ...cuts[s.currentCutIndex], confirmed: true, desc, updatedAt: nowIso() };
      cuts[s.currentCutIndex] = cur;
      const idx = s.currentCutIndex + 1;
      if (idx >= cuts.length) cuts.push(copyCut(cur, cuts.length + 1));
      set({ cuts, currentCutIndex: idx, past: [], future: [], dirty: true, episode: { ...s.episode, cutOrder: cuts.map((c) => c.number) } });
    },

    goToCut: (index) => {
      const s = get();
      const i = Math.max(0, Math.min(s.cuts.length - 1, index));
      if (i === s.currentCutIndex) return;
      set({ currentCutIndex: i, past: [], future: [], selection: validSelection(s.selection, s.cuts[i]) });
    },

    nextCut: () => {
      const s = get();
      if (s.currentCutIndex + 1 < s.cuts.length) {
        get().goToCut(s.currentCutIndex + 1);
        return;
      }
      // 아래 컷이 없으면 현재 컷을 복사해 만들고 거기로
      const cuts = [...s.cuts, copyCut(s.cuts[s.currentCutIndex], s.cuts.length + 1)];
      set({ cuts, currentCutIndex: cuts.length - 1, past: [], future: [], dirty: true, episode: { ...s.episode, cutOrder: cuts.map((c) => c.number) } });
    },

    prevCut: () => {
      const s = get();
      if (s.currentCutIndex > 0) get().goToCut(s.currentCutIndex - 1);
    },

    insertCutAfter: (index) => {
      const s = get();
      const src = s.cuts[index] ?? s.cuts[s.cuts.length - 1];
      const cuts = s.cuts.slice();
      cuts.splice(index + 1, 0, copyCut(src, 0));
      const r = renumber(cuts, s.thumbnails);
      set({ cuts: r.cuts, thumbnails: r.thumbnails, thumbnailsRenumbered: s.thumbnailsRenumbered || r.changed, currentCutIndex: index + 1, past: [], future: [], dirty: true, episode: { ...s.episode, cutOrder: r.cuts.map((c) => c.number) } });
    },

    deleteCut: (index) => {
      const s = get();
      let cuts = s.cuts.filter((_, i) => i !== index);
      const thumbs = { ...s.thumbnails };
      delete thumbs[s.cuts[index]?.number];
      if (!cuts.length) cuts = [createCut(1)];
      const r = renumber(cuts, thumbs);
      const idx = Math.max(0, Math.min(r.cuts.length - 1, index));
      set({ cuts: r.cuts, thumbnails: r.thumbnails, thumbnailsRenumbered: true, currentCutIndex: idx, past: [], future: [], dirty: true, selection: validSelection(s.selection, r.cuts[idx]), episode: { ...s.episode, cutOrder: r.cuts.map((c) => c.number) } });
    },

    moveCut: (index, delta) => {
      const s = get();
      const to = index + delta;
      if (to < 0 || to >= s.cuts.length) return;
      const cuts = s.cuts.slice();
      const [item] = cuts.splice(index, 1);
      cuts.splice(to, 0, item);
      const r = renumber(cuts, s.thumbnails);
      set({ cuts: r.cuts, thumbnails: r.thumbnails, thumbnailsRenumbered: true, currentCutIndex: s.currentCutIndex === index ? to : s.currentCutIndex, past: [], future: [], dirty: true, episode: { ...s.episode, cutOrder: r.cuts.map((c) => c.number) } });
    },

    setCutMemo: (memo) => {
      const s = get();
      const cuts = s.cuts.slice();
      cuts[s.currentCutIndex] = { ...cuts[s.currentCutIndex], memo, updatedAt: nowIso() };
      set({ cuts, dirty: true });
    },

    setThumbnail: (cutNumber, dataUrl) => {
      const s = get();
      set({ thumbnails: { ...s.thumbnails, [cutNumber]: dataUrl }, thumbnailDirty: [...new Set([...s.thumbnailDirty, cutNumber])] });
    },

    markThumbnailsSaved: () => set({ thumbnailDirty: [], thumbnailsRenumbered: false }),
  })),
);

/** 현재 컷 선택자(엔진 구독용) */
export const selectCurrentCut = (s: StoreState): Cut => s.cuts[s.currentCutIndex];
