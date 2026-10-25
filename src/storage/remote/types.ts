/** 공유 저장소(Supabase) 쪽 자료 구조. 로컬 저장에서는 쓰지 않는다 */

export interface ShareConfig {
  /** Supabase Project URL (https://xxxx.supabase.co) */
  url: string;
  /** anon public 키(브라우저에 둬도 되는 공개 키) */
  anonKey: string;
}

export interface ShareUser {
  id: string;
  email: string | null;
}

export type MemberRole = 'read' | 'write' | 'admin';

export interface WorkMember {
  workCode: string;
  userId: string;
  role: MemberRole;
}

/** 회차 잠금: 경로는 작품/{코드}/회차/{번호} */
export interface EpisodeLock {
  path: string;
  userId: string;
  userEmail: string | null;
  lockedAt: string;
  heartbeatAt: string;
}

export type LogAction = 'login' | 'open' | 'save' | 'confirm' | 'export' | 'create' | 'delete' | 'scene' | 'character' | 'upload' | 'download';

export interface WorkLogEntry {
  id: number;
  at: string;
  userEmail: string | null;
  workCode: string | null;
  action: LogAction | string;
  target: string | null;
  detail: unknown;
}
