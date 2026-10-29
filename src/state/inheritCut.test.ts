import { describe, expect, it } from 'vitest';
import { createCut } from '../model/defaults';
import type { DollInstance } from '../model/types';
import { inheritBlankCut } from './store';

const doll = { id: 'd1' } as DollInstance;

describe('빈 컷은 앞 컷의 씬을 이어받는다', () => {
  it('돌이 없는 미확정 컷이 앞 컷의 돌·카메라를 복사하고, 한 번만 이어받는다', () => {
    const a = { ...createCut(1), dolls: [doll], confirmed: true };
    a.camera = { ...a.camera, yaw: 30 };
    const b = createCut(2);
    const out = inheritBlankCut([a, b], 1);
    expect(out[1].dolls).toEqual([doll]);
    expect(out[1].dolls[0]).not.toBe(doll);
    expect(out[1].camera.yaw).toBe(30);
    expect(out[1].inherited).toBe(true);
    // 돌을 모두 지워도 다시 이어받지 않는다
    const cleared = [out[0], { ...out[1], dolls: [] }];
    expect(inheritBlankCut(cleared, 1)).toBe(cleared);
  });

  it('첫 컷·확정 컷·앞 컷도 빈 경우는 건드리지 않는다', () => {
    const a = createCut(1);
    const b = createCut(2);
    const cuts = [a, b];
    expect(inheritBlankCut(cuts, 0)).toBe(cuts);
    expect(inheritBlankCut(cuts, 1)).toBe(cuts);
    const withDoll = [{ ...a, dolls: [doll] }, { ...b, confirmed: true }];
    expect(inheritBlankCut(withDoll, 1)).toBe(withDoll);
  });
});
