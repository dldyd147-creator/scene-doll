import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { storage } from '..';
import { useLibrary } from '../../ui/library';
import { currentUser, getClient, loadShareConfig, normalizeShareUrl, onAuth, saveShareConfig, signIn, signOut } from './client';
import { acquireLock, episodeLockPath, heartbeatLock, listLocks, LOCK_HEARTBEAT_MS, releaseLock } from './locks';
import { RemoteBackend } from './remoteBackend';
import { appendLog, listLog } from './worklog';
import type { EpisodeLock, LogAction, ShareConfig, ShareUser, WorkLogEntry } from './types';

/**
 * 공유 저장소 세션: 접속 정보·로그인 상태·회차 잠금·작업 로그·실시간 알림.
 * 로그인하면 저장소 서비스를 혼합 백엔드(작품·공용은 공유, 출력물은 로컬)로 바꾼다.
 */
export interface ShareState {
  config: ShareConfig | null;
  /** off: 접속 정보 없음 / signedOut: 정보는 있고 로그인 전 / signedIn */
  status: 'off' | 'signedOut' | 'signedIn';
  user: ShareUser | null;
  busy: boolean;
  error: string | null;
  /** 지금 연 회차의 잠금. mine=false면 보기 전용 */
  lock: { path: string; mine: boolean; holder: EpisodeLock | null } | null;
  /** 보고 있는 작품의 회차 잠금들(경로 → 잠금) */
  locks: Record<string, EpisodeLock>;
  watchedWork: string | null;
  log: WorkLogEntry[] | null;
}

export const useShare = create<ShareState>()(() => ({
  config: loadShareConfig(),
  status: loadShareConfig() ? 'signedOut' : 'off',
  user: null,
  busy: false,
  error: null,
  lock: null,
  locks: {},
  watchedWork: null,
  log: null,
}));

let unsubAuth: (() => void) | null = null;
let heartbeat = 0;
let channel: RealtimeChannel | null = null;

function client(): SupabaseClient | null {
  return getClient(useShare.getState().config);
}

/** 편집이 막힌 상태인가(남이 잠근 회차를 보는 중) */
export function isReadOnly(): boolean {
  const l = useShare.getState().lock;
  return !!l && !l.mine;
}

/** 앱 시작 때 한 번: 저장된 접속 정보로 세션을 되살린다 */
export async function initShare(): Promise<void> {
  const sb = client();
  if (!sb) return;
  const user = await currentUser(sb).catch(() => null);
  if (user) await activate(sb, user);
  unsubAuth?.();
  unsubAuth = onAuth(sb, (u) => {
    const cur = useShare.getState();
    if (u && cur.status !== 'signedIn') void activate(sb, u);
    else if (!u && cur.status === 'signedIn') deactivate();
    else if (u) useShare.setState({ user: u });
  });
}

async function activate(sb: SupabaseClient, user: ShareUser): Promise<void> {
  storage.useRemote(new RemoteBackend(sb, user.email));
  useShare.setState({ status: 'signedIn', user, error: null });
  useLibrary.getState().reset();
  startRealtime(sb);
}

function deactivate(): void {
  stopHeartbeat();
  stopRealtime();
  storage.clearRemote();
  useLibrary.getState().reset();
  useShare.setState({ status: useShare.getState().config ? 'signedOut' : 'off', user: null, lock: null, locks: {}, log: null });
}

/** 접속 정보 저장(주소·anon 키). 형식이 틀리면 오류 메시지 */
export function connectShare(url: string, anonKey: string): string | null {
  const u = normalizeShareUrl(url);
  if (!u) return '주소는 https://xxxx.supabase.co 꼴이어야 합니다';
  if (anonKey.trim().length < 20) return 'anon 키를 그대로 붙여 넣으세요';
  const cfg = { url: u, anonKey: anonKey.trim() };
  saveShareConfig(cfg);
  useShare.setState({ config: cfg, status: 'signedOut', error: null });
  void initShare();
  return null;
}

/** 접속 정보 지우기(로그아웃 포함) */
export async function disconnectShare(): Promise<void> {
  await logoutShare();
  saveShareConfig(null);
  unsubAuth?.();
  unsubAuth = null;
  useShare.setState({ config: null, status: 'off', user: null, error: null });
}

export async function loginShare(email: string, password: string): Promise<boolean> {
  const sb = client();
  if (!sb) return false;
  useShare.setState({ busy: true, error: null });
  const { user, error } = await signIn(sb, email, password);
  if (error || !user) {
    useShare.setState({ busy: false, error: error ?? '로그인 실패' });
    return false;
  }
  await activate(sb, user);
  useShare.setState({ busy: false });
  void appendLog(sb, user, { action: 'login' });
  return true;
}

export async function logoutShare(): Promise<void> {
  const sb = client();
  await unlockEpisode();
  if (sb) await signOut(sb);
  deactivate();
}

// ---------- 회차 잠금 ----------

/** 회차를 열 때: 잠금을 잡는다. 남이 쥐고 있으면 보기 전용(lock.mine=false)으로 표시 */
export async function lockEpisode(code: string, n: number): Promise<{ mine: boolean; holder: EpisodeLock | null }> {
  const sb = client();
  const user = useShare.getState().user;
  if (!sb || !user) return { mine: true, holder: null };
  await unlockEpisode();
  const path = episodeLockPath(code, n);
  try {
    const r = await acquireLock(sb, path, user);
    if (r.ok) {
      useShare.setState({ lock: { path, mine: true, holder: null } });
      stopHeartbeat();
      heartbeat = window.setInterval(() => void heartbeatLock(sb, path, user.id), LOCK_HEARTBEAT_MS);
      void appendLog(sb, user, { workCode: code, action: 'open', target: `회차 ${n}` });
      return { mine: true, holder: null };
    }
    useShare.setState({ lock: { path, mine: false, holder: r.holder } });
    return { mine: false, holder: r.holder };
  } catch (e) {
    useShare.setState({ error: e instanceof Error ? e.message : String(e) });
    return { mine: true, holder: null };
  }
}

/** 회차를 떠날 때(작품 관리로, 로그아웃, 창 닫기) */
export async function unlockEpisode(): Promise<void> {
  const sb = client();
  const s = useShare.getState();
  stopHeartbeat();
  if (!sb || !s.user || !s.lock) return;
  const { path, mine } = s.lock;
  useShare.setState({ lock: null });
  if (mine) await releaseLock(sb, path, s.user.id).catch(() => undefined);
}

function stopHeartbeat(): void {
  window.clearInterval(heartbeat);
  heartbeat = 0;
}

/** 시작 화면에서 보는 작품의 잠금들 */
export async function watchWorkLocks(code: string | null): Promise<void> {
  const sb = client();
  useShare.setState({ watchedWork: code });
  if (!sb || !code || useShare.getState().status !== 'signedIn') {
    useShare.setState({ locks: {} });
    return;
  }
  try {
    const locks = await listLocks(sb, code);
    useShare.setState({ locks: Object.fromEntries(locks.map((l) => [l.path, l])) });
  } catch {
    /* 표시용 */
  }
}

// ---------- 작업 로그 ----------

export function logAction(action: LogAction | string, target?: string | null, detail?: unknown, workCode?: string | null): void {
  const sb = client();
  const user = useShare.getState().user;
  if (!sb || !user) return;
  void appendLog(sb, user, { workCode, action, target, detail });
}

export async function refreshLog(workCode: string | null): Promise<void> {
  const sb = client();
  if (!sb || useShare.getState().status !== 'signedIn') return;
  try {
    useShare.setState({ log: await listLog(sb, workCode) });
  } catch (e) {
    useShare.setState({ error: e instanceof Error ? e.message : String(e) });
  }
}

// ---------- 실시간: 공용 라이브러리가 바뀌면 다시 읽고, 잠금이 바뀌면 목록 갱신 ----------

function startRealtime(sb: SupabaseClient): void {
  stopRealtime();
  channel = sb
    .channel('scene-doll')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'files' }, (payload) => {
      const row = (payload.new ?? payload.old) as { path?: string } | null;
      const path = row?.path ?? '';
      const lib = useLibrary.getState();
      if (path.startsWith('공용/씬/')) void lib.loadScenes(true);
      else if (path.startsWith('공용/포즈/')) void lib.loadPoses(true);
      else if (path.startsWith('공용/소품/')) void lib.loadProps(true);
      else if (path.startsWith('공용/손포즈/')) void lib.loadHandPoses(true);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'episode_locks' }, () => {
      const w = useShare.getState().watchedWork;
      if (w) void watchWorkLocks(w);
    })
    .subscribe();
}

function stopRealtime(): void {
  if (channel) {
    void channel.unsubscribe();
    channel = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // 창을 닫을 때 잠금을 풀어 본다(못 풀어도 5분 뒤 죽은 잠금으로 넘겨받을 수 있다)
    void unlockEpisode();
  });
}
