# 공유 저장소(Supabase) 설정

씬 돌은 기본으로 각자 작업 폴더(또는 브라우저 안)에 저장한다. 여러 사람이 같은 작품을 쓰려면 Supabase(무료 티어로 충분)에 공유 저장소를 하나 만들고, 앱의 **공유 저장소** 설정에 주소와 공개 키를 넣은 뒤 로그인한다. 자체 서버는 두지 않는다.

## 1. 프로젝트 만들기

1. https://supabase.com 에서 프로젝트를 만든다(지역은 가까운 곳, 예: Northeast Asia).
2. 프로젝트 설정 → API 에서 **Project URL** 과 **anon public** 키를 적어 둔다. anon 키는 브라우저에 넣어도 되는 공개 키다(권한은 아래 행 수준 보안이 막는다). **service_role** 키는 절대 앱에 넣지 않는다.

## 2. 표와 권한 만들기

SQL Editor 에 [`schema.sql`](schema.sql) 내용을 붙여 넣고 실행한다. 다시 실행해도 안전하다. 만들어지는 것:

| 이름 | 역할 |
| --- | --- |
| `files` | 경로별 파일(`작품/…`, `공용/…`). JSON·텍스트는 표에, 이미지·GLB는 `scene-doll` 버킷에 |
| `work_members` | 작품별 권한 `read` / `write` / `admin`. 작품을 처음 만든 사람이 admin |
| `episode_locks` | 회차 잠금(작업 중인 사람). 5분 동안 신호가 없으면 다른 사람이 넘겨받는다 |
| `work_log` | 작업 로그(누가 언제 무엇을) |
| 버킷 `scene-doll` | 레퍼런스 이미지·썸네일·소품 GLB. 비공개, 로그인한 사람만 |

출력 PNG, AI 전달 패키지, 생성 결과(`출력/`, `패키지/`, `생성/`)는 올리지 않고 각자 작업 폴더에 남는다.

## 3. 로그인 방식

Authentication → Providers 에서 **Email** 을 켠다. 사내에서 쓰면 **Confirm email** 을 끄고(Authentication → Settings) 관리자가 Authentication → Users → **Invite user** 로 계정을 만들어 주는 편이 간단하다. 비밀번호는 초대 메일에서 정한다.

## 4. 작품 권한 주기

작품을 처음 만든 사람은 자동으로 그 작품의 admin 이다. 다른 사람을 붙이려면 SQL Editor 에서:

```sql
insert into public.work_members (work_code, user_id, role)
select 'ACS', id, 'write' from auth.users where email = 'someone@example.com'
on conflict (work_code, user_id) do update set role = excluded.role;
```

역할: `read` 보기만, `write` 편집, `admin` 편집 + 권한 관리. 공용 라이브러리(씬·포즈·소품·손 모양)는 로그인한 사람 모두가 읽고 쓴다.

## 5. 앱에서 연결

1. 씬 돌 시작 화면의 **공유 저장소** 에서 Project URL 과 anon 키를 넣고 저장한다(브라우저에 남는다).
2. 이메일·비밀번호로 로그인한다. 로그인하면 `작품/`·`공용/` 은 공유 저장소에서 읽고 쓰고, 출력물은 그대로 내 작업 폴더에 쓴다.
3. 전에 작업 폴더에 둔 작품을 올리려면 **내 폴더 → 공유 저장소 올리기** 를 쓴다(반대 방향도 있다).

## 한계와 비용

- 무료 티어: 데이터베이스 500MB, 파일 1GB, 월 전송 5GB. 레퍼런스 이미지와 썸네일은 작아서 충분하고, 출력 PNG는 올리지 않는다.
- 동시 조작은 만들지 않는다. 같은 회차는 한 사람만 편집하고(회차 잠금) 다른 사람은 보기만 한다.
- 버킷의 이진 파일은 로그인한 사람이면 누구나 읽을 수 있다(어느 작품 것인지는 `files` 표가 가리며 키는 불투명하다). 작품별로 이미지까지 막아야 하면 버킷을 작품별로 나눈다.
- 프로젝트가 일주일 동안 쓰이지 않으면 무료 프로젝트는 잠시 멈춘다(대시보드에서 다시 켠다).
