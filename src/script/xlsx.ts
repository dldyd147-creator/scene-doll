// 의존성 없는 최소 .xlsx 읽기. 글콘티(NTT 엑셀) 가져오기용.
// zip 중앙 디렉터리 → 첫 워크시트 XML → 행 배열(셀은 전부 문자열). 수식은 캐시된 값을 쓴다. ZIP64·암호화는 지원하지 않는다.

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

/** 브라우저(및 Node 21+)의 DecompressionStream으로 deflate-raw 풀기 */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function readEntries(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // EOCD 찾기(끝에서 거꾸로, 주석 최대 65535)
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다(.xlsx가 아니거나 깨진 파일)');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new Error('zip 중앙 디렉터리가 깨졌습니다');
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf: ArrayBuffer, entry: ZipEntry, inflate: Inflate): Promise<Uint8Array> {
  const view = new DataView(buf);
  const p = entry.localOffset;
  if (view.getUint32(p, true) !== SIG_LOCAL) throw new Error(`zip 항목이 깨졌습니다: ${entry.name}`);
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, entry.compressedSize);
  if (entry.method === 0) return data.slice();
  if (entry.method === 8) return inflate(data.slice());
  throw new Error(`지원하지 않는 zip 압축 방식(${entry.method}): ${entry.name}`);
}

/** 열 문자 → 0부터 시작하는 인덱스 (A=0, Z=25, AA=26) */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0부터 시작하는 인덱스 → 열 문자 */
export function columnLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** <si> 하나 안의 글자(서식 run은 이어 붙이고 발음 run(rPh)은 뺀다) */
function textOfSi(si: string): string {
  const body = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) out.push(textOfSi(m[1]));
  return out;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

/** 워크시트 XML → 행 배열. 비어 있는 셀은 ''로 채우고, 행 사이의 빈 행은 건너뛴다 */
export function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rowMatch[2] ?? '';
    const cells: string[] = [];
    let last = -1;
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const inner = c[2] ?? '';
      const ref = attr(attrs, 'r');
      const col = ref ? columnIndex(ref) : last + 1;
      const type = attr(attrs, 't');
      let value = '';
      if (type === 'inlineStr') {
        value = inner
          .replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
          .match(/<t\b[^>]*>([\s\S]*?)<\/t>/g)
          ?.map((t) => decodeXml(t.replace(/^<t\b[^>]*>/, '').replace(/<\/t>$/, '')))
          .join('') ?? '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === 's') value = shared[parseInt(v, 10)] ?? '';
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else value = decodeXml(v);
        }
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
      last = col;
    }
    if (cells.some((v) => v !== '')) rows.push(cells);
  }
  return rows;
}

/** 첫 워크시트의 경로(workbook.xml의 첫 sheet → rels). 못 찾으면 sheet1 */
function firstSheetPath(workbookXml: string | null, relsXml: string | null): string {
  const rid = workbookXml ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbookXml)?.[1] : null;
  if (rid && relsXml) {
    const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*>`).exec(relsXml)?.[0];
    const target = rel ? /\bTarget="([^"]+)"/.exec(rel)?.[1] : null;
    if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  return 'xl/worksheets/sheet1.xml';
}

/** .xlsx 바이트 → 첫 워크시트의 행 배열(문자열) */
export async function readXlsxRows(buf: ArrayBuffer, inflate: Inflate = inflateRaw): Promise<string[][]> {
  const entries = readEntries(buf);
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e]));
  const text = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    return e ? new TextDecoder().decode(await readEntry(buf, e, inflate)) : null;
  };
  const sheetPath = firstSheetPath(await text('xl/workbook.xml'), await text('xl/_rels/workbook.xml.rels'));
  const sheetXml = await text(sheetPath);
  if (sheetXml === null) throw new Error('워크시트를 찾지 못했습니다(.xlsx가 아닌 파일?)');
  const shared = parseSharedStrings((await text('xl/sharedStrings.xml')) ?? '');
  return parseSheet(sheetXml, shared);
}
