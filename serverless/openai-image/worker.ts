import { handleImageRequest, type Env } from './core';

/**
 * Cloudflare Worker 진입점.
 *   npm install → npx wrangler login → npx wrangler secret put OPENAI_API_KEY → npx wrangler secret put ACCESS_TOKEN → npx wrangler deploy
 * 배포 URL(https://scene-doll-image.<계정>.workers.dev/)과 ACCESS_TOKEN을 씬 돌 설정 > 이미지 생성에 넣는다.
 */
export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleImageRequest(request, env),
};
