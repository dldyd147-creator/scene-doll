import { DOLL_ASSETS } from '../model/defaults';
import type { DollAsset } from '../model/types';

interface TrialEntry {
  id: string;
  name: string;
  gender: 'male' | 'female';
  baseHeightCm: number;
  file: string;
  boneMap?: Record<string, string>;
}

/**
 * 시험용 돌: public/dolls/trial/manifest.json에 적은 모델을 돌 목록에 더한다(구매·무료 모델을 기존 돌과 비교해 볼 때).
 * 파일이 없거나 형식이 틀리면 조용히 건너뛴다. 이 폴더는 git에 올리지 않는다
 */
export async function loadTrialDolls(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}dolls/trial/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const list: unknown = await res.json();
    if (!Array.isArray(list)) return;
    for (const raw of list as Partial<TrialEntry>[]) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.file !== 'string' || DOLL_ASSETS.some((d) => d.id === raw.id)) continue;
      const asset: DollAsset = {
        id: raw.id,
        name: raw.name ?? raw.id,
        gender: raw.gender === 'female' ? 'female' : 'male',
        bodyType: 'basic',
        baseHeightCm: Number(raw.baseHeightCm) || 170,
        glbPath: `dolls/trial/${raw.file}`,
        boneMap: raw.boneMap ?? {},
      };
      DOLL_ASSETS.push(asset);
    }
  } catch {
    /* 시험용 돌이 없다 */
  }
}
