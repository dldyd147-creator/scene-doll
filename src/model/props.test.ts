import { describe, expect, it } from 'vitest';
import { createGlbProp, createPrimitiveProp, gripFor, normalizeProp, normalizeSize, propsForWork, sizeLabel } from './props';

describe('소품 정의', () => {
  it('기본 도형 소품: 도형별 치수 정리와 라벨', () => {
    const sword = createPrimitiveProp(' 검 ', 'box', [0.05, 0.95, 0.012], { tags: ['무기', ' 무기', ''], color: '#c0c7d1' });
    expect(sword.name).toBe('검');
    expect(sword.tags).toEqual(['무기']);
    expect(sword.model).toEqual({ kind: 'primitive', shape: 'box', size: [0.05, 0.95, 0.012] });
    expect(sword.workCode).toBeNull();
    expect(sizeLabel(sword)).toBe('5×95×1cm');
    const cup = createPrimitiveProp('컵', 'cylinder', [0.08, 0.1, 0.5]);
    expect(cup.model.kind === 'primitive' && cup.model.size).toEqual([0.08, 0.1, 0.08]);
    expect(sizeLabel(cup)).toBe('지름 8 · 높이 10cm');
    const ball = createPrimitiveProp('', 'sphere', [0.22, 1, 1]);
    expect(ball.name).toBe('구');
    expect(sizeLabel(ball)).toBe('지름 22cm');
    expect(normalizeSize('box', [0, 99, NaN])).toEqual([0.005, 5, 0.1]);
  });

  it('GLB 소품과 쥐기 기본값', () => {
    const p = createGlbProp('지팡이', '공용/소품/prop_x.glb', { workCode: 'ACS' });
    expect(p.model).toEqual({ kind: 'glb', path: '공용/소품/prop_x.glb' });
    expect(p.workCode).toBe('ACS');
    expect(gripFor(p, 'right')).toEqual({ position: [0, 0.07, 0], rotation: [0, 0, 0, 1] });
    p.grip.right = { position: [0, 0.05, 0.02], rotation: [0.7071, 0, 0, 0.7071] };
    expect(gripFor(p, 'right').position).toEqual([0, 0.05, 0.02]);
    expect(gripFor(p, 'left')).toEqual({ position: [0, 0.07, 0], rotation: [0, 0, 0, 1] });
    // 돌려준 값은 사본
    gripFor(p, 'right').position[0] = 9;
    expect(p.grip.right.position[0]).toBe(0);
  });

  it('저장 파일 정규화와 작품 필터', () => {
    const n = normalizeProp({ id: 'p1', name: '  ', model: { kind: 'primitive', shape: 'tube' as never, size: [0.1, 0.2, 0.3] }, grip: { right: { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, left: undefined } });
    expect(n.name).toBe('소품');
    expect(n.model).toEqual({ kind: 'primitive', shape: 'box', size: [0.1, 0.2, 0.3] });
    expect(n.grip.right).toBeDefined();
    expect(n.grip.left).toBeUndefined();
    expect(n.workCode).toBeNull();
    const shared = normalizeProp({ id: 's', name: '공용' });
    const mine = normalizeProp({ id: 'm', name: '내것', workCode: 'ACS' });
    const other = normalizeProp({ id: 'o', name: '남의것', workCode: 'ZZZ' });
    expect(propsForWork([shared, mine, other], 'ACS').map((p) => p.id)).toEqual(['s', 'm']);
  });
});
