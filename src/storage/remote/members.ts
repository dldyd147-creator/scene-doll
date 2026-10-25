import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole, WorkMemberInfo } from './types';

/** 역할 순서(화면 드롭다운) */
export const MEMBER_ROLES: MemberRole[] = ['admin', 'write', 'read'];
export const ROLE_LABEL: Record<MemberRole, string> = { admin: '관리', write: '편집', read: '보기' };
export const ROLE_DESC: Record<MemberRole, string> = { admin: '편집 + 구성원 관리', write: '회차·컷·캐릭터 편집', read: '보기만' };

/** 이메일 꼴인가(앞뒤 공백은 무시) */
export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

interface MemberRow {
  user_id: string;
  email: string | null;
  role: MemberRole;
  added_at: string;
}

/** 서버 함수가 없을 때(스키마를 아직 다시 안 돌렸을 때) 알아듣기 쉬운 말로 */
function describe(message: string): string {
  if (/schema cache|could not find the function/i.test(message)) return '공유 저장소에 구성원 함수가 없습니다. serverless/supabase/schema.sql을 SQL Editor에서 다시 실행하세요';
  return message;
}

/** 작품 구성원(이메일 포함). 그 작품의 구성원만 볼 수 있다(아니면 빈 목록) */
export async function listMembers(sb: SupabaseClient, code: string): Promise<WorkMemberInfo[]> {
  const { data, error } = await sb.rpc('work_members_of', { code });
  if (error) throw new Error(`구성원 목록 실패: ${describe(error.message)}`);
  return ((data ?? []) as MemberRow[]).map((r) => ({ userId: r.user_id, email: r.email, role: r.role, addedAt: r.added_at }));
}

/** 이메일로 구성원 추가(이미 있으면 역할만 바꿈). 그 작품의 admin만. 추가된 사람의 id */
export async function addMember(sb: SupabaseClient, code: string, email: string, role: MemberRole): Promise<string> {
  const { data, error } = await sb.rpc('add_work_member', { code, member_email: email.trim(), member_role: role });
  if (error) throw new Error(describe(error.message));
  return data as string;
}

/** 구성원 빼기. admin만, 마지막 admin은 못 뺀다(서버가 막는다) */
export async function removeMember(sb: SupabaseClient, code: string, userId: string): Promise<void> {
  const { error } = await sb.rpc('remove_work_member', { code, member_id: userId });
  if (error) throw new Error(describe(error.message));
}
