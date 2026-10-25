-- 씬 돌 공유 저장소(Supabase) 스키마.
-- Supabase 프로젝트의 SQL Editor에서 그대로 실행한다. 다시 실행해도 안전하다(if not exists / or replace).
--
-- 설계: 앱의 저장소 모듈은 '경로 → 파일' 모델이므로(작품/ACS/회차/001/컷/001.json 등) 그대로 유지한다.
--   files          경로별 파일. JSON·텍스트는 content 열에, 이미지·GLB 같은 이진 파일은 Storage 버킷의 객체(object_key)에 둔다.
--   work_members   작품별 접근 권한(read / write / admin). 작품을 처음 만든 사람이 admin이 된다.
--   episode_locks  회차 잠금: 회차를 연 사람을 기록해 다른 사람은 보기만 한다(5분 동안 신호가 없으면 넘겨받을 수 있다).
--   work_log       작업 로그: 누가 언제 어떤 작품·회차·컷·캐릭터를 만들고·고치고·확정·출력했는지.
-- 출력 PNG·AI 패키지·생성 결과(출력/, 패키지/, 생성/)는 올리지 않고 각자 작업 폴더(또는 브라우저)에 둔다.

-- ---------- 표 ----------

create table if not exists public.work_members (
  work_code text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('read', 'write', 'admin')),
  added_at timestamptz not null default now(),
  primary key (work_code, user_id)
);

create table if not exists public.files (
  path text primary key,
  kind text not null check (kind in ('text', 'bin')),
  content text,
  object_key text,
  size bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_email text
);
create index if not exists files_path_prefix on public.files (path text_pattern_ops);

create table if not exists public.episode_locks (
  path text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_email text,
  locked_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

create table if not exists public.work_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  user_email text,
  work_code text,
  action text not null,
  target text,
  detail jsonb
);
create index if not exists work_log_work_at on public.work_log (work_code, at desc);

-- ---------- 도우미 ----------

-- 경로에서 작품코드를 꺼낸다. '작품/ACS/...' → 'ACS', 그 밖(공용/ 등)은 null
create or replace function public.work_code_of(p text)
returns text language sql immutable as $$
  select case when p like '작품/%' then split_part(p, '/', 2) else null end
$$;

create or replace function public.my_role(code text)
returns text language sql stable security definer set search_path = public as $$
  select role from public.work_members where work_code = code and user_id = auth.uid()
$$;

create or replace function public.can_read(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.work_code_of(p) is null
    or public.my_role(public.work_code_of(p)) is not null
    -- 아직 아무도 없는 작품(처음 만드는 중)도 읽을 수 있어야 한다. 앱은 upsert(on conflict do update)로 쓰는데,
    -- PostgreSQL은 이때 select 정책도 insert 검사에 넣는다. 트리거가 admin을 넣어도 같은 문장 안에서는 보이지 않으므로 이 줄이 없으면 첫 파일 쓰기가 막힌다.
    or not exists (select 1 from public.work_members where work_code = public.work_code_of(p))
  )
$$;

create or replace function public.can_write(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.work_code_of(p) is null
    or public.my_role(public.work_code_of(p)) in ('write', 'admin')
    -- 아직 아무도 없는 작품은 누구나 만들 수 있다(만든 사람이 admin이 된다: 아래 트리거)
    or not exists (select 1 from public.work_members where work_code = public.work_code_of(p))
  )
$$;

-- 작품을 처음 만드는 사람을 admin으로 등록한다
create or replace function public.files_bootstrap_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare code text;
begin
  code := public.work_code_of(new.path);
  if code is not null and auth.uid() is not null
     and not exists (select 1 from public.work_members where work_code = code) then
    insert into public.work_members (work_code, user_id, role) values (code, auth.uid(), 'admin')
    on conflict do nothing;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end
$$;

drop trigger if exists files_bootstrap_member on public.files;
create trigger files_bootstrap_member before insert or update on public.files
  for each row execute function public.files_bootstrap_member();

-- ---------- 행 수준 보안 ----------

alter table public.work_members enable row level security;
alter table public.files enable row level security;
alter table public.episode_locks enable row level security;
alter table public.work_log enable row level security;

drop policy if exists members_read on public.work_members;
create policy members_read on public.work_members for select
  using (auth.uid() is not null and (user_id = auth.uid() or public.my_role(work_code) is not null));

drop policy if exists members_admin_write on public.work_members;
create policy members_admin_write on public.work_members for all
  using (public.my_role(work_code) = 'admin')
  with check (public.my_role(work_code) = 'admin');

drop policy if exists files_read on public.files;
create policy files_read on public.files for select using (public.can_read(path));

drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert with check (public.can_write(path));

drop policy if exists files_update on public.files;
create policy files_update on public.files for update using (public.can_write(path)) with check (public.can_write(path));

drop policy if exists files_delete on public.files;
create policy files_delete on public.files for delete using (public.can_write(path));

drop policy if exists locks_read on public.episode_locks;
create policy locks_read on public.episode_locks for select using (public.can_read(path));

drop policy if exists locks_write on public.episode_locks;
create policy locks_write on public.episode_locks for all
  using (public.can_write(path)) with check (public.can_write(path) and user_id = auth.uid());

drop policy if exists log_read on public.work_log;
create policy log_read on public.work_log for select
  using (auth.uid() is not null and (work_code is null or public.my_role(work_code) is not null));

drop policy if exists log_insert on public.work_log;
create policy log_insert on public.work_log for insert
  with check (auth.uid() is not null and user_id = auth.uid());

-- ---------- 구성원 관리(앱의 작품 관리 화면에서 admin이 이메일로 추가·역할 변경·제거) ----------

-- 작품 구성원 목록(이메일 포함). 그 작품의 구성원만 볼 수 있다(아니면 빈 목록)
create or replace function public.work_members_of(code text)
returns table (user_id uuid, email text, role text, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.added_at
  from public.work_members m
  join auth.users u on u.id = m.user_id
  where m.work_code = code and public.my_role(code) is not null
  order by case m.role when 'admin' then 0 when 'write' then 1 else 2 end, m.added_at
$$;

-- 이메일로 구성원 추가(이미 있으면 역할만 바꿈). 그 작품의 admin만. 추가된 사람의 id를 돌려준다
create or replace function public.add_work_member(code text, member_email text, member_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if public.my_role(code) is distinct from 'admin' then
    raise exception '이 작품의 관리(admin) 역할만 구성원을 바꿀 수 있습니다';
  end if;
  if member_role not in ('read', 'write', 'admin') then
    raise exception '역할은 read / write / admin 중 하나입니다';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(member_email)) limit 1;
  if uid is null then
    raise exception '그 이메일의 계정이 없습니다. Supabase의 Authentication → Users에서 먼저 계정을 만드세요';
  end if;
  if member_role <> 'admin'
     and exists (select 1 from public.work_members where work_code = code and user_id = uid and role = 'admin')
     and (select count(*) from public.work_members where work_code = code and role = 'admin') <= 1 then
    raise exception '마지막 관리 역할은 내릴 수 없습니다. 먼저 다른 사람을 관리로 올리세요';
  end if;
  insert into public.work_members (work_code, user_id, role) values (code, uid, member_role)
  on conflict (work_code, user_id) do update set role = excluded.role;
  return uid;
end
$$;

-- 구성원 빼기. admin만. 마지막 admin은 뺄 수 없다
create or replace function public.remove_work_member(code text, member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role(code) is distinct from 'admin' then
    raise exception '이 작품의 관리(admin) 역할만 구성원을 바꿀 수 있습니다';
  end if;
  if exists (select 1 from public.work_members where work_code = code and user_id = member_id and role = 'admin')
     and (select count(*) from public.work_members where work_code = code and role = 'admin') <= 1 then
    raise exception '마지막 관리 역할은 뺄 수 없습니다. 먼저 다른 사람을 관리로 올리세요';
  end if;
  delete from public.work_members where work_code = code and user_id = member_id;
end
$$;

-- ---------- 파일 저장소(이진 파일) ----------

insert into storage.buckets (id, name, public)
values ('scene-doll', 'scene-doll', false)
on conflict (id) do nothing;

-- 객체 키는 앱이 만든 불투명한 이름(bin/…)이고 어느 작품 것인지는 files 표가 안다. 로그인한 사람은 읽고 쓸 수 있다.
drop policy if exists scene_doll_read on storage.objects;
create policy scene_doll_read on storage.objects for select
  using (bucket_id = 'scene-doll' and auth.uid() is not null);

drop policy if exists scene_doll_write on storage.objects;
create policy scene_doll_write on storage.objects for insert
  with check (bucket_id = 'scene-doll' and auth.uid() is not null);

drop policy if exists scene_doll_update on storage.objects;
create policy scene_doll_update on storage.objects for update
  using (bucket_id = 'scene-doll' and auth.uid() is not null);

drop policy if exists scene_doll_delete on storage.objects;
create policy scene_doll_delete on storage.objects for delete
  using (bucket_id = 'scene-doll' and auth.uid() is not null);

-- ---------- 실시간 알림(파일·잠금·구성원·작업 로그) ----------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'files') then
    alter publication supabase_realtime add table public.files;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'episode_locks') then
    alter publication supabase_realtime add table public.episode_locks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_members') then
    alter publication supabase_realtime add table public.work_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_log') then
    alter publication supabase_realtime add table public.work_log;
  end if;
end
$$;
