// 글콘티(NTT 엑셀) 연동의 순수 로직. 기획서 '추가 요구: 글콘티(NTT) 연동'.
// 표(행 배열) → 열 매핑(첫 행으로 자동 판정, 사용자가 확인) → 컷별 대사·지문·비고 → 회차 컷에 반영.
import type { Cut } from '../model/types';

export type ScriptField = 'cut' | 'speaker' | 'text' | 'note' | 'remark';

export const SCRIPT_FIELDS: Array<{ id: ScriptField; label: string; hint: string }> = [
  { id: 'cut', label: '컷 번호', hint: '비어 있으면 앞 행의 컷에 이어 붙는다. 열이 없으면 행마다 한 컷' },
  { id: 'speaker', label: '화자', hint: '대사를 말하는 인물' },
  { id: 'text', label: '대사', hint: '원고뷰 위에 들어간다' },
  { id: 'note', label: '지문', hint: '장면 설명. 원고뷰 아래에 들어간다' },
  { id: 'remark', label: '비고', hint: '컷 메모에 붙는다' },
];

/** 제목 줄 판정 패턴(앞에서부터 먼저 맞는 열을 쓴다) */
const HEADER_PATTERNS: Record<ScriptField, RegExp> = {
  cut: /^(컷\s*(번호|no\.?|#)?|cut\s*(no\.?|#|number)?|씬\s*번호|번호|no\.?|#|순번)$/i,
  speaker: /^(화자|인물|캐릭터|등장\s*인물|말하는\s*사람|speaker|character|name|who)$/i,
  text: /^(대사|대화|말|대사\s*내용|dialog(ue)?|line|lines|text|speech)$/i,
  note: /^(지문|장면|장면\s*설명|상황|상황\s*설명|액션|행동|연출|묘사|action|description|direction|scene|narration|내레이션)$/i,
  remark: /^(비고|메모|참고|기타|remark|remarks|memo|note|notes|comment|comments)$/i,
};

/** 필드 → 열 인덱스(없으면 undefined) */
export type ColumnMapping = Partial<Record<ScriptField, number>>;

export interface DetectedColumns {
  mapping: ColumnMapping;
  /** 첫 행이 제목 줄인지 */
  hasHeader: boolean;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** 첫 행을 보고 열 매핑을 잡는다. 제목 줄로 보이지 않으면 열 순서(컷·화자·대사·지문·비고)로 둔다 */
export function detectColumns(rows: string[][]): DetectedColumns {
  const first = rows[0] ?? [];
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const f of SCRIPT_FIELDS) {
    for (let i = 0; i < first.length; i++) {
      if (used.has(i)) continue;
      if (HEADER_PATTERNS[f.id].test(norm(first[i]))) {
        mapping[f.id] = i;
        used.add(i);
        break;
      }
    }
  }
  const matched = Object.keys(mapping).length;
  if (matched >= 2) return { mapping, hasHeader: true };
  const width = Math.max(0, ...rows.map((r) => r.length));
  const byOrder: ColumnMapping = {};
  SCRIPT_FIELDS.forEach((f, i) => {
    if (i < width) byOrder[f.id] = i;
  });
  return { mapping: byOrder, hasHeader: false };
}

export interface ScriptRow {
  /** 표에 적힌 컷 번호(비어 있으면 앞 행 것을 잇는다) */
  cut: number;
  speaker: string;
  text: string;
  note: string;
  remark: string;
}

/** "#12", "12컷", "C012" 같은 값에서 번호를 뽑는다 */
export function parseCutNumber(raw: string): number | null {
  const m = /\d+/.exec(raw);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 행 배열 + 매핑 → 컷 번호가 붙은 글콘티 행. 빈 행은 건너뛴다 */
export function extractRows(rows: string[][], mapping: ColumnMapping, hasHeader: boolean): ScriptRow[] {
  const out: ScriptRow[] = [];
  const cell = (row: string[], f: ScriptField): string => {
    const i = mapping[f];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  let current = 0;
  for (let r = hasHeader ? 1 : 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((v) => v.trim() === '')) continue;
    const speaker = cell(row, 'speaker');
    const text = cell(row, 'text');
    const note = cell(row, 'note');
    const remark = cell(row, 'remark');
    if (!speaker && !text && !note && !remark && !cell(row, 'cut')) continue;
    let cut: number;
    if (mapping.cut === undefined) cut = current + 1;
    else {
      const n = parseCutNumber(cell(row, 'cut'));
      cut = n ?? (current || 1);
    }
    current = cut;
    out.push({ cut, speaker, text, note, remark });
  }
  return out;
}

export type DialogueLine = { speaker: string; text: string; position: 'top' | 'bottom' };

export interface CutScript {
  cut: number;
  dialogue: DialogueLine[];
  note: string;
  remark: string;
}

/** 같은 컷 번호의 행을 묶는다(컷 번호 순) */
export function groupByCut(rows: ScriptRow[]): CutScript[] {
  const map = new Map<number, CutScript>();
  for (const r of rows) {
    let g = map.get(r.cut);
    if (!g) {
      g = { cut: r.cut, dialogue: [], note: '', remark: '' };
      map.set(r.cut, g);
    }
    if (r.text) g.dialogue.push({ speaker: r.speaker, text: r.text, position: 'top' });
    if (r.note) g.note = g.note ? `${g.note}\n${r.note}` : r.note;
    if (r.remark && !g.remark.includes(r.remark)) g.remark = g.remark ? `${g.remark} · ${r.remark}` : r.remark;
  }
  return [...map.values()].sort((a, b) => a.cut - b.cut);
}

export interface ApplyPlan {
  /** 글콘티가 채울 컷 수 */
  filled: number;
  /** 모자라서 마지막 컷을 복사해 새로 만들 컷 수 */
  created: number;
  /** 글콘티에 없어 그대로 두는 기존 컷 번호 */
  leftover: number[];
  /** 글콘티 컷 번호 범위 */
  maxCut: number;
}

/** 반영 전에 무엇이 바뀌는지 미리 센다 */
export function planApply(cutCount: number, scripts: CutScript[]): ApplyPlan {
  const maxCut = scripts.reduce((m, s) => Math.max(m, s.cut), 0);
  const listed = new Set(scripts.map((s) => s.cut));
  const leftover: number[] = [];
  for (let n = 1; n <= cutCount; n++) if (!listed.has(n)) leftover.push(n);
  return { filled: scripts.length, created: Math.max(0, maxCut - cutCount), leftover, maxCut };
}

function copyCut(src: Cut, number: number, now: string): Cut {
  return { ...structuredClone(src), number, confirmed: false, desc: '', memo: '', generatedImages: [], dialogue: [], scriptNote: '', updatedAt: now };
}

/** 메모에 비고를 붙인다(이미 있으면 그대로) */
export function mergeRemark(memo: string, remark: string): string {
  const r = remark.trim();
  if (!r) return memo;
  const m = memo.trim();
  if (!m) return r;
  return m.includes(r) ? m : `${m} · ${r}`;
}

/**
 * 글콘티를 컷 목록에 반영한 새 컷 목록.
 * 컷 번호가 컷 수를 넘으면 마지막 컷을 복사해 만들고(기획서: 부족한 컷은 앞 컷을 복사), 글콘티에 없는 컷은 그대로 둔다.
 * 대사·지문은 덮어쓰고 비고는 메모에 붙인다. 순서는 바꾸지 않는다.
 */
export function applyScriptToCuts(cuts: Cut[], scripts: CutScript[], now: string): { cuts: Cut[]; plan: ApplyPlan } {
  const plan = planApply(cuts.length, scripts);
  const out = cuts.map((c) => structuredClone(c));
  while (out.length < plan.maxCut) out.push(copyCut(out[out.length - 1], out.length + 1, now));
  for (const s of scripts) {
    const c = out[s.cut - 1];
    if (!c) continue;
    c.dialogue = s.dialogue.map((d) => ({ ...d }));
    c.scriptNote = s.note;
    c.memo = mergeRemark(c.memo, s.remark);
    c.updatedAt = now;
  }
  return { cuts: out, plan };
}

/** 원고뷰 대사 칸의 글("화자: 대사" 한 줄에 하나) ↔ dialogue[] */
export function dialogueToText(lines: DialogueLine[] | undefined): string {
  return (lines ?? []).map((d) => (d.speaker ? `${d.speaker}: ${d.text}` : d.text)).join('\n');
}

export function textToDialogue(text: string, position: 'top' | 'bottom' = 'top'): DialogueLine[] {
  const out: DialogueLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:：]{1,12})\s*[:：]\s*(.+)$/.exec(line);
    if (m) out.push({ speaker: m[1].trim(), text: m[2].trim(), position });
    else out.push({ speaker: '', text: line, position });
  }
  return out;
}
