/** 베니스 모델 목록(GET /models?type=inpaint, 키 불필요) → 편집 모델 선택지. 순수 변환만 둔다 */
export interface VeniceModel {
  id: string;
  name: string;
  /** 베니스가 검열 없음(uncensored)으로 표시한 모델 */
  uncensored: boolean;
  /** 'private'(서버에 남기지 않음) / 'anonymized' */
  privacy: string;
  /** 한 번에 넣을 수 있는 이미지 수. 목록에 없으면 null */
  maxImages: number | null;
  promptLimit: number | null;
  /** 대표 가격(USD, 1K 기준) */
  usd: number | null;
  /** 여러 장을 합쳐 넣을 수 있는가(우리 격자+레퍼런스 방식에 필요) */
  combine: boolean;
}

export const VENICE_MODELS_URL = 'https://api.venice.ai/api/v1/models?type=inpaint';

interface RawModel {
  id?: unknown;
  model_spec?: {
    name?: unknown;
    uncensored?: unknown;
    privacy?: unknown;
    offline?: unknown;
    pricing?: { inpaint?: { usd?: unknown }; resolutions?: { '1K'?: { usd?: unknown } } };
    constraints?: { maxInputImages?: unknown; maxImages?: unknown; promptCharacterLimit?: unknown; combineImages?: unknown };
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 응답 JSON → 모델 배열. 검열 없는 모델이 먼저, 그다음 가격 순. 이미지를 합칠 수 없거나 오프라인인 모델은 뺀다 */
export function parseVeniceModels(json: unknown): VeniceModel[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: VeniceModel[] = [];
  for (const m of data as RawModel[]) {
    const s = m?.model_spec;
    if (typeof m?.id !== 'string' || !s || s.offline === true) continue;
    const c = s.constraints ?? {};
    const combine = c.combineImages === true;
    if (!combine) continue;
    out.push({
      id: m.id,
      name: typeof s.name === 'string' ? s.name : m.id,
      uncensored: s.uncensored === true,
      privacy: typeof s.privacy === 'string' ? s.privacy : '',
      maxImages: num(c.maxInputImages) ?? num(c.maxImages),
      promptLimit: num(c.promptCharacterLimit),
      usd: num(s.pricing?.resolutions?.['1K']?.usd) ?? num(s.pricing?.inpaint?.usd),
      combine,
    });
  }
  return out.sort((a, b) => Number(b.uncensored) - Number(a.uncensored) || (a.usd ?? 99) - (b.usd ?? 99) || a.id.localeCompare(b.id));
}

/** 선택지 한 줄 표시 */
export function modelOptionLabel(m: VeniceModel): string {
  const tags = [m.uncensored ? '검열 없음' : '', m.privacy === 'private' ? '비공개' : '', m.usd != null ? `$${m.usd}` : '', m.maxImages ? `이미지 ${m.maxImages}장` : '', m.promptLimit ? `글 ${m.promptLimit}자` : ''].filter(Boolean);
  return `${m.name} — ${tags.join(' · ')}`;
}

/** 모델이 알려 준 이미지 수가 없으면 보수적으로 3장 */
export function imageLimitOf(m: VeniceModel): number {
  return m.maxImages ?? 3;
}
