import { describe, expect, it } from 'vitest';
import { createCut } from '../model/defaults';
import type { CutPackage, PackageCharacter } from '../ui/packager';
import { buildBatchPrompt, chunkSizes, colorTable, customSize, descriptionLines, gridFor, groupCuts, layoutGrid, nearestFixedSize, nextCandidateIndex, requestSize, SIZE_LIMITS, splitRects } from './batch';

function cut(number: number, tags: string[] = [], aspect = 1.5) {
  const c = createCut(number);
  c.aspect = aspect;
  c.groupTags = tags;
  c.confirmed = true;
  return c;
}

function character(partial: Partial<PackageCharacter>): PackageCharacter {
  return {
    color: '#F5C518',
    colorName: '노랑',
    name: 'A캐릭터',
    characterId: 'c1',
    registered: true,
    gender: 'male',
    heightCm: 175,
    description: '',
    appearanceTags: [],
    placement: '중앙 앞',
    facing: '정면',
    pose: '서 있음',
    shot: '풀샷',
    references: [],
    ...partial,
  };
}

function pkg(number: number, characters: PackageCharacter[], description: string): CutPackage {
  return {
    work: { code: 'ACS', name: '아카데미' },
    episode: 12,
    cut: number,
    image: `ACS_012_${String(number).padStart(3, '0')}.png`,
    frame: { aspect: '1:1.5', width: 1024, height: 1536, shot: '풀샷', angle: '로우앵글', count: characters.length },
    camera: { height: 0.9, focal: 35, pitch: 15, yaw: 0, roll: 0, distance: 3.2 },
    scene: { description, memo: '', dialogue: [], scriptNote: '' },
    characters,
    prompt: '',
  };
}

describe('컷 묶기', () => {
  it('같은 묶음 태그끼리, 태그 없는 컷은 순서대로, 상한 4', () => {
    const cuts = [cut(1), cut(2, ['옥상']), cut(3, ['옥상']), cut(4), cut(5, ['옥상', '밤']), cut(6), cut(7), cut(8), cut(9)];
    const batches = groupCuts(cuts, 4);
    expect(batches.map((b) => [b.key, b.cuts.map((c) => c.number)])).toEqual([
      ['', [1, 4, 6]],
      ['옥상', [2, 3, 5]],
      ['', [7, 8, 9]],
    ]);
  });

  it('균등 분할: 5컷은 3+2, 9컷(상한 4)은 3+3+3, 8컷(상한 8)은 한 묶음', () => {
    expect(chunkSizes(5, 4)).toEqual([3, 2]);
    expect(chunkSizes(9, 4)).toEqual([3, 3, 3]);
    expect(chunkSizes(8, 8)).toEqual([8]);
    expect(chunkSizes(4, 4)).toEqual([4]);
    expect(chunkSizes(0, 4)).toEqual([]);
    const batches = groupCuts([cut(1), cut(2), cut(3), cut(4), cut(5)], 4);
    expect(batches.map((b) => b.cuts.length)).toEqual([3, 2]);
  });

  it('상한은 1~8로 묶이고 첫 태그만 키가 된다', () => {
    expect(groupCuts([cut(1), cut(2)], 99).length).toBe(1);
    expect(groupCuts([cut(1), cut(2)], 0)[0].cuts.length).toBe(2); // 0 → 기본 4
    expect(groupCuts([cut(1, [' 밤 ', '옥상'])], 4)[0].key).toBe('밤');
  });
});

describe('격자 배치', () => {
  it('칸 수 → 격자', () => {
    expect(gridFor(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridFor(3)).toEqual({ cols: 3, rows: 1 });
    expect(gridFor(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(7)).toEqual({ cols: 4, rows: 2 });
    expect(gridFor(8)).toEqual({ cols: 4, rows: 2 });
  });

  it('같은 화면비 4컷 → 2×2, 칸 = 가로 × 화면비', () => {
    const L = layoutGrid([1, 2, 3, 4].map((n) => ({ number: n, aspect: 1.5 })), 1024);
    expect(L.cols).toBe(2);
    expect(L.rows).toBe(2);
    expect(L.cellW).toBe(1024);
    expect(L.cellH).toBe(1536);
    expect(L.width).toBe(2048);
    expect(L.height).toBe(3072);
    expect(L.cells[3]).toMatchObject({ index: 4, cutNumber: 4, x: 1024, y: 1536, w: 1024, h: 1536 });
    expect(L.cells[3].inner).toEqual({ x: 1024, y: 1536, w: 1024, h: 1536 });
  });

  it('화면비가 섞이면 긴 쪽에 맞춘 칸 안에 세로 가운데로 놓인다', () => {
    const L = layoutGrid(
      [
        { number: 1, aspect: 1 },
        { number: 2, aspect: 2 },
      ],
      500,
    );
    expect(L.cellH).toBe(1000);
    expect(L.cells[0].inner).toEqual({ x: 0, y: 250, w: 500, h: 500 });
    expect(L.cells[1].inner).toEqual({ x: 500, y: 0, w: 500, h: 1000 });
  });
});

describe('요청 크기', () => {
  it('격자 비율대로 16의 배수·픽셀 상한 안으로', () => {
    expect(customSize(2048, 3072)).toEqual({ width: 2048, height: 3072 }); // 6.3M px, 그대로
    const big = customSize(4096, 4096); // 4×2 격자 × 2.0 화면비: 픽셀·변 상한에 걸림
    expect(big.width % 16).toBe(0);
    expect(big.height % 16).toBe(0);
    expect(big.width * big.height).toBeLessThanOrEqual(SIZE_LIMITS.maxPixels);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(SIZE_LIMITS.maxEdge);
    expect(big.width).toBe(big.height);
  });

  it('너무 작으면 최소 픽셀까지 키우고, 3:1을 넘는 비율은 잘라 맞춘다', () => {
    const small = customSize(400, 600);
    expect(small.width * small.height).toBeGreaterThanOrEqual(SIZE_LIMITS.minPixels);
    expect(Math.abs(small.width / small.height - 400 / 600)).toBeLessThan(0.05);
    const wide = customSize(4000, 1000);
    expect(wide.width / wide.height).toBeLessThanOrEqual(3.01);
  });

  it('고정 3종 중 가까운 것 · 자동', () => {
    expect(nearestFixedSize(2048, 3072)).toBe('1024x1536');
    expect(nearestFixedSize(3000, 1600)).toBe('1536x1024');
    expect(nearestFixedSize(2048, 2048)).toBe('1024x1024');
    expect(requestSize({ width: 2048, height: 3072 }, 'fixed')).toBe('1024x1536');
    expect(requestSize({ width: 2048, height: 3072 }, 'auto')).toBe('auto');
    expect(requestSize({ width: 2048, height: 3072 }, 'custom')).toBe('2048x3072');
  });
});

describe('결과 분할', () => {
  it('결과 크기가 요청과 달라도 비율대로 칸을 자른다', () => {
    const L = layoutGrid([1, 2, 3, 4].map((n) => ({ number: n, aspect: 1.5 })), 1024); // 2048×3072
    const rects = splitRects(L, 1024, 1536); // 절반 크기로 돌아옴
    expect(rects.map((r) => r.cutNumber)).toEqual([1, 2, 3, 4]);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 512, h: 768 });
    expect(rects[3]).toMatchObject({ x: 512, y: 768, w: 512, h: 768 });
  });

  it('화면비가 섞인 칸은 안쪽 영역만 자른다', () => {
    const L = layoutGrid(
      [
        { number: 1, aspect: 1 },
        { number: 2, aspect: 2 },
      ],
      500,
    ); // 1000×1000
    const rects = splitRects(L, 2000, 2000);
    expect(rects[0]).toMatchObject({ x: 0, y: 500, w: 1000, h: 1000 });
    expect(rects[1]).toMatchObject({ x: 1000, y: 0, w: 1000, h: 2000 });
  });
});

describe('묶음 프롬프트', () => {
  const a = character({});
  const b = character({ color: '#2F6FEB', colorName: '파랑', name: '임시2', characterId: 'c2', registered: false, gender: 'female', heightCm: 160, fallback: '레퍼런스 없음: 임의의 여성(키 160cm)으로 그리되 이 회차 안에서는 같은 인물로 보이게 일관되게 유지' });
  const packages = [
    pkg(45, [a, b], ['## 045 · ACS_012_045.png · 1:1.5 · 로우앵글 · 풀샷 · 2인', '노랑 A캐릭터: 중앙 앞 · 정면 · 서서 오른팔 들어 올림 · 오른손에 검', '파랑 임시2: 왼쪽 뒤 · 왼쪽 향함 · 서 있음', '카메라: 높이 0.9m · 35mm · 올려봄 15° · 거리 3.2m', '메모: 검을 쥔 손을 강조'].join('\n')),
    pkg(46, [a], ['## 046 · ACS_012_046.png · 1:1.5 · 아이레벨 · 바스트 · 1인', '노랑 A캐릭터: 중앙 · 오른쪽 향함 · 서 있음', '카메라: 높이 1.5m · 50mm · 수평 · 거리 1.4m'].join('\n')),
    pkg(47, [a, b], ''),
    pkg(48, [], ''),
  ];
  const layout = layoutGrid(
    packages.map((p) => ({ number: p.cut, aspect: 1.5 })),
    1024,
  );

  it('머리말(격자·칸↔컷·색→캐릭터·첨부) + 컷별 블록 + 강도 + 규칙', () => {
    const text = buildBatchPrompt({
      work: { code: 'ACS', name: '아카데미' },
      episode: 12,
      layout,
      packages,
      preset: 'doll',
      attachments: [
        { role: 'grid', name: 'g.png', note: '돌 격자' },
        { role: 'line', name: 'g_line.png', note: '선화' },
        { role: 'reference', name: 'ref_A캐릭터_1.png', note: 'A캐릭터 레퍼런스(얼굴 정면 · 대표)', characterId: 'c1' },
      ],
      outputSize: '2048x3072',
      style: '흑백 웹툰 선화',
    });
    expect(text).toContain('# ACS_012 묶음 생성 — 컷 045·046·047·048 (2×2 격자 4칸)');
    expect(text).toContain('첨부 1 `g.png`는 3D 돌로 짠 웹툰 콘티 컷 4개를 2×2 격자로 붙인 한 장이다(가로 2048×세로 3072px, 칸 1024×1536px');
    expect(text).toContain('결과는 2048×3072px 한 장으로 낸다.');
    expect(text).toContain('- 1번 칸 = 컷 045 · 화면비 1:1.5 · 풀샷 · 로우앵글 · 2인');
    expect(text).toContain('- 4번 칸 = 컷 048 · 화면비 1:1.5 · 풀샷 · 로우앵글 · 0인');
    expect(text).toContain('- 노랑 돌 = A캐릭터 · 성별 남 · 키 175cm · 레퍼런스(얼굴·머리·복장을 맞출 것): 첨부 3 `ref_A캐릭터_1.png`');
    expect(text).toContain('- 파랑 돌 = 임시2 (미등록) · 성별 여 · 키 160cm · 레퍼런스 없음: 임의의 여성(키 160cm)');
    expect(text).toContain('2. `g_line.png` — 선화');
    expect(text).toContain('### 1번 칸 · 컷 045\n- 노랑 A캐릭터: 중앙 앞 · 정면 · 서서 오른팔 들어 올림 · 오른손에 검\n- 파랑 임시2: 왼쪽 뒤 · 왼쪽 향함 · 서 있음\n- 카메라: 높이 0.9m');
    expect(text).toContain('- 메모: 검을 쥔 손을 강조');
    expect(text).not.toContain('## 045 · ACS_012_045.png'); // 제목 줄은 뺀다
    expect(text).toContain('## 강도: 돌 우선');
    expect(text).toContain('정확히 그대로 따른다');
    expect(text).toContain('## 화풍\n- 흑백 웹툰 선화');
    expect(text).toContain('- 격자 구성(열·행·칸 경계)을 유지하고');
    expect(text).toContain('- 칸 번호 숫자, 돌의 십자선, 회색 여백은 그리지 않는다');
  });

  it('설명이 비어 있으면 패키지 필드로 컷 줄을 만든다', () => {
    const lines = descriptionLines(packages[2]);
    expect(lines[0]).toBe('노랑 A캐릭터: 중앙 앞 · 정면 · 서 있음');
    expect(lines[1]).toBe('파랑 임시2: 중앙 앞 · 정면 · 서 있음');
    expect(lines[2]).toBe('카메라: 높이 0.9m · 35mm · 거리 3.2m');
  });

  it('색 대응표는 캐릭터마다 한 번', () => {
    expect(colorTable(packages).map((c) => c.name)).toEqual(['A캐릭터', '임시2']);
  });

  it('단독(1컷)은 격자 문구 없이, 프롬프트 우선은 실루엣 문구', () => {
    const one = layoutGrid([{ number: 46, aspect: 1.5 }], 1024);
    const text = buildBatchPrompt({ work: { code: 'ACS', name: '아카데미' }, episode: 12, layout: one, packages: [packages[1]], preset: 'prompt', attachments: [{ role: 'grid', name: 'g.png', note: '돌 격자' }], outputSize: 'auto' });
    expect(text).toContain('# ACS_012_046 — 웹툰 컷 생성 지시(단독)');
    expect(text).not.toContain('## 칸 ↔ 컷');
    expect(text).toContain('### 컷 046 · 풀샷 · 로우앵글 · 1인');
    expect(text).toContain('## 강도: 프롬프트 우선');
    expect(text).toContain('색 실루엣');
    expect(text).not.toContain('결과는');
    expect(text).toContain('- 돌의 십자선, 회색 여백은 그리지 않는다');
  });

  it('빈 칸(5컷 → 3×2)은 회색으로 두라고 적는다', () => {
    const five = [45, 46, 47, 48, 49].map((n) => pkg(n, [a], ''));
    const L = layoutGrid(
      five.map((p) => ({ number: p.cut, aspect: 1.5 })),
      512,
    );
    const text = buildBatchPrompt({ work: { code: 'ACS', name: '아카데미' }, episode: 12, layout: L, packages: five, preset: 'balanced', attachments: [{ role: 'grid', name: 'g.png', note: '돌 격자' }], outputSize: 'auto' });
    expect(text).toContain('(3×2 격자 5칸)');
    expect(text).toContain('- 6번 칸은 비어 있다(회색). 그대로 회색으로 둔다.');
  });
});

describe('후보 번호', () => {
  it('기존 cand_{k}.png 중 최대 + 1', () => {
    expect(nextCandidateIndex([])).toBe(1);
    expect(nextCandidateIndex(['생성/ACS/012/045/cand_1.png', '생성/ACS/012/045/cand_3.png'])).toBe(4);
    expect(nextCandidateIndex(['생성/ACS/012/045/other.png'])).toBe(1);
  });
});
