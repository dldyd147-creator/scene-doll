import { GenError } from '../engine';
import type { ApiEntry } from '../apiList';
import { bflGenerate } from './bfl';
import type { ProviderRequest, ProviderResult } from './common';
import { openaiGenerate } from './openai';
import { veniceGenerate } from './venice';

/** 목록 항목의 서비스에 맞는 어댑터를 부른다(모의는 렌더러에서 처리) */
export async function runProvider(entry: ApiEntry, req: Omit<ProviderRequest, 'model' | 'baseUrl'>): Promise<ProviderResult> {
  const full: ProviderRequest = { ...req, model: entry.model, baseUrl: entry.baseUrl };
  switch (entry.service) {
    case 'venice':
      return veniceGenerate(full);
    case 'bfl':
      return bflGenerate(full);
    case 'openai':
      return openaiGenerate(full);
    case 'custom':
      return openaiGenerate(full, true);
    default:
      throw new GenError('config', `이 항목(${entry.service})은 직접 호출할 수 없습니다`);
  }
}
