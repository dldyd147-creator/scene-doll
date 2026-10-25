import { describe, expect, it } from 'vitest';
import { normalizeScene } from '../model/library';
import { createCharacter } from '../model/defaults';
import { useStore } from './store';

const item = normalizeScene({
  id: 'scene_t',
  name: '옥상 대치',
  autoTags: { count: 2, shot: 'full', angle: 'low', aspect: 1.25, placement: ['왼쪽 앞', '오른쪽 뒤'] },
  situationTags: ['대치'],
  slots: [
    { slot: 1, dollId: 'mh2_m', heightCm: 180, position: [-0.4, 0, 0], rotation: [0, 0.38, 0, 0.92], joints: { Head: [0.1, 0, 0, 0.995] } },
    { slot: 2, dollId: 'mh2_f', heightCm: 158, position: [0.5, 0, -0.8], rotation: [0, 0, 0, 1], joints: {} },
  ],
  camera: { position: [0.2, 0.9, 3.1], yaw: 10, pitch: 12, roll: 0, focalLength: 35 },
  aspect: 1.25,
});

describe('스토어: 씬 라이브러리 불러오기', () => {
  it('교체는 돌·카메라·화면비를 바꾸고 되돌릴 수 있다', () => {
    const s = useStore.getState();
    s.addDoll('mh2_m', 175);
    const before = s.currentCut();
    expect(before.dolls).toHaveLength(1);
    const hero = { ...createCharacter(s.work.code, '주인공', 'female', '#E5393B'), id: 'chr_hero', heightCm: 165 };
    useStore.setState({ characters: [...useStore.getState().characters, hero], sceneBrowserOpen: true });

    useStore.getState().applyLibraryScene(item, { 1: 'chr_hero' }, 'replace');
    const after = useStore.getState().currentCut();
    expect(after.dolls).toHaveLength(2);
    expect(after.dolls[0]).toMatchObject({ characterId: 'chr_hero', dollId: 'mh2_f', heightCm: 165, color: '#E5393B', position: [-0.4, 0, 0] });
    expect(after.dolls[1].heightCm).toBe(158);
    expect(after.camera).toEqual(item.camera);
    expect(after.aspect).toBe(1.25);
    expect(useStore.getState().sceneBrowserOpen).toBe(false);
    expect(useStore.getState().selection.dollId).toBeNull();
    // 비운 슬롯의 임시 캐릭터가 등록돼 컷이 항상 캐릭터 ID를 참조한다
    const chars = useStore.getState().characters;
    expect(chars.some((c) => c.id === after.dolls[1].characterId && c.temporary)).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().currentCut().dolls).toHaveLength(1);
    expect(useStore.getState().currentCut().camera).toEqual(before.camera);
  });

  it('추가는 돌만 더하고 카메라·화면비는 그대로', () => {
    const s = useStore.getState();
    const cur = s.currentCut();
    const n = cur.dolls.length;
    useStore.getState().applyLibraryScene(item, {}, 'add');
    const after = useStore.getState().currentCut();
    expect(after.dolls).toHaveLength(n + 2);
    expect(after.camera).toEqual(cur.camera);
    expect(after.aspect).toBe(cur.aspect);
    // 추가한 첫 돌이 선택된다
    expect(useStore.getState().selection.dollId).toBe(after.dolls[n].id);
    const ids = new Set(after.dolls.map((d) => d.id));
    expect(ids.size).toBe(after.dolls.length);
  });
});
