import type { SupabaseClient } from '@supabase/supabase-js';
import type { LogAction, ShareUser, WorkLogEntry } from './types';

interface LogRow {
  id: number;
  at: string;
  user_email: string | null;
  work_code: string | null;
  action: string;
  target: string | null;
  detail: unknown;
}

/** 작업 로그 한 줄. 실패해도 작업을 막지 않는다(조용히 넘어감) */
export async function appendLog(sb: SupabaseClient, user: ShareUser, entry: { workCode?: string | null; action: LogAction | string; target?: string | null; detail?: unknown }): Promise<void> {
  try {
    await sb.from('work_log').insert({ user_id: user.id, user_email: user.email, work_code: entry.workCode ?? null, action: entry.action, target: entry.target ?? null, detail: entry.detail ?? null });
  } catch {
    /* 로그는 작업을 막지 않는다 */
  }
}

/** 작품(또는 전체)의 최근 로그 */
export async function listLog(sb: SupabaseClient, workCode: string | null, limit = 200): Promise<WorkLogEntry[]> {
  let q = sb.from('work_log').select('id,at,user_email,work_code,action,target,detail').order('at', { ascending: false }).limit(limit);
  if (workCode) q = q.eq('work_code', workCode);
  const { data, error } = await q;
  if (error) throw new Error(`작업 로그 읽기 실패: ${error.message}`);
  return ((data ?? []) as LogRow[]).map((r) => ({ id: r.id, at: r.at, userEmail: r.user_email, workCode: r.work_code, action: r.action, target: r.target, detail: r.detail }));
}

export const LOG_ACTION_LABEL: Record<string, string> = {
  login: '로그인',
  open: '회차 열기',
  save: '저장',
  confirm: '컷 확정',
  export: '출력',
  create: '만들기',
  delete: '삭제',
  scene: '씬 저장',
  character: '캐릭터 수정',
  upload: '공유 저장소로 올림',
  download: '내 폴더로 내려받음',
  member: '구성원',
};
