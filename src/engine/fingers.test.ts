import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { curlQuaternion, palmNormal } from './fingers';
import { FINGER_PRESETS, fingerBoneName, fingerPreset } from '../model/fingers';

/** -0을 0으로, 소수 5자리로 */
const r = (v: Vector3): number[] => v.toArray().map((x) => (Math.abs(x) < 1e-9 ? 0 : +x.toFixed(5)));

describe('손가락 프리셋', () => {
  it('프리셋 목록과 뼈 이름', () => {
    expect(FINGER_PRESETS.map((p) => p.id)).toEqual(['open', 'relaxed', 'grip', 'fist', 'point', 'thumbsUp']);
    expect(fingerPreset('grip')?.curl.Index).toEqual([55, 75, 45]);
    expect(fingerPreset('point')?.curl.Index).toEqual([0, 0, 0]);
    expect(fingerBoneName('Right', 'Thumb', 1)).toBe('RightHandThumb1');
    expect(fingerBoneName('Left', 'Pinky', 4)).toBe('LeftHandPinky4');
  });

  it('손바닥 법선: 손바닥이 아래를 보는 T포즈에서 양손 모두 -Y', () => {
    // 오른팔은 -X, 왼팔은 +X로 뻗고 엄지는 앞(+Z)
    expect(r(palmNormal('Right', new Vector3(-1, 0, 0), new Vector3(0, 0, 1)))).toEqual([0, -1, 0]);
    expect(r(palmNormal('Left', new Vector3(1, 0, 0), new Vector3(0, 0, 1)))).toEqual([0, -1, 0]);
  });

  it('굽힘: 손가락이 손바닥 쪽(아래)으로 접힌다', () => {
    const normal = new Vector3(0, -1, 0);
    const right = new Vector3(-1, 0, 0).applyQuaternion(curlQuaternion(new Vector3(-1, 0, 0), normal, 90));
    expect(r(right)).toEqual([0, -1, 0]);
    const left = new Vector3(1, 0, 0).applyQuaternion(curlQuaternion(new Vector3(1, 0, 0), normal, 90));
    expect(r(left)).toEqual([0, -1, 0]);
    // 0도는 항등
    expect(curlQuaternion(new Vector3(1, 0, 0), normal, 0).w).toBe(1);
  });
});
