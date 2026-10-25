import { useCallback, useEffect, useState } from 'react';
import { isEmail, MEMBER_ROLES, ROLE_DESC, ROLE_LABEL } from '../storage/remote/members';
import { addWorkMember, listWorkMembers, removeWorkMember, useShare } from '../storage/remote/service';
import type { MemberRole, WorkMemberInfo } from '../storage/remote/types';
import { Icon } from './icons';

/**
 * 작품 관리 화면의 구성원 칸(공유 저장소에 로그인했을 때만): 누가 이 작품을 볼 수 있는지.
 * 관리(admin) 역할은 이메일로 추가하고 역할을 바꾸거나 뺀다. 상대 계정은 Supabase에 먼저 있어야 한다
 */
export function MembersPanel({ workCode }: { workCode: string }) {
  const user = useShare((s) => s.user);
  const version = useShare((s) => s.membersVersion);
  const [members, setMembers] = useState<WorkMemberInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('write');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMembers(await listWorkMembers(workCode));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workCode]);

  useEffect(() => {
    setMembers(null);
    void reload();
  }, [reload, version]);

  const me = members?.find((m) => m.userId === user?.id) ?? null;
  const isAdmin = me?.role === 'admin';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!isEmail(email)) return;
    void run(async () => {
      await addWorkMember(workCode, email, role);
      setEmail('');
    });
  };

  const changeRole = (m: WorkMemberInfo, r: MemberRole) => {
    if (!m.email || r === m.role) return;
    void run(() => addWorkMember(workCode, m.email ?? '', r));
  };

  const remove = (m: WorkMemberInfo) => {
    if (!window.confirm(`${m.email ?? m.userId}을(를) 이 작품에서 뺄까요? 그 사람은 더 이상 이 작품을 볼 수 없습니다.`)) return;
    void run(() => removeWorkMember(workCode, m.userId, m.email));
  };

  return (
    <>
      <h3 className="section-title">
        구성원 <span className="muted">{members?.length ?? 0}</span>
        {me && (
          <span className="muted small" title={ROLE_DESC[me.role]}>
            내 역할: {ROLE_LABEL[me.role]}
          </span>
        )}
      </h3>
      <div className="member-list">
        {members === null && !error && <div className="muted small">불러오는 중…</div>}
        {members?.map((m) => (
          <div key={m.userId} className="member-row">
            <Icon name="user" size={14} />
            <span className="grow email" title={m.email ?? m.userId}>
              {m.email ?? m.userId}
              {m.userId === user?.id ? ' (나)' : ''}
            </span>
            {isAdmin ? (
              <select value={m.role} onChange={(e) => changeRole(m, e.target.value as MemberRole)} disabled={busy} title={`역할: ${ROLE_DESC[m.role]}`}>
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="muted small" title={ROLE_DESC[m.role]}>
                {ROLE_LABEL[m.role]}
              </span>
            )}
            {isAdmin && m.userId !== user?.id && (
              <button className="icon ghost danger" onClick={() => remove(m)} disabled={busy} title="이 작품에서 빼기">
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        ))}
        {isAdmin && (
          <div className="member-row add">
            <input type="email" value={email} placeholder="이메일(Supabase에 계정이 있어야 함)" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} spellCheck={false} disabled={busy} />
            <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)} disabled={busy} title="새 구성원의 역할">
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]} · {ROLE_DESC[r]}
                </option>
              ))}
            </select>
            <button className="primary" onClick={add} disabled={busy || !isEmail(email)} title="이 작품의 구성원으로 추가">
              <Icon name="plus" /> 추가
            </button>
          </div>
        )}
        {members && !isAdmin && <div className="muted small">구성원 추가·역할 변경은 이 작품의 관리(admin) 역할이 합니다.</div>}
        {error && (
          <div className="small" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </div>
    </>
  );
}
