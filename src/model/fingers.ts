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

export const FINGER_LABEL: Record<FingerName, string> = { Thumb: '엄지', Index: '검지', Middle: '중지', Ring: '약지', Pinky: '새끼' };

/** 손가락별 최대 굽힘(주먹) 프로필. 핸드 오퍼레이터 슬라이더 100%가 이 값 */
export const CURL_MAX: Record<FingerName, Curl> = { Thumb: [40, 45, 20], Index: [85, 95, 65], Middle: [85, 95, 65], Ring: [85, 95, 65], Pinky: [85, 95, 65] };

/** 손가락별 굽힘 정도 0~1 */
export type FingerAmounts = Record<FingerName, number>;

export const OPEN_AMOUNTS: FingerAmounts = { Thumb: 0, Index: 0, Middle: 0, Ring: 0, Pinky: 0 };

const sum3 = (c: Curl) => c[0] + c[1] + c[2];

export function curlFromAmounts(a: FingerAmounts): Record<FingerName, Curl> {
  const out = {} as Record<FingerName, Curl>;
  for (const f of FINGERS) {
    const k = Math.max(0, Math.min(1.3, a[f]));
    out[f] = [CURL_MAX[f][0] * k, CURL_MAX[f][1] * k, CURL_MAX[f][2] * k];
  }
  return out;
}

export function amountsFromCurl(c: Record<FingerName, Curl>): FingerAmounts {
  const out = {} as FingerAmounts;
  for (const f of FINGERS) out[f] = Math.max(0, Math.min(1, sum3(c[f]) / sum3(CURL_MAX[f])));
  return out;
}

/** 저장한 손 모양(공용/손포즈). 손가락별 마디 굽힘각 */
export interface HandPose {
  id: string;
  name: string;
  curl: Record<FingerName, Curl>;
  createdAt: string;
}

export function normalizeHandPose(raw: Partial<HandPose>): HandPose {
  const curl = {} as Record<FingerName, Curl>;
  for (const f of FINGERS) {
    const c = raw.curl?.[f];
    curl[f] = Array.isArray(c) && c.length === 3 ? [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0] : [0, 0, 0];
  }
  return { id: raw.id ?? `hpose_${Math.random().toString(36).slice(2, 10)}`, name: raw.name ?? '손 모양', curl, createdAt: raw.createdAt ?? new Date().toISOString() };
}
