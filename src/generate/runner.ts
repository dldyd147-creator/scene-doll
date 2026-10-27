import type { Engine } from '../engine/Engine';
import { analyzeCut } from '../describe/analyze';
import { cutBlock } from '../describe/text';
import { mainReferenceOf, refLabel } from '../model/defaults';
import type { Character, Cut } from '../model/types';
import type { GenQuality, Settings } from '../state/settings';
import { useStore } from '../state/store';
import { storage } from '../storage';
import { useLibrary } from '../ui/library';
import { buildCutPackage, characterFolders, safeFolderName, type CutPackage } from '../ui/packager';
import { saveNow } from '../ui/save';
import { batchKey, buildBatchPrompt, groupCuts, layoutGrid, nextCandidateIndex, PRESETS, requestSize, type CutBatch, type GridLayout, type PromptAttachment } from './batch';
import { canvasToBlob, composeGrid, onWhite, splitResult } from './compose';
import { GenError, type GenEngine, type GenErrorKind, type GenInputImage, type GenUsage } from './engine';

/**
 * 묶음 생성 흐름(브라우저 쪽 조립):
 * 1) prepareBatches — 확정 컷을 묶고, 묶음마다 돌 렌더를 격자 한 장으로 합성(+선화·마스크 격자), 등장 캐릭터 레퍼런스를 모으고, 프롬프트를 쓴다. 네트워크 없음.
 * 2) 사용자가 프롬프트를 보고(고치고) 보내기를 누르면 runBatches — 엔진 호출 → 결과 격자를 칸대로 잘라 생성/{코드}/{회차}/{컷}/cand_{n}.png 로 저장 → cut.generatedImages 에 적는다.
 */

/** OpenAI Images API edits 입력 상한(2026-10 문서: GPT 이미지 모델은 최대 16장) */
export const MAX_INPUT_IMAGES = 16;

export interface PreparedBatch {
  id: string;
  /** 묶음 태그 */
  key: string;
  cuts: Cut[];
  layout: GridLayout;
  packages: CutPackage[];
  /** 첨부 순서대로: 돌 격자, (선화 격자), (마스크 격자), 레퍼런스… */
  images: GenInputImage[];
  /** 돌 격자 미리보기(object URL). 대화상자가 닫힐 때 revoke */
  gridUrl: string;
  prompt: string;
  size: string;
  inputFidelity?: 'high' | 'low';
  warnings: string[];
}

export interface PrepareOptions {
  cuts: Cut[];
  /** true면 컷마다 한 묶음(단독 생성) */
  single: boolean;
  settings: Pick<Settings, 'genMaxPerBatch' | 'genPreset' | 'genCellPx' | 'genSizeMode' | 'genAttachLine' | 'genAttachMask' | 'genRefsPerCharacter' | 'genStyle'>;
}

export interface Progress {
  done: number;
  total: number;
  current: string;
}

/** 다음 프레임까지 기다린다. 탭이 뒤로 가 있으면 rAF가 멈추므로 시간 제한을 둔다 */
const nextFrame = () =>
  new Promise<void>((r) => {
    const t = window.setTimeout(r, 80);
    requestAnimationFrame(() => {
      window.clearTimeout(t);
      r();
    });
  });

let batchSeq = 0;

function extOf(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? 'png';
  return ext === 'jpeg' ? 'jpg' : ext;
}

function mimeOf(ext: string): string {
  return ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
}

/** 묶음에 등장하는 등록 캐릭터(첫 등장 순) */
function registeredCharactersOf(packages: CutPackage[], characters: Character[]): Character[] {
  const out: Character[] = [];
  for (const p of packages)
    for (const c of p.characters) {
      if (!c.registered || out.some((x) => x.id === c.characterId)) continue;
      const chr = characters.find((x) => x.id === c.characterId);
      if (chr && !chr.temporary) out.push(chr);
    }
  return out;
}

/** 묶음 준비: 렌더·격자 합성·레퍼런스·프롬프트(네트워크 없음) */
export async function prepareBatches(engine: Engine, opts: PrepareOptions, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<PreparedBatch[]> {
  const s = useStore.getState();
  const { work, episode, characters } = s;
  const st = opts.settings;
  const preset = PRESETS[st.genPreset];
  const groups: CutBatch[] = opts.single ? opts.cuts.map((c) => ({ key: batchKey(c), cuts: [c] })) : groupCuts(opts.cuts, st.genMaxPerBatch);
  const folders = characterFolders(characters);
  const propAssets = useLibrary.getState().props ?? [];
  const repo = storage.repository;
  const currentCut = s.currentCut();
  const total = opts.cuts.length;
  const out: PreparedBatch[] = [];
  let done = 0;

  await engine.ensureTemplatesFor(opts.cuts);
  try {
    for (const group of groups) {
      if (signal?.aborted) break;
      const cellW = Math.max(256, Math.round(st.genCellPx) || 1024);
      const layout = layoutGrid(group.cuts, cellW);
      const renders = new Map<number, HTMLCanvasElement>();
      const lines = new Map<number, HTMLCanvasElement>();
      const masks = new Map<number, HTMLCanvasElement>();
      const packages: CutPackage[] = [];
      for (const cut of group.cuts) {
        if (signal?.aborted) break;
        onProgress?.({ done, total, current: `컷 ${String(cut.number).padStart(3, '0')} 렌더` });
        engine.applyCut(cut);
        for (const rig of engine.dolls.values()) {
          rig.setCrosshair(work.output.crosshair);
          rig.setShading(work.output.shading && cut.light.shading);
          rig.setOutline(cut.outline);
        }
        await nextFrame();
        const h = Math.round(cellW * cut.aspect);
        const cam = engine.manu.camera;
        renders.set(cut.number, preset.input === 'silhouette' ? onWhite(engine.renderPass(cam, cellW, h, 'mask')) : engine.renderToCanvas(cam, cellW, h, { background: 'white' }));
        if (st.genAttachLine) lines.set(cut.number, engine.renderPass(cam, cellW, h, 'line'));
        if (st.genAttachMask) masks.set(cut.number, onWhite(engine.renderPass(cam, cellW, h, 'mask')));
        const analysis = analyzeCut(engine, cut, characters);
        const block = cutBlock(analysis, cut, work.code, episode.number, propAssets);
        packages.push(buildCutPackage(work, episode, cut, analysis, characters, folders, work.output.width || 1024, block));
        done++;
      }
      if (signal?.aborted) break;
      const labels = group.cuts.length > 1;
      const tag = `${work.code}_${String(episode.number).padStart(3, '0')}_${group.cuts.map((c) => String(c.number).padStart(3, '0')).join('-')}`;
      const gridBlob = await canvasToBlob(composeGrid(layout, renders, { labels }));
      const images: GenInputImage[] = [{ name: `${tag}_grid.png`, blob: gridBlob, role: 'grid' }];
      const attachments: PromptAttachment[] = [{ role: 'grid', name: images[0].name, note: preset.input === 'silhouette' ? '돌 격자(캐릭터 고정색 실루엣, 배치·대략의 자세 참고)' : '돌 격자(포즈·구도·카메라 참고)' }];
      if (st.genAttachLine) {
        const blob = await canvasToBlob(composeGrid(layout, lines, { labels }));
        images.push({ name: `${tag}_line.png`, blob, role: 'line' });
        attachments.push({ role: 'line', name: `${tag}_line.png`, note: '같은 격자의 선화(돌 실루엣 외곽선·십자선). 윤곽과 눈높이 참고' });
      }
      if (st.genAttachMask) {
        const blob = await canvasToBlob(composeGrid(layout, masks, { labels }));
        images.push({ name: `${tag}_mask.png`, blob, role: 'mask' });
        attachments.push({ role: 'mask', name: `${tag}_mask.png`, note: '같은 격자의 색 마스크(캐릭터 고정색 평면). 어느 인물이 어디에 있는지' });
      }
      // 등장 캐릭터 레퍼런스(대표부터, 캐릭터당 장수 제한, 전체 16장 상한)
      const warnings: string[] = [];
      const perChar = Math.max(0, Math.min(8, Math.round(st.genRefsPerCharacter)));
      const room = MAX_INPUT_IMAGES - images.length;
      let truncated = 0;
      for (const chr of registeredCharactersOf(packages, characters)) {
        const main = mainReferenceOf(chr);
        const refs = [...(main ? [main] : []), ...chr.references.filter((r) => r.id !== main?.id)].slice(0, perChar);
        if (!refs.length) warnings.push(`${chr.name}: 레퍼런스가 없어 글 설명만 보냅니다`);
        for (const r of refs) {
          if (images.length >= MAX_INPUT_IMAGES) {
            truncated++;
            continue;
          }
          const buf = await repo.readReference(work.code, chr.id, r.file).catch(() => null);
          if (!buf) {
            warnings.push(`${chr.name}: 레퍼런스 파일 ${r.file}을 읽지 못했습니다`);
            continue;
          }
          const ext = extOf(r.file);
          const idx = images.filter((i) => i.role === 'reference' && i.name.includes(`ref_${safeFolderName(chr.name, chr.id)}_`)).length + 1;
          const name = `ref_${safeFolderName(chr.name, chr.id)}_${idx}.${ext}`;
          images.push({ name, blob: new Blob([buf], { type: mimeOf(ext) }), role: 'reference' });
          attachments.push({ role: 'reference', name, note: `${chr.name} 레퍼런스(${refLabel(r)}${main?.id === r.id ? ' · 대표' : ''})`, characterId: chr.id });
        }
      }
      if (truncated) warnings.push(`첨부 상한 ${MAX_INPUT_IMAGES}장(여유 ${room}장)을 넘어 레퍼런스 ${truncated}장을 뺐습니다`);
      const size = requestSize(layout, st.genSizeMode);
      const prompt = buildBatchPrompt({ work: { code: work.code, name: work.name }, episode: episode.number, layout, packages, preset: st.genPreset, attachments, outputSize: size, style: st.genStyle });
      out.push({ id: `b${++batchSeq}`, key: group.key, cuts: group.cuts, layout, packages, images, gridUrl: URL.createObjectURL(gridBlob), prompt, size, inputFidelity: preset.fidelity, warnings });
    }
  } finally {
    engine.applyCut(currentCut);
  }
  onProgress?.({ done: total, total, current: '' });
  return out;
}

export interface BatchOutcome {
  batchId: string;
  cuts: number[];
  ok: boolean;
  errorKind?: GenErrorKind;
  error?: string;
  /** 묶음 결과 격자(object URL) */
  resultUrls: string[];
  /** 컷 번호 → 이번에 저장한 후보 경로 */
  saved: Record<number, string[]>;
  /** API가 돌려준 토큰 사용량(과금 확인용)·모델 */
  usage?: GenUsage;
  model?: string;
  /** 경계선 검출 요약(결과마다 한 줄, 묶음이 2칸 이상일 때) */
  boundary?: string;
}

export interface RunOptions {
  n: number;
  quality: GenQuality;
  signal: AbortSignal;
  onProgress?: (p: Progress) => void;
  /** 묶음 하나가 끝날 때마다 */
  onBatch?: (outcome: BatchOutcome) => void;
}

/** 묶음들을 차례로 엔진에 보내고 결과를 잘라 저장한다. 실패한 묶음은 건너뛰고 계속, 취소되면 멈춘다 */
export async function runBatches(gen: GenEngine, batches: PreparedBatch[], opts: RunOptions): Promise<BatchOutcome[]> {
  const s = useStore.getState();
  const { work, episode } = s;
  const repo = storage.repository;
  const outcomes: BatchOutcome[] = [];
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const outcome: BatchOutcome = { batchId: b.id, cuts: b.cuts.map((c) => c.number), ok: false, resultUrls: [], saved: {} };
    if (opts.signal.aborted) {
      outcome.errorKind = 'cancelled';
      outcome.error = '취소됨';
      outcomes.push(outcome);
      continue;
    }
    const label = `묶음 ${i + 1}/${batches.length} (컷 ${b.cuts.map((c) => c.number).join('·')})`;
    try {
      opts.onProgress?.({ done: i, total: batches.length, current: `${label} 보내는 중…` });
      const result = await gen.generate({ prompt: b.prompt, images: b.images, size: b.size, n: opts.n, quality: opts.quality, inputFidelity: b.inputFidelity, signal: opts.signal });
      outcome.usage = result.usage;
      outcome.model = result.model;
      opts.onProgress?.({ done: i, total: batches.length, current: `${label} 분할·저장` });
      const existing = new Map<number, string[]>();
      for (const cut of b.cuts) existing.set(cut.number, await repo.listGenerated(work.code, episode.number, cut.number).catch(() => []));
      const notes: string[] = [];
      for (const img of result.images) {
        outcome.resultUrls.push(URL.createObjectURL(img));
        const { parts, note } = await splitResult(img, b.layout);
        if (note) notes.push(note);
        for (const cut of b.cuts) {
          const blob = parts.get(cut.number);
          if (!blob) continue;
          const list = existing.get(cut.number)!;
          const k = nextCandidateIndex(list);
          const path = await repo.writeGenerated(work.code, episode.number, cut.number, k, blob);
          list.push(path);
          useLibrary.setState((st) => {
            // 지웠던 번호를 다시 쓰면 같은 경로라 미리보기 캐시가 옛 그림을 보여 주므로 비운다
            const { [path]: _stale, ...rest } = st.thumbs;
            return { thumbs: rest };
          });
          (outcome.saved[cut.number] ??= []).push(path);
        }
      }
      for (const cut of b.cuts) useStore.getState().addGeneratedImages(cut.number, outcome.saved[cut.number] ?? []);
      if (notes.length) outcome.boundary = notes.length === 1 ? notes[0] : notes.map((n, k) => `${k + 1}: ${n}`).join(' / ');
      outcome.ok = Object.keys(outcome.saved).length > 0;
      if (!outcome.ok) {
        outcome.errorKind = 'server';
        outcome.error = '결과를 잘라 저장하지 못했습니다';
      }
    } catch (e) {
      if (e instanceof GenError) {
        outcome.errorKind = e.kind;
        outcome.error = e.message;
      } else {
        outcome.errorKind = opts.signal.aborted ? 'cancelled' : 'request';
        outcome.error = e instanceof Error ? e.message : String(e);
      }
    }
    outcomes.push(outcome);
    opts.onBatch?.(outcome);
    if (outcome.errorKind === 'cancelled') break;
  }
  opts.onProgress?.({ done: batches.length, total: batches.length, current: '' });
  await saveNow();
  return outcomes;
}

/** 준비한 묶음의 미리보기 URL 해제 */
export function disposeBatches(batches: PreparedBatch[]): void {
  for (const b of batches) URL.revokeObjectURL(b.gridUrl);
}

export function disposeOutcomes(outcomes: BatchOutcome[]): void {
  for (const o of outcomes) for (const u of o.resultUrls) URL.revokeObjectURL(u);
}
