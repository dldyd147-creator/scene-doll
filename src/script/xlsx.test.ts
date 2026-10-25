import { describe, expect, it } from 'vitest';
import { columnIndex, columnLetter, parseSharedStrings, parseSheet, readXlsxRows } from './xlsx';
import { parseDelimited, readTableFile } from './table';

/** 브라우저·Node 공통 CompressionStream으로 deflate-raw 압축(테스트 픽스처용) */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 테스트용 zip 쓰기(저장 또는 deflate). CRC는 리더가 보지 않으므로 0 */
async function makeZip(files: Array<{ name: string; text: string; deflate?: boolean }>): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const data = f.deflate ? await deflateRaw(raw) : raw;
    const method = f.deflate ? 8 : 0;
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const l of locals) {
    out.set(l, p);
    p += l.length;
  }
  for (const c of centrals) {
    out.set(c, p);
    p += c.length;
  }
  out.set(eocd, p);
  return out.buffer;
}

const WORKBOOK = '<workbook><sheets><sheet name="글콘티" sheetId="1" r:id="rId1"/><sheet name="기타" sheetId="2" r:id="rId2"/></sheets></workbook>';
const RELS = '<Relationships><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>';
const SHARED = '<sst count="4"><si><t>컷</t></si><si><t>화자</t></si><si><r><t>주인</t></r><r><t>공</t></r><rPh><t>phon</t></rPh></si><si><t xml:space="preserve">검을 &amp; 쥔다 </t></si></sst>';
const SHEET1 =
  '<worksheet><sheetData>' +
  '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>대사</t></is></c></row>' +
  '<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row>' +
  '<row r="3"/>' +
  '<row r="4"><c r="A4" s="1"/><c r="C4" t="str"><v>이어지는 줄</v></c><c r="E4" t="b"><v>1</v></c></row>' +
  '</sheetData></worksheet>';
const SHEET2 = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>다른 시트</t></is></c></row></sheetData></worksheet>';

describe('xlsx 최소 리더', () => {
  it('열 문자 변환', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA12')).toBe(26);
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(27)).toBe('AB');
  });

  it('공유 문자열: run 이어 붙이기, 발음 제외, 엔티티', () => {
    expect(parseSharedStrings(SHARED)).toEqual(['컷', '화자', '주인공', '검을 & 쥔다 ']);
  });

  it('시트: 공유·인라인·수식 문자열·숫자·불리언, 빈 셀 채우기, 빈 행 건너뛰기', () => {
    const rows = parseSheet(SHEET1, parseSharedStrings(SHARED));
    expect(rows).toEqual([
      ['컷', '화자', '대사'],
      ['1', '주인공', '검을 & 쥔다 '],
      ['', '', '이어지는 줄', '', 'TRUE'],
    ]);
  });

  it('zip(저장·deflate) → 첫 시트(rels로 찾음)', async () => {
    const buf = await makeZip([
      { name: 'xl/workbook.xml', text: WORKBOOK },
      { name: 'xl/_rels/workbook.xml.rels', text: RELS, deflate: true },
      { name: 'xl/sharedStrings.xml', text: SHARED, deflate: true },
      { name: 'xl/worksheets/sheet2.xml', text: SHEET2 },
      { name: 'xl/worksheets/sheet1.xml', text: SHEET1, deflate: true },
    ]);
    const rows = await readXlsxRows(buf);
    expect(rows[0]).toEqual(['컷', '화자', '대사']);
    expect(rows[1][1]).toBe('주인공');
    const viaFile = await readTableFile('콘티.XLSX', buf);
    expect(viaFile).toEqual(rows);
  });

  it('zip이 아니면 오류', async () => {
    await expect(readXlsxRows(new TextEncoder().encode('hello').buffer as ArrayBuffer)).rejects.toThrow('zip');
  });
});

describe('구분자 텍스트', () => {
  it('쉼표·따옴표·줄바꿈', () => {
    expect(parseDelimited('컷,화자,대사\n1,주인공,"검을, 쥔다"\n2,,"두 줄\n대사"\n\n')).toEqual([
      ['컷', '화자', '대사'],
      ['1', '주인공', '검을, 쥔다'],
      ['2', '', '두 줄\n대사'],
    ]);
  });

  it('탭 구분과 "" 이스케이프', () => {
    expect(parseDelimited('컷\t대사\r\n1\t"그는 ""응""이라 했다"')).toEqual([
      ['컷', '대사'],
      ['1', '그는 "응"이라 했다'],
    ]);
  });

  it('csv 파일 읽기(UTF-8 BOM)', async () => {
    const buf = new TextEncoder().encode('﻿컷,대사\n1,안녕').buffer as ArrayBuffer;
    expect(await readTableFile('콘티.csv', buf)).toEqual([
      ['컷', '대사'],
      ['1', '안녕'],
    ]);
  });
});
