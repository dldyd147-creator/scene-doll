# 씬 돌 서버리스 함수 — 이미지 생성 중계

씬 돌(브라우저 단독)은 OpenAI API 키를 브라우저에 두지 않는다. 5단계 이미지 생성은 사용자가 직접 배포한 작은 함수 하나가 키를 들고 OpenAI Images API를 대신 호출한다. 이 폴더가 그 함수의 템플릿이다.

```
serverless/
  README.md                 ← 이 문서
  openai-image/
    core.ts                 공용 처리기(토큰 검사·CORS·입력 검사·OpenAI 호출·응답 전달)
    worker.ts               Cloudflare Worker 진입점(권장)
    api/openai-image.ts     Vercel 함수 예시(같은 core.ts를 씀)
    wrangler.toml           Worker 설정(공개 변수)
    package.json, tsconfig.json
```

브라우저 → 함수 → OpenAI 순서이고, 결과(base64 PNG)는 함수가 OpenAI 응답 JSON을 그대로 돌려준다. 함수는 이미지를 저장하지 않는다.

## 1. Cloudflare Worker로 배포(권장)

무료 플랜으로도 동작한다(하루 10만 요청). 요청 본문 상한이 100MB라 1024px 칸 × 8컷 격자도 들어간다.

```bash
cd serverless/openai-image
npm install
npx wrangler login                      # 브라우저가 열리면 Cloudflare 로그인 → Allow
npx wrangler deploy                     # 처음이면 workers.dev 서브도메인 등록을 묻는다 → y → 소문자 영문 이름(예: GitHub ID) 입력
npx wrangler secret put OPENAI_API_KEY  # OpenAI 키(sk-…) 붙여 넣기(화면에 안 보임) — 저장소·설정 어디에도 적지 않는다
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # 접근 토큰 만들기(48자). 복사해 둔다
npx wrangler secret put ACCESS_TOKEN    # 위 문자열 붙여 넣기. 씬 돌 설정에 같은 값을 넣는다
```

배포가 끝나면 `https://scene-doll-image.<서브도메인>.workers.dev` 주소가 나온다. 브라우저에서 그 주소를 열면 `{"ok":true,"model":"gpt-image-2.5-sunburst","keyConfigured":true,"tokenRequired":true}`가 보여야 한다. 비밀값은 배포 뒤에 넣어도 바로 적용된다(다시 배포하지 않아도 됨).

실제 배포(2026-10-25)에서 겪은 것:

- 서브도메인 질문에 빈 값이나 띄어쓰기가 있는 이름을 넣으면 "is invalid"가 반복된다. 소문자·숫자·하이픈만.
- 새 서브도메인은 TLS 인증서가 붙기까지 몇 분 걸린다. 그동안 curl·브라우저가 "SSL/TLS 보안 채널" 오류를 낸다. 기다렸다 다시 연다.
- `npm install`은 `@cloudflare/workers-types` v5가 필요하다(wrangler 4.152 이상의 peer). npm이 `workerd` 설치 스크립트를 막았다고 경고하면 `wrangler dev`(로컬 실행)에만 영향이 있고 `deploy`·`secret put`은 상관없다.
- 배포 전 점검: `npx wrangler deploy --dry-run --outdir /tmp/x` (로그인 없이 번들만 확인).

`wrangler.toml`의 `[vars]`:

| 변수 | 기본 | 설명 |
| --- | --- | --- |
| `ALLOWED_ORIGIN` | `*` | CORS 허용 출처. 배포 페이지만 허용하려면 `https://dldyd147-creator.github.io,http://localhost:5173` 처럼 쉼표 목록 |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2.5-sunburst` | 요청에 model이 없을 때 쓰는 모델. `gpt-image-2.5-flare`(빠름), `gpt-image-2`, `gpt-image-1.5`도 가능. **gpt-image-1은 2026-10-23에 종료됨** |
| `MAX_IMAGES` | `16` | 첨부 상한(API 상한 16) |
| `MAX_N` | `4` | 한 요청의 후보 장수 상한 |

비밀값 두 개(`OPENAI_API_KEY`, `ACCESS_TOKEN`)는 `wrangler secret put`으로만 넣는다. 로그는 `npm run tail`.

## 2. Vercel 함수로 배포(예시)

`serverless/openai-image`를 프로젝트 루트로 Vercel에 올리면 `api/openai-image.ts`가 `https://<프로젝트>.vercel.app/api/openai-image`가 된다. 환경 변수는 프로젝트 설정 > Environment Variables에 `OPENAI_API_KEY`, `ACCESS_TOKEN`, `ALLOWED_ORIGIN`, `OPENAI_IMAGE_MODEL`을 넣는다.

주의:

- Vercel 함수의 **요청 본문 상한은 4.5MB**다. 1024px 칸 4컷 격자(약 2~4MB) + 레퍼런스 몇 장이면 넘기 쉽다. 설정 > 이미지 생성의 '칸(컷) 가로 px'를 512~768로 낮추거나 Cloudflare Worker를 쓴다.
- 이미지 생성은 수십 초~2분 걸린다. `maxDuration`을 120으로 두었지만 Hobby 플랜은 60초가 상한이다(Fluid compute를 켜면 300초).

## 3. 씬 돌에서 연결

설정(톱니) > **이미지 생성(5단계)**:

1. 엔진을 **원격(서버리스 함수)**로.
2. 함수 주소에 배포 URL(Worker는 루트 `/`, Vercel은 `/api/openai-image`).
3. 함수 접근 토큰에 `ACCESS_TOKEN`과 같은 값. (OpenAI 키가 아니다. 이 값은 브라우저 설정(localStorage)에 저장되므로 브라우저·PC마다 다시 넣는다.)
4. 상단 바 반짝 아이콘 → 묶음 준비 → 프롬프트 확인 → 보내기.

연결을 확인하기 전에는 엔진을 **모의**로 두고 흐름만 돌려 볼 수 있다(네트워크 없음, 돌 격자에 MOCK 표시).

## 4. 요청·응답 형식

함수는 `multipart/form-data` POST 하나만 받는다(`Authorization: Bearer <ACCESS_TOKEN>`).

| 필드 | 값 |
| --- | --- |
| `prompt` | 묶음 프롬프트(최대 32,000자) |
| `size` | `auto` 또는 `WIDTHxHEIGHT` |
| `n` | 후보 장수(1~`MAX_N`) |
| `quality` | `auto`·`low`·`medium`·`high`(2.5 계열은 `xhigh`·`max`도) |
| `input_fidelity` | `high`·`low`. **gpt-image-1.5에만 전달**(gpt-image-2 계열은 항상 고충실도라 받지 않음) |
| `model` | 선택. 없으면 `OPENAI_IMAGE_MODEL` |
| `image[]` | 첨부 이미지들. 첫 장이 돌 격자, 그 뒤 선화·마스크 격자·캐릭터 레퍼런스. 최대 16장, 한 장 50MB 미만 |

이미지가 한 장 이상이면 OpenAI `POST /v1/images/edits`(multipart, `image[]` 그대로), 없으면 `POST /v1/images/generations`(JSON)로 보낸다. 응답은 OpenAI 응답을 상태 코드까지 그대로 전달한다:

```json
{ "data": [{ "b64_json": "…" }], "output_format": "png", "usage": { "input_tokens": 1234, "output_tokens": 6240, "total_tokens": 7474 }, "model": "gpt-image-2.5-sunburst" }
```

오류는 `{ "error": { "message", "code" } }`다. 씬 돌은 `code: "moderation_blocked"`(안전 필터 거부)를 '생성 거부'로, 401·403을 '인증 실패'로 표시하고 그 묶음의 컷을 실패로 둔다. 함수 자체의 오류는 `type: "scene_doll_function"`으로 구분된다(`invalid_token`, `too_many_images`, `prompt_too_long`, `invalid_size` …).

curl로 직접 확인:

```bash
curl -s -X POST "https://scene-doll-image.<계정>.workers.dev/" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -F "prompt=격자의 돌 포즈를 따라 웹툰 컷을 그려라" -F "size=1024x1536" -F "n=1" -F "quality=low" \
  -F "image[]=@grid.png" | head -c 300
```

## 5. 비용·크기·시간 주의

- **과금은 토큰 단위**(2026-10 문서, gpt-image-2 / 2.5 계열): 이미지 출력 $30/백만 토큰, 이미지 입력 $8/백만 토큰, 텍스트 입력 $5/백만 토큰. 토큰 수는 크기·품질에 비례하므로 응답의 `usage`로 확인한다(씬 돌 완료 화면에 표시됨). 실측(2026-10-25, gpt-image-2.5-sunburst, 2×2 격자 1024×1536, 레퍼런스 없음, 품질 medium): 입력 2,734 토큰(그중 이미지 1,536) · 출력 343 토큰 → 묶음 한 번 약 3센트. 2인 2×1 격자 1024×768 + 레퍼런스 2장, 품질 low: 입력 약 3,400(이미지 2,176) · 출력 134 → 1센트 안팎. 응답은 30초 안팎. 참고용 옛 단가(gpt-image-2, 1024×1536 한 장): low ≈ $0.005, medium ≈ $0.04, high ≈ $0.17. 격자 한 장은 컷 4개 분량이고 레퍼런스 입력 토큰이 더해진다. 처음에는 `quality=low`·칸 512px로 흐름을 확인하고 올린다.
- **크기 규칙**(gpt-image-2 계열): 가로·세로 16의 배수, 비율 3:1 이내, 변 ≤ 3840px, 총 픽셀 655,360~8,294,400(2560×1440 초과는 실험적). 씬 돌의 '격자 비율' 모드가 이 규칙 안으로 맞춘다. gpt-image-1.5는 1024×1024·1024×1536·1536×1024·auto만 받으므로 '고정 3종' 모드를 쓴다.
- **입력**: 최대 16장(격자 1 + 선화·마스크 0~2 + 레퍼런스), 한 장 50MB 미만. 레퍼런스는 입력 토큰을 늘린다(캐릭터당 1장이 기본).
- **시간**: 복잡한 요청은 2분까지 걸릴 수 있다. Worker는 응답을 기다리는 시간이 CPU 시간에 들지 않지만, Vercel은 `maxDuration` 상한을 넘기면 끊긴다.
- **본문 크기**: Worker 100MB, Vercel 4.5MB. 브라우저는 이미지를 base64가 아닌 바이너리(multipart)로 보내 33%를 아낀다.
- **안전 필터**: 거부된 요청은 `moderation_blocked`로 돌아오며 그 묶음은 실패 처리된다. 실패 컷만 골라 단독으로 다시 보내면 다른 컷에는 영향이 없다.

## 6. 보안 메모

- OpenAI 키는 함수의 비밀값에만 있다. 저장소·wrangler.toml·브라우저 설정 어디에도 적지 않는다.
- `ACCESS_TOKEN`은 함수를 아무나 못 쓰게 막는 공유 비밀이다. 씬 돌 설정에 저장되므로 공용 PC에서는 쓰지 않거나 쓰고 나서 지운다. 토큰이 새면 `wrangler secret put ACCESS_TOKEN`으로 바꾼다.
- `ALLOWED_ORIGIN`을 배포 페이지 주소로 좁히면 다른 사이트의 브라우저 스크립트가 함수를 부를 수 없다(토큰이 있어도 CORS에서 막힘).
- 함수는 요청 내용을 저장하거나 기록하지 않는다. Cloudflare 로그(`wrangler tail`)에는 상태 코드만 남는다.

## 7. 같은 폴더의 다른 함수

`serverless/supabase/`는 공유 저장소(서버리스 전환)용 스키마와 안내다(그 폴더의 README 참고). 이미지 생성 함수와는 무관하다.
