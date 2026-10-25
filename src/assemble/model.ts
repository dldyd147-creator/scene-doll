/** 6단계 원고 조립 데이터. 회차 JSON의 `assembly`에 저장되고, 옛 문서에는 없으므로 normalizeAssembly가 기본값을 채운다 */

export type BubbleShape = 'ellipse' | 'round';

export interface AssemblySettings {
  /** 스트립 폭(px) */
  width: number;
  /** 컷 사이 간격(px) */
  gutter: number;
  /** 맨 위·맨 아래 여백(px) */
  margin: number;
  /** 배경색 HEX */
  background: string;
  /** 슬라이스 한 장의 최대 세로(px) */
  sliceMax: number;
  /** 화면용 글꼴(CSS font-family) */
  fontFamily: string;
  /** PSD 글 레이어용 PostScript 글꼴 이름 */
  psdFont: string;
  /** 글자 크기 배율(1 = 폭의 3.6%) */
  fontScale: number;
  /** 새 말풍선의 기본 모양 */
  shape: BubbleShape;
  /** 꼬리를 기본으로 그릴지 */
  tail: boolean;
}

/** 사용자가 만진 말풍선(대사 기본값 위에 덮어씀). 위치·크기는 컷 크기에 대한 비율 */
export interface BubbleOverride {
  cx?: number;
  cy?: number;
  /** 말풍선 몸통 폭 */
  w?: number;
  text?: string;
  shape?: BubbleShape;
  /** undefined = 자동, null = 꼬리 없음, 값 = 꼬리 끝 위치 */
  tail?: { x: number; y: number } | null;
  hidden?: boolean;
}

export interface Assembly {
  settings: AssemblySettings;
  /** 키: `${컷번호}:${대사순번}` */
  bubbles: Record<string, BubbleOverride>;
  /** 조립에서 뺀 컷 번호 */
  skip: number[];
}

export const DEFAULT_FONT = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export function defaultSettings(): AssemblySettings {
  return { width: 800, gutter: 40, margin: 0, background: '#ffffff', sliceMax: 1280, fontFamily: DEFAULT_FONT, psdFont: 'MalgunGothic', fontScale: 1, shape: 'ellipse', tail: true };
}

const num = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : d;
  return Math.min(hi, Math.max(lo, n));
};

export function normalizeAssembly(a: Partial<Assembly> | undefined | null): Assembly {
  const d = defaultSettings();
  const s: Partial<AssemblySettings> = a?.settings ?? {};
  const settings: AssemblySettings = {
    width: Math.round(num(s.width, 200, 4000, d.width)),
    gutter: Math.round(num(s.gutter, 0, 800, d.gutter)),
    margin: Math.round(num(s.margin, 0, 800, d.margin)),
    background: typeof s.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.background) ? s.background : d.background,
    sliceMax: Math.round(num(s.sliceMax, 200, 20000, d.sliceMax)),
    fontFamily: typeof s.fontFamily === 'string' && s.fontFamily.trim() ? s.fontFamily : d.fontFamily,
    psdFont: typeof s.psdFont === 'string' && s.psdFont.trim() ? s.psdFont : d.psdFont,
    fontScale: num(s.fontScale, 0.4, 3, d.fontScale),
    shape: s.shape === 'round' ? 'round' : 'ellipse',
    tail: s.tail === false ? false : true,
  };
  const bubbles: Record<string, BubbleOverride> = {};
  for (const [k, v] of Object.entries(a?.bubbles ?? {})) if (v && typeof v === 'object') bubbles[k] = v;
  const skip = Array.isArray(a?.skip) ? a.skip.filter((n): n is number => typeof n === 'number') : [];
  return { settings, bubbles, skip };
}

export const bubbleKey = (cutNumber: number, index: number): string => `${cutNumber}:${index}`;
