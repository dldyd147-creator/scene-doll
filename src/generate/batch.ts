import type { Cut } from '../model/types';
import type { GenPreset, GenSizeMode } from '../state/settings';
import { pad3 } from '../storage/backend';
import type { CutPackage } from '../ui/packager';
import type { GenImageRole } from './engine';

/**
 * 묶음 생성의 순수 로직(브라우저 API 없음, 테스트 대상):
 * 컷 묶기(묶음 태그·상한) → 격자 배치 → 요청 크기 → 결과 분할 좌표 → 묶음 프롬프트 조립.
 */

// ---------- 컷 묶기 ----------

export interface CutBatch {
  /** 묶음 태그(첫 태그). 없으면 '' */
  key: string;
  cuts: Cut[];
}

/** 컷의 묶음 키: 첫 묶음 태그. 태그가 없으면 ''(순서대로 묶임) */
export function batchKey(cut: Pick<Cut, 'groupTags'>): string {
  return (cut.groupTags ?? []).map((t) => t.trim()).find((t) => t.length > 0) ?? '';
}

/** len개를 max 이하로 균등하게 나눈 조각 크기들(5·4 → [3, 2], 9·4 → [3, 3, 3]) */
export function chunkSizes(len: number, max: number): number[] {
  if (len <= 0) return [];
  const chunks = Math.ceil(len / max);
  const base = Math.floor(len / chunks);
  const extra = len - base * chunks;
  return Array.from({ length: chunks }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * 같은 묶음 태그의 컷을 상한(4·6·8) 이하로 묶는다. 태그가 없는 컷은 순서대로 묶인다.
 * 나머지가 한 컷만 남지 않도록 균등 분할(5컷 → 3+2). 묶음 순서는 첫 컷 번호 순.
 */
export function groupCuts(cuts: Cut[], maxPerBatch: number): CutBatch[] {
  const max = Math.max(1, Math.min(8, Math.floor(maxPerBatch) || 4));
  const groups = new Map<string, Cut[]>();
  for (const c of cuts) {
    const k = batchKey(c);
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  const out: CutBatch[] = [];
  for (const [key, list] of groups) {
    let i = 0;
    for (const size of chunkSizes(list.length, max)) {
      out.push({ key, cuts: list.slice(i, i + size) });
      i += size;
    }
  }
  return out.sort((a, b) => a.cuts[0].number - b.cuts[0].number);
}

// ---------- 격자 ----------

/** 칸 수 → 격자(열×행): 1 → 1×1, 2 → 2×1, 3 → 3×1, 4 → 2×2, 5~6 → 3×2, 7~8 → 4×2 */
export function gridFor(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 3) return { cols: 3, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: Math.ceil(n / 2), rows: 2 };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridCell extends Rect {
  /** 1부터 (프롬프트의 칸 번호) */
  index: number;
  cutNumber: number;
  aspect: number;
  /** 컷 이미지가 실제로 놓이는 영역(칸 안에서 세로 가운데 맞춤). 화면비가 다른 컷이 섞이면 칸보다 작다 */
  inner: Rect;
}

export interface GridLayout {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  width: number;
  height: number;
  cells: GridCell[];
}

/**
 * 컷들을 같은 크기의 칸에 배치한다. 칸 가로 = cellW, 칸 세로 = 가장 긴 화면비 × cellW.
 * 화면비가 짧은 컷은 칸 안에서 세로 가운데에 놓이고 위아래는 여백(회색)이 된다.
 */
export function layoutGrid(cuts: Array<{ number: number; aspect: number }>, cellW: number): GridLayout {
  const { cols, rows } = gridFor(cuts.length);
  const w = Math.max(64, Math.round(cellW));
  const maxAspect = cuts.reduce((m, c) => Math.max(m, c.aspect), 1);
  const cellH = Math.round(w * maxAspect);
  const cells: GridCell[] = cuts.map((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * w;
    const y = row * cellH;
    const innerH = Math.min(cellH, Math.round(w * c.aspect));
    return { index: i + 1, cutNumber: c.number, aspect: c.aspect, x, y, w, h: cellH, inner: { x, y: y + Math.round((cellH - innerH) / 2), w, h: innerH } };
  });
  return { cols, rows, cellW: w, cellH, width: cols * w, height: rows * cellH, cells };
}

// ---------- 요청 크기 ----------

/** gpt-image-2 계열의 임의 크기 규칙(2026-10 문서): 16의 배수, 변 ≤ 3840, 비율 ≤ 3:1, 총 픽셀 655,360~8,294,400 */
export const SIZE_LIMITS = { step: 16, maxEdge: 3840, maxRatio: 3, minPixels: 655_360, maxPixels: 8_294_400 } as const;

export const FIXED_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;

/** 격자 비율을 지키며 API 규칙 안으로 맞춘 WIDTHxHEIGHT */
export function customSize(width: number, height: number): { width: number; height: number } {
  const L = SIZE_LIMITS;
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  // 비율 3:1 안으로
  if (w / h > L.maxRatio) h = w / L.maxRatio;
  if (h / w > L.maxRatio) w = h / L.maxRatio;
  // 총 픽셀
  const px = w * h;
  if (px > L.maxPixels) {
    const s = Math.sqrt(L.maxPixels / px);
    w *= s;
    h *= s;
  } else if (px < L.minPixels) {
    const s = Math.sqrt(L.minPixels / px);
    w *= s;
    h *= s;
  }
  // 긴 변
  const edge = Math.max(w, h);
  if (edge > L.maxEdge) {
    const s = L.maxEdge / edge;
    w *= s;
    h *= s;
  }
  // 16의 배수(내림). 내림 때문에 비율이 3:1을 넘거나 최소 픽셀을 못 채우면 짧은 변을 한 단계씩 올린다
  let W = Math.max(L.step, Math.floor(w / L.step) * L.step);
  let H = Math.max(L.step, Math.floor(h / L.step) * L.step);
  while (W / H > L.maxRatio) H += L.step;
  while (H / W > L.maxRatio) W += L.step;
  while (W * H < L.minPixels && Math.max(W, H) + L.step <= L.maxEdge) {
    if (W <= H) W += L.step;
    else H += L.step;
  }
  return { width: W, height: H };
}

/** 고정 3종 중 비율이 가장 가까운 것 */
export function nearestFixedSize(width: number, height: number): (typeof FIXED_SIZES)[number] {
  const r = width / height;
  let best: (typeof FIXED_SIZES)[number] = FIXED_SIZES[0];
  let bestDiff = Infinity;
  for (const s of FIXED_SIZES) {
    const [w, h] = s.split('x').map(Number);
    const d = Math.abs(Math.log(w / h) - Math.log(r));
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best;
}

/** 설정의 크기 방식 → API size 값 */
export function requestSize(layout: { width: number; height: number }, mode: GenSizeMode): string {
  if (mode === 'auto') return 'auto';
  if (mode === 'fixed') return nearestFixedSize(layout.width, layout.height);
  const s = customSize(layout.width, layout.height);
  return `${s.width}x${s.height}`;
}

// ---------- 결과 분할 ----------

export interface SplitRect extends Rect {
  index: number;
  cutNumber: number;
}

/** 결과 이미지 크기가 요청과 달라도 격자 비율대로 칸(안쪽 영역)을 자른다 */
export function splitRects(layout: GridLayout, resultW: number, resultH: number): SplitRect[] {
  const sx = resultW / layout.width;
  const sy = resultH / layout.height;
  return layout.cells.map((c) => {
    const x = Math.round(c.inner.x * sx);
    const y = Math.round(c.inner.y * sy);
    const x2 = Math.round((c.inner.x + c.inner.w) * sx);
    const y2 = Math.round((c.inner.y + c.inner.h) * sy);
    return { index: c.index, cutNumber: c.cutNumber, x, y, w: Math.max(1, Math.min(resultW, x2) - x), h: Math.max(1, Math.min(resultH, y2) - y) };
  });
}

// ---------- 강도 프리셋 ----------

export interface PresetDef {
  id: GenPreset;
  label: string;
  short: string;
  /** 프롬프트에 붙는 문구 */
  lines: string[];
  /** 돌 이미지 입력 방식: 원본 렌더 / 색 실루엣(마스크 패스) */
  input: 'render' | 'silhouette';
  /** API 입력 충실도(지원 모델에서만 전달) */
  fidelity?: 'high' | 'low';
}

export const PRESETS: Record<GenPreset, PresetDef> = {
  doll: {
    id: 'doll',
    label: '돌 우선',
    short: '포즈·카메라를 정확히 따름 · 원본 렌더 · 충실도 높게',
    lines: ['각 칸의 돌 포즈(관절 각도·고개 방향), 카메라 앵글, 인물의 화면 위치와 크기를 정확히 그대로 따른다.', '돌과 다른 자세·구도로 바꾸지 않는다. 손·표정·옷 주름 같은 세부만 자연스럽게 채운다.'],
    input: 'render',
    fidelity: 'high',
  },
  balanced: {
    id: 'balanced',
    label: '균형',
    short: '포즈·구도를 참고 · 원본 렌더 · 기본값',
    lines: ['각 칸의 돌 포즈와 구도를 참고해 그린다. 인물의 위치·크기·앵글은 유지하되, 자연스러운 연출을 위해 자세의 세부는 보정해도 된다.'],
    input: 'render',
  },
  prompt: {
    id: 'prompt',
    label: '프롬프트 우선',
    short: '느슨한 참고 · 색 실루엣 입력 · 충실도 낮게',
    lines: ['첨부한 격자는 인물의 배치와 대략의 자세만 알려 주는 색 실루엣이다. 느슨한 참고로만 쓰고, 아래 글 설명을 우선해 가장 설득력 있는 연출로 그린다.'],
    input: 'silhouette',
    fidelity: 'low',
  },
};

export const PRESET_ORDER: GenPreset[] = ['doll', 'balanced', 'prompt'];

// ---------- 프롬프트 ----------

export interface PromptAttachment {
  role: GenImageRole;
  name: string;
  /** 첨부 목록에 적는 설명 */
  note: string;
  /** 레퍼런스라면 그 캐릭터 ID */
  characterId?: string;
}

export interface BatchPromptInput {
  work: { code: string; name: string };
  episode: number;
  layout: GridLayout;
  /** layout.cells 순서와 같다 */
  packages: CutPackage[];
  preset: GenPreset;
  attachments: PromptAttachment[];
  /** API에 요청하는 출력 크기('auto' 또는 WxH) */
  outputSize: string;
  /** 화풍 문구(선택) */
  style?: string;
}

const GENDER_LABEL = { male: '남', female: '여', other: '기타' } as const;

/** 컷 설명 블록(cutBlock)에서 제목 줄을 뺀 줄들. 비어 있으면 패키지 필드로 만든다 */
export function descriptionLines(p: CutPackage): string[] {
  const lines = p.scene.description
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('## '));
  if (lines.length) return lines;
  const out = p.characters.map((c) => `${c.colorName} ${c.name}: ${c.placement} · ${c.facing} · ${c.pose}`);
  out.push(`카메라: 높이 ${p.camera.height.toFixed(1)}m · ${p.camera.focal}mm · 거리 ${p.camera.distance.toFixed(1)}m`);
  for (const d of p.scene.dialogue) if (d.text.trim()) out.push(d.speaker.trim() ? `대사(${d.speaker.trim()}): ${d.text.trim()}` : `대사: ${d.text.trim()}`);
  if (p.scene.scriptNote.trim()) out.push(`지문: ${p.scene.scriptNote.trim()}`);
  if (p.scene.memo.trim()) out.push(`메모: ${p.scene.memo.trim()}`);
  return out;
}

/** 묶음 안 등장 캐릭터(색 → 캐릭터) 대응표. 같은 캐릭터는 한 번만 */
export function colorTable(packages: CutPackage[]): CutPackage['characters'] {
  const seen = new Set<string>();
  const out: CutPackage['characters'] = [];
  for (const p of packages)
    for (const c of p.characters) {
      const k = `${c.characterId}|${c.color}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  return out;
}

/**
 * 묶음 프롬프트: 머리말(격자 설명 + 칸↔컷 대응표 + 색→캐릭터 대응표 + 첨부 목록) + 컷별 블록(설명 텍스트 재사용) + 강도 프리셋 문구 + 규칙.
 * 보내기 전에 사용자가 보고 고칠 수 있다.
 */
export function buildBatchPrompt(inp: BatchPromptInput): string {
  const { layout, packages, attachments } = inp;
  const n = packages.length;
  const preset = PRESETS[inp.preset];
  const grid = attachments.find((a) => a.role === 'grid');
  const gridName = grid?.name ?? 'grid.png';
  const sizeText = inp.outputSize === 'auto' ? '' : ` 결과는 ${inp.outputSize.replace('x', '×')}px 한 장으로 낸다.`;
  const L: string[] = [];
  if (n === 1) {
    const p = packages[0];
    L.push(`# ${inp.work.code}_${pad3(inp.episode)}_${pad3(p.cut)} — 웹툰 컷 생성 지시(단독)`);
    L.push(`첨부 1 \`${gridName}\`는 3D 돌로 짠 웹툰 콘티 컷이다(가로 ${layout.width}×세로 ${layout.height}px, 화면비 ${p.frame.aspect}). 돌의 포즈·구도·카메라 앵글을 따라 완성된 웹툰 컷 한 장을 그려라.${sizeText}`);
  } else {
    L.push(`# ${inp.work.code}_${pad3(inp.episode)} 묶음 생성 — 컷 ${packages.map((p) => pad3(p.cut)).join('·')} (${layout.cols}×${layout.rows} 격자 ${n}칸)`);
    L.push(`첨부 1 \`${gridName}\`는 3D 돌로 짠 웹툰 콘티 컷 ${n}개를 ${layout.cols}×${layout.rows} 격자로 붙인 한 장이다(가로 ${layout.width}×세로 ${layout.height}px, 칸 ${layout.cellW}×${layout.cellH}px, 각 칸 왼쪽 위의 숫자가 칸 번호). 같은 격자 구성(${layout.cols}열 ${layout.rows}행, 같은 칸 경계)으로 완성된 웹툰 컷 ${n}개를 한 장에 그려라.${sizeText}`);
  }
  L.push('돌은 색으로 캐릭터를 구분한다. 같은 색의 돌은 모든 칸에서 같은 인물이다.');
  L.push('');
  if (n > 1) {
    L.push('## 칸 ↔ 컷');
    for (const cell of layout.cells) {
      const p = packages[cell.index - 1];
      const pad = cell.inner.h < cell.h ? ' · 칸 위아래의 회색 띠는 컷 바깥 여백' : '';
      L.push(`- ${cell.index}번 칸 = 컷 ${pad3(p.cut)} · 화면비 ${p.frame.aspect} · ${p.frame.shot} · ${p.frame.angle} · ${p.frame.count}인${pad}`);
    }
    const empty = layout.cols * layout.rows - layout.cells.length;
    if (empty > 0) L.push(`- ${layout.cells.length + 1}번${empty > 1 ? `~${layout.cols * layout.rows}번` : ''} 칸은 비어 있다(회색). 그대로 회색으로 둔다.`);
    L.push('');
  }
  L.push('## 색 → 캐릭터');
  const chars = colorTable(packages);
  if (!chars.length) L.push('(화면 안에 인물이 없다. 배경·상황만 그린다)');
  for (const c of chars) {
    const facts: string[] = [`${c.colorName} 돌 = ${c.name}${c.registered ? '' : ' (미등록)'}`, `성별 ${GENDER_LABEL[c.gender]}`, `키 ${c.heightCm}cm`];
    if (c.age !== undefined) facts.push(`나이 ${c.age}`);
    if (c.role) facts.push(`역할 ${c.role}`);
    if (c.oneLine) facts.push(`한 줄: ${c.oneLine}`);
    if (c.appearanceTags.length) facts.push(`외형: ${c.appearanceTags.join(', ')}`);
    if (c.description.trim()) facts.push(`설명: ${c.description.trim().replace(/\s*\n+\s*/g, ' / ')}`);
    const refs = attachments.map((a, i) => ({ a, i })).filter(({ a }) => a.role === 'reference' && a.characterId === c.characterId);
    if (refs.length) facts.push(`레퍼런스(얼굴·머리·복장을 맞출 것): ${refs.map(({ a, i }) => `첨부 ${i + 1} \`${a.name}\``).join(', ')}`);
    else facts.push(c.fallback ?? '레퍼런스 없음');
    L.push(`- ${facts.join(' · ')}`);
  }
  L.push('');
  L.push('## 첨부 이미지');
  attachments.forEach((a, i) => L.push(`${i + 1}. \`${a.name}\` — ${a.note}`));
  L.push('');
  L.push(n === 1 ? '## 컷 지시' : '## 컷별 지시');
  for (const cell of layout.cells) {
    const p = packages[cell.index - 1];
    L.push(n === 1 ? `### 컷 ${pad3(p.cut)} · ${p.frame.shot} · ${p.frame.angle} · ${p.frame.count}인` : `### ${cell.index}번 칸 · 컷 ${pad3(p.cut)}`);
    for (const line of descriptionLines(p)) L.push(`- ${line}`);
  }
  L.push('');
  L.push(`## 강도: ${preset.label}`);
  for (const line of preset.lines) L.push(`- ${line}`);
  if (inp.style?.trim()) {
    L.push('');
    L.push('## 화풍');
    L.push(`- ${inp.style.trim()}`);
  }
  L.push('');
  L.push('## 규칙');
  if (n > 1) L.push('- 격자 구성(열·행·칸 경계)을 유지하고 칸을 합치거나 나누지 않는다. 각 칸은 독립된 한 컷으로 완성한다.');
  L.push(`- ${n > 1 ? '칸 번호 숫자, ' : ''}돌의 십자선, 회색 여백은 그리지 않는다(여백은 컷 바깥이다).`);
  L.push('- 같은 색의 돌은 모든 칸에서 같은 인물이다. 레퍼런스가 있는 캐릭터는 얼굴·머리 모양·복장을 레퍼런스에 맞추고, 없는 돌은 위 지시대로 임의의 인물로 그리되 모든 칸에서 일관되게 유지한다.');
  L.push('- 화면 밖 인물은 그리지 않는다. 배경은 메모·지문을 따르고, 없으면 단순하게 둔다.');
  L.push('- 대사·효과음 글자와 말풍선은 그리지 않는다.');
  return L.join('\n') + '\n';
}

// ---------- 후보 번호 ----------

/** 기존 후보 경로(…/cand_{k}.png)들에서 다음 번호 */
export function nextCandidateIndex(existing: string[]): number {
  let max = 0;
  for (const p of existing) {
    const m = /cand_(\d+)\.png$/.exec(p);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}
