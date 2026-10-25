import { useEffect, useRef, useState } from 'react';
import { storage } from '../storage';
import { copyTree, type SyncProgress } from '../storage/remote/sync';
import { connectShare, disconnectShare, loginShare, logAction, logoutShare, refreshLog, useShare } from '../storage/remote/service';
import type { EpisodeLock } from '../storage/remote/types';
import { LOG_ACTION_LABEL } from '../storage/remote/worklog';
import { Icon } from './icons';

const README_URL = 'https://github.com/dldyd147-creator/scene-doll/blob/main/serverless/supabase/README.md';

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 시작 화면의 공유 저장소 칸: 접속 정보 → 로그인 → 올리기/내려받기 → 작업 로그.
 * 로그인하면 작품·공용은 공유 저장소에서 읽고 쓰고, 출력물은 그대로 내 작업 폴더에 남는다
 */
export function SharePanel({ workCode, onChanged }: { workCode: string | null; onChanged?: () => void }) {
  const status = useShare((s) => s.status);
  const user = useShare((s) => s.user);
  const busy = useShare((s) => s.busy);
  const error = useShare((s) => s.error);
  const config = useShare((s) => s.config);
  const log = useShare((s) => s.log);
  const [url, setUrl] = useState(config?.url ?? '');
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [sync, setSync] = useState<{ dir: 'up' | 'down'; progress: SyncProgress } | null>(null);
  const [open, setOpen] = useState(status !== 'off');
  const cancel = useRef({ cancelled: false });

  useEffect(() => {
    if (status === 'signedIn') void refreshLog(workCode);
  }, [status, workCode]);

  const connect = () => {
    const err = connectShare(url, key);
    setLocalError(err);
    if (!err) setKey('');
  };

  const login = async () => {
    setLocalError(null);
    if (await loginShare(email, password)) {
      setPassword('');
      onChanged?.();
    }
  };

  const logout = async () => {
    await logoutShare();
    onChanged?.();
  };

  const runSync = async (dir: 'up' | 'down') => {
    const remote = storage.remoteBackend;
    if (!remote) return;
    const src = dir === 'up' ? storage.localBackend : remote;
    const dst = dir === 'up' ? remote : storage.localBackend;
    const label = dir === 'up' ? '내 폴더의 작품·공용 라이브러리를 공유 저장소로 올립니다. 공유에 이미 있는 파일은 건너뜁니다.' : '공유 저장소의 작품·공용 라이브러리를 내 폴더로 내려받습니다. 내 폴더에 이미 있는 파일은 건너뜁니다.';
    if (!window.confirm(label + ' 계속할까요?')) return;
    cancel.current = { cancelled: false };
    const total: SyncProgress = { copied: 0, skipped: 0, failed: [], current: '' };
    setSync({ dir, progress: total });
    for (const root of ['작품', '공용']) {
      const p = await copyTree(src, dst, root, {
        signal: cancel.current,
        onProgress: (pr) => setSync({ dir, progress: { copied: total.copied + pr.copied, skipped: total.skipped + pr.skipped, failed: [...total.failed, ...pr.failed], current: pr.current } }),
      });
      total.copied += p.copied;
      total.skipped += p.skipped;
      total.failed.push(...p.failed);
      if (cancel.current.cancelled) break;
    }
    setSync({ dir, progress: { ...total, current: '' } });
    logAction(dir === 'up' ? 'upload' : 'download', null, { copied: total.copied, skipped: total.skipped, failed: total.failed.length });
    onChanged?.();
  };

  return (
    <div className="card share-panel">
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <Icon name={status === 'signedIn' ? 'cloudOn' : 'cloud'} />
        <b className="grow" style={{ flex: 1 }}>
          공유 저장소
        </b>
        <span className="muted small">{status === 'signedIn' ? user?.email : status === 'signedOut' ? '로그인 전' : '사용 안 함'}</span>
        <span className="muted small">{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <>
          {status === 'off' && (
            <>
              <div className="muted small">
                여러 사람이 같은 작품을 쓰려면 Supabase 프로젝트를 하나 만들고 주소와 anon 공개 키를 넣습니다.{' '}
                <a href={README_URL} target="_blank" rel="noreferrer">
                  설정 방법 <Icon name="external" size={11} />
                </a>
              </div>
              <input type="text" value={url} placeholder="Project URL (https://xxxx.supabase.co)" onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
              <input type="password" value={key} placeholder="anon public 키" onChange={(e) => setKey(e.target.value)} spellCheck={false} />
              <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                <button className="primary" onClick={connect} disabled={!url || !key}>
                  연결
                </button>
              </div>
            </>
          )}
          {status === 'signedOut' && (
            <>
              <div className="muted small" title={config?.url}>
                {config?.url.replace(/^https:\/\//, '')} · 이메일과 비밀번호로 로그인하세요(계정은 관리자가 만들어 줍니다)
              </div>
              <input type="email" value={email} placeholder="이메일" onChange={(e) => setEmail(e.target.value)} spellCheck={false} autoComplete="username" />
              <input type="password" value={password} placeholder="비밀번호" onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void login()} autoComplete="current-password" />
              <div className="row-wrap" style={{ justifyContent: 'flex-end' }}>
                <button className="ghost" onClick={() => void disconnectShare()} title="접속 정보 지우기">
                  연결 해제
                </button>
                <button className="primary" onClick={() => void login()} disabled={busy || !email || !password}>
                  {busy ? '로그인 중…' : '로그인'}
                </button>
              </div>
            </>
          )}
          {status === 'signedIn' && (
            <>
              <div className="muted small">작품·공용 라이브러리는 공유 저장소에서 읽고 씁니다. 출력물·패키지는 내 {storage.status.localKind === 'folder' ? '작업 폴더' : '브라우저'}에 남습니다.</div>
              <div className="row-wrap">
                <button onClick={() => void runSync('up')} disabled={!!sync && !!sync.progress.current} title="내 폴더(브라우저)의 작품·공용 라이브러리를 공유 저장소로 복사">
                  <Icon name="upload" /> 내 폴더 → 공유
                </button>
                <button onClick={() => void runSync('down')} disabled={!!sync && !!sync.progress.current} title="공유 저장소의 작품·공용 라이브러리를 내 폴더로 복사">
                  <Icon name="export" /> 공유 → 내 폴더
                </button>
                <div className="grow" />
                <button className="ghost" onClick={() => void logout()}>
                  로그아웃
                </button>
              </div>
              {sync && (
                <div className="small">
                  {sync.progress.current ? (
                    <>
                      복사 중 {sync.progress.copied}개 · 건너뜀 {sync.progress.skipped}개 · <span className="muted">{sync.progress.current}</span>{' '}
                      <button className="ghost" onClick={() => (cancel.current.cancelled = true)}>
                        중단
                      </button>
                    </>
                  ) : (
                    <>
                      완료: 복사 {sync.progress.copied}개 · 건너뜀 {sync.progress.skipped}개{sync.progress.failed.length > 0 && <span style={{ color: 'var(--danger)' }}> · 실패 {sync.progress.failed.length}개</span>}
                    </>
                  )}
                  {sync.progress.failed.length > 0 && !sync.progress.current && (
                    <details>
                      <summary>실패 목록</summary>
                      <pre className="md-preview">{sync.progress.failed.join('\n')}</pre>
                    </details>
                  )}
                </div>
              )}
              <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span className="muted small grow" style={{ flex: 1 }}>
                  작업 로그{workCode ? ` · ${workCode}` : ''}
                </span>
                <button className="icon ghost" onClick={() => void refreshLog(workCode)} title="새로고침">
                  <Icon name="reset" size={14} />
                </button>
              </div>
              <div className="work-log">
                {log === null && <span className="muted small">불러오는 중…</span>}
                {log?.length === 0 && <span className="muted small">아직 기록이 없습니다.</span>}
                {log?.slice(0, 50).map((e) => (
                  <div key={e.id} className="work-log-row small" title={e.detail ? JSON.stringify(e.detail) : undefined}>
                    <span className="muted">{timeLabel(e.at)}</span>
                    <span className="who">{e.userEmail?.split('@')[0] ?? '?'}</span>
                    <span>{LOG_ACTION_LABEL[e.action] ?? e.action}</span>
                    <span className="muted grow">{e.target ?? ''}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {(error || localError) && (
            <div className="small" style={{ color: 'var(--danger)' }}>
              {localError ?? error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 회차 타일에 붙는 잠금 표시 */
export function LockBadge({ lock, me }: { lock: EpisodeLock | undefined; me: string | null }) {
  if (!lock) return null;
  const mine = lock.userId === me;
  return (
    <span className={`lock-badge ${mine ? 'mine' : ''}`} title={mine ? '내가 작업 중' : `${lock.userEmail ?? '다른 사람'} 작업 중 · 보기만 됩니다`}>
      <Icon name="lock" size={11} /> {mine ? '나' : (lock.userEmail?.split('@')[0] ?? '작업 중')}
    </span>
  );
}
