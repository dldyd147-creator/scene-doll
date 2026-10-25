import { describe, expect, it } from 'vitest';
import { createCut } from '../model/defaults';
import { applyScriptToCuts, detectColumns, dialogueToText, extractRows, groupByCut, mergeRemark, parseCutNumber, planApply, textToDialogue } from './ntt';

const TABLE = [
  ['컷', '화자', '대사', '지문', '비고'],
  ['1', '주인공', '여기가 어디지?', '복도. 주인공이 두리번거린다', ''],
  ['', '히로인', '따라와.', '', '검을 강조'],
  ['2', '', '', '둘이 옥상으로 올라간다', ''],
  ['#4', '주인공', '…', '', ''],
  ['', '', '', '', ''],
];

describe('글콘티 열 판정', () => {
  it('제목 줄을 보고 열을 잡는다', () => {
    const d = detectColumns(TABLE);
    expect(d.hasHeader).toBe(true);
    expect(d.mapping).toEqual({ cut: 0, speaker: 1, text: 2, note: 3, remark: 4 });
  });

  it('영문·다른 표기도 받고 같은 열을 두 번 쓰지 않는다', () => {
    const d = detectColumns([['No.', 'Character', 'Dialogue', 'Action', 'Note']]);
    expect(d.hasHeader).toBe(true);
    expect(d.mapping).toEqual({ cut: 0, speaker: 1, text: 2, note: 3, remark: 4 });
  });

  it('제목 줄이 없으면 열 순서대로', () => {
    const d = detectColumns([
      ['1', '주인공', '안녕'],
      ['2', '히로인', '응'],
    ]);
    expect(d.hasHeader).toBe(false);
    expect(d.mapping).toEqual({ cut: 0, speaker: 1, text: 2 });
  });

  it('컷 번호 뽑기', () => {
    expect(parseCutNumber('12')).toBe(12);
    expect(parseCutNumber('#7')).toBe(7);
    expect(parseCutNumber('C012')).toBe(12);
    expect(parseCutNumber('')).toBeNull();
    expect(parseCutNumber('0')).toBeNull();
  });
});

describe('글콘티 행 → 컷', () => {
  it('빈 컷 번호는 앞 컷에 이어 붙고, 빈 행은 건너뛴다', () => {
    const d = detectColumns(TABLE);
    const rows = extractRows(TABLE, d.mapping, d.hasHeader);
    expect(rows.map((r) => r.cut)).toEqual([1, 1, 2, 4]);
    const groups = groupByCut(rows);
    expect(groups.map((g) => g.cut)).toEqual([1, 2, 4]);
    expect(groups[0].dialogue).toEqual([
      { speaker: '주인공', text: '여기가 어디지?', position: 'top' },
      { speaker: '히로인', text: '따라와.', position: 'top' },
    ]);
    expect(groups[0].note).toBe('복도. 주인공이 두리번거린다');
    expect(groups[0].remark).toBe('검을 강조');
    expect(groups[1].dialogue).toEqual([]);
    expect(groups[1].note).toBe('둘이 옥상으로 올라간다');
  });

  it('컷 열이 없으면 행마다 한 컷', () => {
    const rows = extractRows(
      [
        ['주인공', '안녕'],
        ['히로인', '응'],
      ],
      { speaker: 0, text: 1 },
      false,
    );
    expect(rows.map((r) => r.cut)).toEqual([1, 2]);
  });
});

describe('컷 목록에 반영', () => {
  it('모자란 컷은 마지막 컷을 복사해 만들고 남는 컷은 알려 준다', () => {
    const base = [createCut(1), createCut(2), createCut(3)];
    base[2].dolls.push({ id: 'd', characterId: 'c', dollId: 'mh2_m', heightCm: 175, color: '#F5C518', position: [0, 0, 0], rotation: [0, 0, 0, 1], joints: {} });
    base[2].confirmed = true;
    base[2].memo = '기존 메모';
    base[0].dialogue = [{ speaker: '옛', text: '옛 대사', position: 'top' }];
    const scripts = groupByCut(extractRows(TABLE, { cut: 0, speaker: 1, text: 2, note: 3, remark: 4 }, true));
    const plan = planApply(base.length, scripts);
    expect(plan).toEqual({ filled: 3, created: 1, leftover: [3], maxCut: 4 });

    const { cuts } = applyScriptToCuts(base, scripts, '2026-10-25T00:00:00.000Z');
    expect(cuts).toHaveLength(4);
    expect(cuts.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(cuts[0].dialogue).toHaveLength(2);
    expect(cuts[0].memo).toBe('검을 강조');
    expect(cuts[1].scriptNote).toBe('둘이 옥상으로 올라간다');
    // 글콘티에 없는 3컷은 그대로
    expect(cuts[2].memo).toBe('기존 메모');
    expect(cuts[2].confirmed).toBe(true);
    // 4컷은 3컷을 복사해 만들었고(돌 포함) 미확정, 대사는 글콘티 것
    expect(cuts[3].dolls).toHaveLength(1);
    expect(cuts[3].confirmed).toBe(false);
    expect(cuts[3].memo).toBe('');
    expect(cuts[3].dialogue).toEqual([{ speaker: '주인공', text: '…', position: 'top' }]);
    // 원본은 건드리지 않는다
    expect(base[0].dialogue?.[0].text).toBe('옛 대사');
    expect(base).toHaveLength(3);
  });

  it('비고는 메모에 붙이되 중복은 피한다', () => {
    expect(mergeRemark('', '검 강조')).toBe('검 강조');
    expect(mergeRemark('기존', '검 강조')).toBe('기존 · 검 강조');
    expect(mergeRemark('기존 · 검 강조', '검 강조')).toBe('기존 · 검 강조');
    expect(mergeRemark('기존', '')).toBe('기존');
  });
});

describe('대사 칸 글 ↔ dialogue', () => {
  it('"화자: 대사" 한 줄에 하나', () => {
    const lines = textToDialogue('주인공: 여기가 어디지?\n따라와.\n\n긴 문장이 콜론을 포함한다: 그래도 화자가 아니다 왜냐하면 길어서\n');
    expect(lines).toEqual([
      { speaker: '주인공', text: '여기가 어디지?', position: 'top' },
      { speaker: '', text: '따라와.', position: 'top' },
      { speaker: '', text: '긴 문장이 콜론을 포함한다: 그래도 화자가 아니다 왜냐하면 길어서', position: 'top' },
    ]);
    expect(dialogueToText(lines)).toBe('주인공: 여기가 어디지?\n따라와.\n긴 문장이 콜론을 포함한다: 그래도 화자가 아니다 왜냐하면 길어서');
    expect(dialogueToText(undefined)).toBe('');
  });
});
