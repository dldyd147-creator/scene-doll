import { describe, expect, it } from 'vitest';
import type { Cut } from '../model/types';
import { buildPlan } from './plan';
import { autoBodyWidth, bubbleMetrics, hitTest, inBody, resolveBubbles, tailGeometry, wrapText, type Measure } from './bubbles';
import { layoutStrip, planSlices } from './layout';
import { bubbleKey, normalizeAssembly } from './model';

/** 글자 하나당 fontPx 폭인 가짜 측정기(공백은 절반) */
const measure: Measure = (t, px) => [...t].reduce((w, c) => w + (c === ' ' ? px / 2 : px), 0);

describe('스트립 배치', () => {
  it('폭에 맞춰 화면비대로 쌓고 거터·여백을 더한다', () => {
    const l = layoutStrip(
      [
        { number: 1, aspect: 1.5 },
        { number: 2, aspect: 1 },
        { number: 3, aspect: 0.5 },
      ],
      { width: 800, gutter: 40, margin: 20 },
    );
    expect(l.cuts).toEqual([
      { number: 1, y: 20, height: 1200 },
      { number: 2, y: 1260, height: 800 },
      { number: 3, y: 2100, height: 400 },
    ]);
    expect(l.height).toBe(2520);
  });
  it('빈 목록은 높이 0', () => {
    expect(layoutStrip([], { width: 800, gutter: 40, margin: 20 }).height).toBe(0);
  });
});

describe('슬라이스 경계', () => {
  const lay = layoutStrip(
    [1, 2, 3, 4].map((n) => ({ number: n, aspect: 0.75 })),
    { width: 800, gutter: 40, margin: 0 },
  );
  // 컷 600px × 4, 거터 40 → 총 2520. 경계(거터 한가운데) 620, 1260, 1900
  it('컷 경계(거터 한가운데)에서만, 한도 이하로 최대한 채워 자른다', () => {
    const s = planSlices(lay, 1300);
    expect(s.map((x) => [x.y0, x.y1])).toEqual([
      [0, 1260],
      [1260, 2520],
    ]);
    expect(s.some((x) => x.forced)).toBe(false);
  });
  it('한도가 총 높이 이상이면 한 장', () => {
    expect(planSlices(lay, 5000)).toHaveLength(1);
  });
  it('한 컷이 한도보다 길면 컷 안에서 자르고 forced', () => {
    const tall = layoutStrip([{ number: 1, aspect: 3 }], { width: 800, gutter: 40, margin: 0 }); // 2400
    const s = planSlices(tall, 1000);
    expect(s.map((x) => x.y1 - x.y0)).toEqual([1000, 1000, 400]);
    expect(s[0].forced).toBe(true);
  });
  it('조각을 이으면 빈틈·겹침 없이 전체를 덮는다', () => {
    const s = planSlices(lay, 700);
    expect(s[0].y0).toBe(0);
    for (let i = 1; i < s.length; i++) expect(s[i].y0).toBe(s[i - 1].y1);
    expect(s[s.length - 1].y1).toBe(lay.height);
    for (const x of s) expect(x.y1 - x.y0).toBeLessThanOrEqual(700);
  });
});

describe('줄바꿈', () => {
  it('사용자 줄바꿈을 지키고 폭을 넘으면 공백에서 바꾼다', () => {
    expect(wrapText('안녕 하세요\n반가워', 100, 10, measure)).toEqual(['안녕 하세요', '반가워']);
    expect(wrapText('aaa bbb ccc', 80, 10, measure)).toEqual(['aaa bbb', 'ccc']);
  });
  it('공백 없는 긴 글은 글자 단위로 자른다', () => {
    expect(wrapText('가나다라마바사', 30, 10, measure)).toEqual(['가나다', '라마바', '사']);
  });
  it('폭보다 긴 단어 앞에서 줄을 바꾼 뒤 맞는 단어는 통째로 둔다', () => {
    expect(wrapText('ab cdefgh', 50, 10, measure)).toEqual(['ab', 'cdefg', 'h']);
  });
});

describe('말풍선 크기', () => {
  it('자동 폭은 컷 폭의 22%~55%로 한정', () => {
    expect(autoBodyWidth('아', 'round', 20, 800, measure)).toBe(800 * 0.22);
    expect(autoBodyWidth('가'.repeat(60), 'round', 20, 800, measure)).toBe(800 * 0.55);
  });
  it('타원은 같은 글에서 둥근 사각형보다 크다', () => {
    const e = bubbleMetrics('안녕하세요 여러분', 'ellipse', 300, 20, measure);
    const r = bubbleMetrics('안녕하세요 여러분', 'round', 300, 20, measure);
    expect(e.h).toBeGreaterThan(r.h);
  });
});

describe('말풍선 배치', () => {
  const o = { cutW: 800, cutH: 1200, fontPx: 29, shape: 'ellipse' as const, tail: true, measure };
  const dlg = [
    { speaker: 'A', text: '첫 번째 대사', position: 'top' as const },
    { speaker: 'B', text: '두 번째 대사', position: 'top' as const },
    { speaker: 'A', text: '아래 대사', position: 'bottom' as const },
  ];
  it('위 대사는 위에서 쌓고 좌우를 번갈아, 아래 대사는 아래에 놓는다', () => {
    const r = resolveBubbles(3, dlg, {}, o);
    expect(r).toHaveLength(3);
    expect(r[0].rect.y).toBeLessThan(r[2].rect.y);
    expect(r[0].rect.x + r[0].rect.w / 2).toBeGreaterThan(400);
    expect(r[1].rect.x + r[1].rect.w / 2).toBeLessThan(400);
    expect(r[1].rect.y).toBeGreaterThan(r[0].rect.y);
    expect(r[2].rect.y + r[2].rect.h).toBeLessThanOrEqual(1200);
    // 꼬리는 그림 쪽: 위 대사는 아래로, 아래 대사는 위로
    expect(r[0].tip!.y).toBeGreaterThan(r[0].rect.y + r[0].rect.h);
    expect(r[2].tip!.y).toBeLessThan(r[2].rect.y);
    for (const b of r) expect(b.rect.x).toBeGreaterThanOrEqual(0);
  });
  it('덮어쓰기: 위치·글·꼬리·숨김이 대사 기본값보다 우선하고, 안 만진 것은 그대로', () => {
    const r = resolveBubbles(3, dlg, { [bubbleKey(3, 1)]: { cx: 0.5, cy: 0.5, w: 0.4, text: '고친 글', tail: null, hidden: true } }, o);
    expect(r[1].text).toBe('고친 글');
    expect(r[1].rect.x + r[1].rect.w / 2).toBeCloseTo(400);
    expect(r[1].rect.y + r[1].rect.h / 2).toBeCloseTo(600);
    expect(r[1].rect.w).toBeCloseTo(320);
    expect(r[1].tip).toBeNull();
    expect(r[1].hidden).toBe(true);
    expect(r[0].edited).toBe(false);
    expect(r[0].text).toBe('첫 번째 대사');
  });
  it('명시한 꼬리 끝은 비율을 px로 바꾼다', () => {
    const r = resolveBubbles(1, dlg.slice(0, 1), { [bubbleKey(1, 0)]: { tail: { x: 0.25, y: 0.75 } } }, o);
    expect(r[0].tip).toEqual({ x: 200, y: 900 });
  });
});

describe('꼬리 기하', () => {
  const rect = { x: 100, y: 100, w: 200, h: 100 };
  it('끝이 몸통 안이면 꼬리 없음', () => {
    expect(tailGeometry('ellipse', rect, { x: 200, y: 150 }, 10)).toBeNull();
  });
  it('타원: 두 밑점이 타원 위에 있고 끝은 그대로', () => {
    const g = tailGeometry('ellipse', rect, { x: 200, y: 260 }, 12)!;
    for (const p of [g.b1, g.b2]) {
      const nx = (p.x - 200) / 100;
      const ny = (p.y - 150) / 50;
      expect(nx * nx + ny * ny).toBeCloseTo(1, 5);
      expect(p.y).toBeGreaterThan(150);
    }
    expect(g.tip).toEqual({ x: 200, y: 260 });
  });
  it('둥근 사각형: 아래 변에서 변을 따라 벌어진다', () => {
    const g = tailGeometry('round', rect, { x: 200, y: 260 }, 12)!;
    expect(g.b1.y).toBeCloseTo(200);
    expect(g.b2.x - g.b1.x).toBeCloseTo(24);
  });
  it('둥근 사각형: 모서리 쪽 끝이어도 밑점이 변 안쪽에 머문다', () => {
    const g = tailGeometry('round', rect, { x: 500, y: 215 }, 12)!;
    expect(g.b1.x).toBeCloseTo(300);
    expect(g.b1.y).toBeGreaterThanOrEqual(100 + 25);
    expect(g.b2.y).toBeLessThanOrEqual(200 - 25);
  });
});

describe('맞춤', () => {
  const b = resolveBubbles(1, [{ speaker: '', text: '맞춤 시험', position: 'top' }], { [bubbleKey(1, 0)]: { cx: 0.5, cy: 0.5, w: 0.4, tail: { x: 0.5, y: 0.9 } } }, { cutW: 800, cutH: 1200, fontPx: 29, shape: 'round', tail: true, measure });
  it('꼬리 끝 → 오른쪽 가장자리 손잡이 → 몸통 순으로 맞춘다', () => {
    expect(hitTest(b, { x: 400, y: 1080 }, 20)?.part).toBe('tip');
    expect(hitTest(b, { x: b[0].rect.x + b[0].rect.w, y: 600 }, 20)?.part).toBe('width');
    expect(hitTest(b, { x: 400, y: 600 }, 20)?.part).toBe('body');
    expect(hitTest(b, { x: 10, y: 10 }, 20)).toBeNull();
    expect(inBody('round', b[0].rect, { x: 400, y: 600 })).toBe(true);
  });
  it('숨긴 말풍선은 맞지 않는다', () => {
    const h = [{ ...b[0], hidden: true }];
    expect(hitTest(h, { x: 400, y: 600 }, 20)).toBeNull();
  });
});

describe('조립 데이터 normalize', () => {
  it('옛 회차(assembly 없음)는 기본값을 채운다', () => {
    const a = normalizeAssembly(undefined);
    expect(a.settings.width).toBe(800);
    expect(a.settings.sliceMax).toBe(1280);
    expect(a.bubbles).toEqual({});
    expect(a.skip).toEqual([]);
  });
  it('범위를 벗어나거나 틀린 값은 고치고 나머지는 보존', () => {
    const a = normalizeAssembly({ settings: { width: 99999, gutter: -5, background: 'red', shape: 'round' } as never, skip: [2, 'x' as never], bubbles: { '1:0': { cx: 0.2 } } });
    expect(a.settings.width).toBe(4000);
    expect(a.settings.gutter).toBe(0);
    expect(a.settings.background).toBe('#ffffff');
    expect(a.settings.shape).toBe('round');
    expect(a.skip).toEqual([2]);
    expect(a.bubbles['1:0']).toEqual({ cx: 0.2 });
  });
});

describe('조립 계획', () => {
  const cut = (n: number, extra: Partial<Cut> = {}): Cut => ({ number: n, aspect: 1.5, confirmed: true, generatedImages: [], dialogue: [], ...extra }) as Cut;
  it('그림 출처별 경고, 미확정+그림 없음은 뺀다, 제외 컷은 조용히 뺀다', () => {
    const cuts = [cut(1), cut(2), cut(3, { confirmed: false }), cut(4), cut(5)];
    const plan = buildPlan(
      cuts,
      { 1: { kind: 'generated', width: 500, height: 750 }, 2: { kind: 'output', width: 1024, height: 1024 }, 3: { kind: 'none', width: 0, height: 0 }, 4: { kind: 'none', width: 0, height: 0 }, 5: { kind: 'generated', width: 500, height: 500 } },
      normalizeAssembly({ skip: [5] }),
      measure,
    );
    expect(plan.items.map((i) => i.number)).toEqual([1, 2, 4]);
    expect(plan.items.map((i) => i.height)).toEqual([1200, 800, 1200]); // 실제 그림 화면비, 자리표시는 cut.aspect
    expect(plan.warnings).toHaveLength(3);
    expect(plan.warnings.join()).toContain('확정 컷 PNG');
    expect(plan.layout.height).toBe(1200 + 40 + 800 + 40 + 1200);
    expect(plan.slices.at(-1)!.y1).toBe(plan.layout.height);
  });
});
