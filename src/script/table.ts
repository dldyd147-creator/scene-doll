// 글콘티 표 읽기: .xlsx(최소 리더) 또는 구분자 텍스트(.csv/.tsv). 한국어 엑셀이 내보내는 EUC-KR CSV도 읽는다.
import { readXlsxRows } from './xlsx';

/** UTF-8(BOM 허용)로 읽되 깨지면 EUC-KR로 다시 읽는다 */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf);
    } catch {
      return new TextDecoder().decode(buf);
    }
  }
}

function detectDelimiter(firstLine: string): string {
  const candidates = ['\t', ',', ';'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const n = firstLine.split(d).length - 1;
    if (n > bestCount) {
      bestCount = n;
      best = d;
    }
  }
  return best;
}

/** 구분자 텍스트 → 행 배열. 따옴표 안의 구분자·줄바꿈·""를 처리한다 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const d = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

/** 파일 이름·바이트 → 행 배열 */
export async function readTableFile(name: string, buf: ArrayBuffer): Promise<string[][]> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return readXlsxRows(buf);
  if (lower.endsWith('.xls')) throw new Error('옛 .xls 형식은 읽지 못합니다. 엑셀에서 .xlsx 또는 CSV로 저장해 주세요');
  return parseDelimited(decodeText(buf));
}
