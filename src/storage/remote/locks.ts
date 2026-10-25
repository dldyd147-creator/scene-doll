import type { SupabaseClient } from '@supabase/supabase-js';
import { pad3 } from '../backend';
import type { EpisodeLock, ShareUser } from './types';

/** 이만큼 신호가 없으면 잠금이 죽은 것으로 보고 넘겨받는다 */
export const LOCK_STALE_MS = 5 * 60_000;
/** 편집 중 이 간격으로 신호를 보낸다 */
export const LOCK_HEARTBEAT_MS = 60_000;

export const episodeLockPath = (code: string, n: number): string => `작품/${code}/회차/${pad3(n)}`;

export function isStale(lock: Pick<EpisodeLock, 'heartbeatAt'>, now = Date.now(), staleMs = LOCK_STALE_MS): boolean {
  const t = Date.parse(lock.heartbeatAt);
  return !Number.isFinite(t) || now - t > staleMs;
}

/** 내가 잡을 수 있는가: 비어 있거나, 내 것이거나, 죽은 잠금 */
export function canTake(lock: EpisodeLock | null, userId: string, now = Date.now()): boolean {
  return !lock || lock.userId === userId || isStale(lock, now);
}

interface LockRow {
  path: string;
  user_id: string;
  user_email: string | null;
  locked_at: string;
  heartbeat_at: string;
}

const fromRow = (r: LockRow): EpisodeLock => ({ path: r.path, userId: r.user_id, userEmail: r.user_email, lockedAt: r.locked_at, heartbeatAt: r.heartbeat_at });

export async function readLock(sb: SupabaseClient, path: string): Promise<EpisodeLock | null> {
  const { data, error } = await sb.from('episode_locks').select('*').eq('path', path).maybeSingle();
  if (error) throw new Error(`잠금 확인 실패: ${error.message}`);
  return data ? fromRow(data as LockRow) : null;
}

/** 회차 잠금 시도. 남이 살아 있는 잠금을 쥐고 있으면 그 잠금을 돌려준다 */
export async function acquireLock(sb: SupabaseClient, path: string, user: ShareUser): Promise<{ ok: true } | { ok: false; holder: EpisodeLock }> {
  const existing = await readLock(sb, path);
  if (!canTake(existing, user.id)) return { ok: false, holder: existing! };
  const now = new Date().toISOString();
  const { error } = await sb.from('episode_locks').upsert({ path, user_id: user.id, user_email: user.email, locked_at: existing?.userId === user.id ? existing.lockedAt : now, heartbeat_at: now }, { onConflict: 'path' });
  if (error) throw new Error(`잠금 실패: ${error.message}`);
  return { ok: true };
}

export async function heartbeatLock(sb: SupabaseClient, path: string, userId: string): Promise<void> {
  await sb.from('episode_locks').update({ heartbeat_at: new Date().toISOString() }).eq('path', path).eq('user_id', userId);
}

export async function releaseLock(sb: SupabaseClient, path: string, userId: string): Promise<void> {
  await sb.from('episode_locks').delete().eq('path', path).eq('user_id', userId);
}

/** 한 작품의 회차 잠금 전부(시작 화면 표시용) */
export async function listLocks(sb: SupabaseClient, code: string): Promise<EpisodeLock[]> {
  const { data, error } = await sb.from('episode_locks').select('*').like('path', `작품/${code}/회차/%`);
  if (error) throw new Error(`잠금 목록 실패: ${error.message}`);
  return ((data ?? []) as LockRow[]).map(fromRow);
}
