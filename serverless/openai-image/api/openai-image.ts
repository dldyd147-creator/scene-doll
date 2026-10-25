import { handleImageRequest, type Env } from '../core';

/**
 * Vercel 함수 예시(Node 런타임, 웹 표준 Request/Response 핸들러).
 * 이 폴더(serverless/openai-image)를 Vercel 프로젝트 루트로 배포하면 https://<프로젝트>.vercel.app/api/openai-image 가 엔드포인트다.
 * 환경 변수(프로젝트 설정 > Environment Variables): OPENAI_API_KEY, ACCESS_TOKEN, ALLOWED_ORIGIN, OPENAI_IMAGE_MODEL
 * 주의: Vercel 함수의 요청 본문 상한은 4.5MB다. 1024px 칸 × 4컷 격자 + 레퍼런스는 이를 넘기 쉬우므로 칸 가로를 512~768px로 낮추거나 Cloudflare Worker를 쓴다.
 */
declare const process: { env: Record<string, string | undefined> };

/** 이미지 생성은 수십 초~2분. Hobby 플랜은 60초가 상한(Fluid compute면 300초) */
export const maxDuration = 120;

const handler = (request: Request): Promise<Response> => handleImageRequest(request, process.env as unknown as Env);

export const POST = handler;
export const GET = handler;
export const OPTIONS = handler;
