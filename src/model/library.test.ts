import { describe, expect, it } from 'vitest';
import type { DollAnalysis } from '../describe/analyze';
import type { Character, SceneLibraryItem } from './types';
import { createCharacter, createCut } from './defaults';
import { countBucket, dollsFromScene, EMPTY_FILTER, filterScenes, normalizePose, normalizeScene, parseTagList, sceneFromCut } from './library';

function dollAnalysis(partial: Partial<DollAnalysis>): DollAnalysis {
  return {
    id: 'd',
    characterId: 'c',
    name: '임시',
    color: '#F5C518',
    colorName: '노랑',
    inFrame: true,
    shot: 'full',
    projectedHeight: 1,
    xZone: '중앙',
    depthZone: null,
    facing: '정면',
    stance: '서 있음',
    stanceConj: '서서',
    phrases: [],
    distance: 3,
    ...partial,
  };
}

function cutWithTwoDolls() {
  const cut = createCut(7);
  cut.aspect = 1.25;
  cut.camera = { ...cut.camera, position: [0.2, 0.9, 3.1], pitch: 12, focalLength: 35 };
  cut.dolls.push(
    { id: 'd1', characterId: 'chr_a', dollId: 'mh2_m', heightCm: 180, color: '#F5C518', position: [-0.4, 0, 0], rotation: [0, 0.38, 0, 0.92], joints: { Head: [0.1, 0, 0, 0.995] } },
    { id: 'd2', characterId: 'chr_b', dollId: 'mh2_f', heightCm: 158, color: '#2F6FEB', position: [0.5, 0, -0.8], rotation: [0, 0, 0, 1], joints: {} },
  );
  return cut;
}

describe('씬 라이브러리: 컷 → 씬', () => {
  it('캐릭터 지정은 지우고 돌 슬롯·카메라·화면비만 남긴다', () => {
    const cut = cutWithTwoDolls();
    const item = sceneFromCut(
      cut,
      {
        count: 2,
        shot: 'full',
        angle: 'low',
        dolls: [dollAnalysis({ id: 'd1', xZone: '왼쪽', depthZone: '앞', shot: 'full' }), dollAnalysis({ id: 'd2', xZone: '오른쪽', depthZone: '뒤', shot: 'waist' })],
      },
      { id: 'scene_test', situationTags: ['대치', ' 전투 ', '대치'], now: '2026-10-25T00:00:00.000Z' },
    );
    expect(item.id).toBe('scene_test');
    expect(item.name).toBe('2인 풀샷 로우앵글');
    expect(item.situationTags).toEqual(['대치', '전투']);
    expect(item.slots.map((s) => s.slot)).toEqual([1, 2]);
    expect(item.slots[0]).toEqual({ slot: 1, dollId: 'mh2_m', heightCm: 180, position: [-0.4, 0, 0], rotation: [0, 0.38, 0, 0.92], joints: { Head: [0.1, 0, 0, 0.995] } });
    expect(JSON.stringify(item)).not.toContain('chr_a');
    expect(JSON.stringify(item)).not.toContain('#F5C518');
    expect(item.camera).toEqual(cut.camera);
    expect(item.camera).not.toBe(cut.camera);
    expect(item.aspect).toBe(1.25);
    expect(item.autoTags).toEqual({ count: 2, shot: 'full', angle: 'low', aspect: 1.25, placement: ['왼쪽 앞', '오른쪽 뒤'], shots: ['full', 'waist'] });
    expect(item.createdAt).toBe('2026-10-25T00:00:00.000Z');
    // 슬롯은 컷의 복사본이다
    item.slots[0].joints.Head = [0, 0, 0, 1];
    expect(cut.dolls[0].joints.Head).toEqual([0.1, 0, 0, 0.995]);
  });

  it('이름을 주면 그대로, 비우면 자동 이름', () => {
    const cut = cutWithTwoDolls();
    const a = { count: 1, shot: 'bust' as const, angle: 'eye' as const, dolls: [dollAnalysis({})] };
    expect(sceneFromCut(cut, a, { name: '  복도 대화  ' }).name).toBe('복도 대화');
    expect(sceneFromCut(cut, a, { name: '   ' }).name).toBe('1인 바스트 아이레벨');
  });
});

function scene(partial: Partial<SceneLibraryItem> & { id: string }): SceneLibraryItem {
  return normalizeScene({ autoTags: { count: 1, shot: 'full', angle: 'eye', aspect: 1.5, placement: [] }, situationTags: [], ...partial });
}

describe('씬 검색기 필터', () => {
  const items = [
    scene({ id: 'a', name: '복도 대화', autoTags: { count: 2, shot: 'bust', angle: 'eye', aspect: 1.5, placement: [] }, situationTags: ['대화', '일상'] }),
    scene({ id: 'b', name: '옥상 대치', autoTags: { count: 2, shot: 'full', angle: 'low', aspect: 1.5, placement: [] }, situationTags: ['대치'] }),
    scene({ id: 'c', name: '군중', autoTags: { count: 6, shot: 'full', angle: 'high', aspect: 2, placement: [] }, situationTags: ['군중', '일상'] }),
    scene({ id: 'd', name: '혼자', autoTags: { count: 1, shot: 'closeup', angle: 'eye', aspect: 1, placement: [] }, situationTags: ['독백'] }),
  ];
  const ids = (f: Partial<typeof EMPTY_FILTER>) => filterScenes(items, { ...EMPTY_FILTER, ...f }).map((s) => s.id);

  it('필터가 없으면 전부', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  });

  it('같은 묶음(샷)은 또는, 묶음끼리는 그리고', () => {
    expect(ids({ shots: ['full'] })).toEqual(['b', 'c']);
    expect(ids({ shots: ['full', 'closeup'] })).toEqual(['b', 'c', 'd']);
    expect(ids({ shots: ['full'], angles: ['low'] })).toEqual(['b']);
    expect(ids({ shots: ['bust'], angles: ['low'] })).toEqual([]);
  });

  it('인원 4+는 4명 이상', () => {
    expect(countBucket(0)).toBe(0);
    expect(countBucket(3)).toBe(3);
    expect(countBucket(9)).toBe(4);
    expect(ids({ counts: [4] })).toEqual(['c']);
    expect(ids({ counts: [1, 2] })).toEqual(['a', 'b', 'd']);
  });

  it('상황 태그는 누른 것을 모두 가진 씬만(좁히기)', () => {
    expect(ids({ situations: ['일상'] })).toEqual(['a', 'c']);
    expect(ids({ situations: ['일상', '대화'] })).toEqual(['a']);
  });

  it('이름·상황 태그 검색', () => {
    expect(ids({ query: '대치' })).toEqual(['b']);
    expect(ids({ query: ' 혼자 ' })).toEqual(['d']);
    expect(ids({ query: '군' })).toEqual(['c']);
  });
});

describe('씬 불러오기: 슬롯 → 돌', () => {
  const item = scene({
    id: 's',
    slots: [
      { slot: 1, dollId: 'mh2_m', heightCm: 180, position: [-0.4, 0, 0], rotation: [0, 0.38, 0, 0.92], joints: { Head: [0.1, 0, 0, 0.995] } },
      { slot: 2, dollId: 'mh2_f', heightCm: 158, position: [0.5, 0, -0.8], rotation: [0, 0, 0, 1], joints: {} },
    ],
  });
  const hero: Character = { ...createCharacter('ACS', '주인공', 'female', '#E5393B'), id: 'chr_hero', heightCm: 165 };
  const extra: Character = { ...createCharacter('ACS', '임시A', 'male', '#F5C518'), id: 'chr_tmp', temporary: true };

  it('지정한 슬롯은 캐릭터의 돌·키·고정색, 비운 슬롯은 임시 캐릭터', () => {
    const { dolls, newCharacters } = dollsFromScene(item, { 1: 'chr_hero' }, [hero, extra], 'ACS');
    expect(dolls).toHaveLength(2);
    expect(dolls[0]).toMatchObject({ characterId: 'chr_hero', dollId: 'mh2_f', heightCm: 165, color: '#E5393B', position: [-0.4, 0, 0], rotation: [0, 0.38, 0, 0.92], joints: { Head: [0.1, 0, 0, 0.995] } });
    expect(newCharacters).toHaveLength(1);
    const temp = newCharacters[0];
    expect(temp.temporary).toBe(true);
    expect(temp.workCode).toBe('ACS');
    expect(temp.dollId).toBe('mh2_f');
    expect(temp.heightCm).toBe(158);
    expect(dolls[1]).toMatchObject({ characterId: temp.id, dollId: 'mh2_f', heightCm: 158, color: temp.color });
    // 임시 캐릭터 색은 쓰고 있는 색과 다르다
    expect(['#E5393B', '#F5C518'].map((c) => c.toLowerCase())).not.toContain(temp.color.toLowerCase());
    expect(dolls[0].id).not.toBe(dolls[1].id);
  });

  it('비운 슬롯이 둘이면 서로 다른 색의 임시 캐릭터', () => {
    const { dolls, newCharacters } = dollsFromScene(item, {}, [], 'TMP');
    expect(newCharacters).toHaveLength(2);
    expect(newCharacters[0].color).not.toBe(newCharacters[1].color);
    expect(newCharacters.map((c) => c.name)).toEqual(['임시1', '임시2']);
    expect(dolls[0].heightCm).toBe(180);
    expect(dolls[0].dollId).toBe('mh2_m');
  });

  it('모르는 캐릭터 ID는 임시로 취급', () => {
    const { dolls, newCharacters } = dollsFromScene(item, { 1: 'ghost', 2: null }, [hero], 'ACS');
    expect(newCharacters).toHaveLength(2);
    expect(dolls.every((d) => d.characterId !== 'chr_hero')).toBe(true);
  });
});

describe('씬 라이브러리: 소품 슬롯 연결', () => {
  it('저장 때 쥔 돌 ID → 슬롯 번호, 불러올 때 새 돌 ID로', () => {
    const cut = cutWithTwoDolls();
    cut.props.push(
      { id: 'p1', propId: 'prop_sword', position: [0, 0.07, 0], rotation: [0, 0, 0, 1], attachedTo: { dollInstanceId: 'd2', hand: 'right' } },
      { id: 'p2', propId: 'prop_cup', position: [1, 0.05, 0], rotation: [0, 0, 0, 1] },
      { id: 'p3', propId: 'prop_x', position: [0, 0, 0], rotation: [0, 0, 0, 1], attachedTo: { dollInstanceId: 'ghost', hand: 'left' } },
    );
    const item = sceneFromCut(cut, { count: 2, shot: 'full', angle: 'eye', dolls: [] }, {});
    expect(item.props.map((p) => p.attachedTo?.dollInstanceId ?? null)).toEqual(['slot:2', null, null]);
    // 원본은 그대로
    expect(cut.props[0].attachedTo?.dollInstanceId).toBe('d2');
    const { dolls, props } = dollsFromScene(item, {}, [], 'TMP');
    expect(props).toHaveLength(3);
    expect(props[0].attachedTo).toEqual({ dollInstanceId: dolls[1].id, hand: 'right' });
    expect(props[0].id).not.toBe('p1');
    expect(props[0].position).toEqual([0, 0.07, 0]);
    expect(props[1].attachedTo).toBeUndefined();
    expect(props[1].position).toEqual([1, 0.05, 0]);
    expect(props[2].attachedTo).toBeUndefined();
  });
});

describe('저장 파일 정규화', () => {
  it('빠진 필드를 채운다', () => {
    const s = normalizeScene({ id: 'x', slots: [{ slot: 1, dollId: 'mh2_m', position: [0, 0, 0], rotation: [0, 0, 0, 1], joints: {} }] });
    expect(s.autoTags.count).toBe(1);
    expect(s.name).toBe('1인 풀샷 아이레벨');
    expect(s.camera.focalLength).toBe(50);
    expect(s.aspect).toBe(1.5);
    expect(s.props).toEqual([]);
    const p = normalizePose({ id: 'p', joints: { Head: [0, 0, 0, 1] } });
    expect(p).toMatchObject({ id: 'p', name: '이름 없는 포즈', category: '일반', tags: [] });
  });

  it('태그 문자열 → 목록', () => {
    expect(parseTagList(' 대화, 일상,, 대화\n전투 ')).toEqual(['대화', '일상', '전투']);
  });
});
