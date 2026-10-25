import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { ShareConfig, ShareUser } from './types';

const CONFIG_KEY = 'scene-doll.share.v1';

/** 브라우저에 남겨 둔 공유 저장소 접속 정보(주소·anon 키). 없으면 null */
export function loadShareConfig(): ShareConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as Partial<ShareConfig>;
    return cfg.url && cfg.anonKey ? { url: cfg.url, anonKey: cfg.anonKey } : null;
  } catch {
    return null;
  }
}

export function saveShareConfig(cfg: ShareConfig | null): void {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* 저장 불가 환경 */
  }
  if (!cfg || `${cfg.url}|${cfg.anonKey}` !== clientKey) {
    client = null;
    clientKey = '';
  }
}

/** 주소 형식 검사: https://xxxx.supabase.co 꼴(자체 설치면 아무 https 주소) */
export function normalizeShareUrl(url: string): string | null {
  const t = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+$/i.test(t)) return null;
  return t;
}

let client: SupabaseClient | null = null;
let clientKey = '';

/** 접속 정보로 클라이언트를 만든다(같은 정보면 재사용). 정보가 없으면 null */
export function getClient(cfg: ShareConfig | null = loadShareConfig()): SupabaseClient | null {
  if (!cfg) return null;
  const key = `${cfg.url}|${cfg.anonKey}`;
  if (client && clientKey === key) return client;
  client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'scene-doll.auth' } });
  clientKey = key;
  return client;
}

const toUser = (u: User | null | undefined): ShareUser | null => (u ? { id: u.id, email: u.email ?? null } : null);

export async function currentUser(sb: SupabaseClient): Promise<ShareUser | null> {
  const { data } = await sb.auth.getSession();
  return toUser(data.session?.user);
}

/** 지금 세션의 사용자와 접근 토큰(창을 닫을 때 keepalive 요청에 쓴다). 없으면 둘 다 null */
export async function currentSession(sb: SupabaseClient): Promise<{ user: ShareUser | null; token: string | null }> {
  const { data } = await sb.auth.getSession();
  return { user: toUser(data.session?.user), token: data.session?.access_token ?? null };
}

export async function signIn(sb: SupabaseClient, email: string, password: string): Promise<{ user: ShareUser | null; token: string | null; error: string | null }> {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { user: null, token: null, error: describeAuthError(error.message) };
  return { user: toUser(data.user), token: data.session?.access_token ?? null, error: null };
}

export async function signOut(sb: SupabaseClient): Promise<void> {
  await sb.auth.signOut().catch(() => undefined);
}

/** 로그인 상태 변화 구독(토큰 갱신 포함). 해제 함수를 돌려준다 */
export function onAuth(sb: SupabaseClient, cb: (user: ShareUser | null, token: string | null) => void): () => void {
  const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user), session?.access_token ?? null));
  return () => data.subscription.unsubscribe();
}

function describeAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않습니다';
  if (m.includes('email not confirmed')) return '이메일 확인이 끝나지 않은 계정입니다(관리자가 Confirm email을 끄거나 메일의 링크를 누르세요)';
  if (m.includes('failed to fetch') || m.includes('network')) return '공유 저장소에 연결할 수 없습니다(주소·인터넷 확인)';
  return message;
}
