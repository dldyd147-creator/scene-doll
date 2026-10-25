// 손가락 쥐기 프리셋(4단계). 손가락별 1·2·3마디 굽힘각(도). 4마디(끝)는 뼈 끝이라 돌리지 않는다.
export type FingerName = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Pinky';
export const FINGERS: FingerName[] = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

export type Curl = [number, number, number];

export interface FingerPreset {
  id: string;
  label: string;
  hint: string;
  curl: Record<FingerName, Curl>;
}

const four = (c: Curl): Record<Exclude<FingerName, 'Thumb'>, Curl> => ({ Index: c, Middle: c, Ring: c, Pinky: c });

export const FINGER_PRESETS: FingerPreset[] = [
  { id: 'open', label: '펴기', hint: '손가락을 모두 편다(휴식)', curl: { Thumb: [0, 0, 0], ...four([0, 0, 0]) } },
  { id: 'relaxed', label: '자연스럽게', hint: '힘 뺀 손', curl: { Thumb: [8, 10, 5], ...four([15, 22, 15]) } },
  { id: 'grip', label: '쥐기', hint: '검·컵 같은 물건을 쥔 손(소품을 쥐어 주면 자동)', curl: { Thumb: [25, 35, 10], ...four([55, 75, 45]) } },
  { id: 'fist', label: '주먹', hint: '꽉 쥔 주먹', curl: { Thumb: [40, 45, 20], ...four([85, 95, 65]) } },
  { id: 'point', label: '가리키기', hint: '검지만 펴고 나머지는 쥠', curl: { Thumb: [30, 40, 15], Index: [0, 0, 0], Middle: [85, 95, 65], Ring: [85, 95, 65], Pinky: [85, 95, 65] } },
  { id: 'thumbsUp', label: '엄지 척', hint: '엄지만 펴고 나머지는 쥠', curl: { Thumb: [0, 0, 0], ...four([85, 95, 65]) } },
];

export function fingerPreset(id: string): FingerPreset | undefined {
  return FINGER_PRESETS.find((p) => p.id === id);
}

export function fingerBoneName(side: 'Left' | 'Right', finger: FingerName, joint: 1 | 2 | 3 | 4): string {
  return `${side}Hand${finger}${joint}`;
}
