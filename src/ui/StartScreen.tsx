import { useCallback, useEffect, useRef, useState } from 'react';
import { createWork, mainReferenceOf, nowIso, sortCharacters } from '../model/defaults';
import { moveWork } from '../model/workOrder';
import { useStore } from '../state/store';
import { storage } from '../storage';
import type { WorkInfo } from '../storage/repository';
import logoUrl from '../assets/logo.png';
import { Icon } from './icons';
import { useRefUrl } from './refImages';
import { makeCoverBlob, useWorkCover } from './workCover';
import { lastOpened, openDocument, saveNow } from './save';
import { features } from '../features';
import { StorageControls } from './StorageControls';
import { TransferDialog } from './TransferDialog';
import { LockBadge, SharePanel } from './SharePanel';
import { MembersPanel } from './MembersPanel';
import { episodeLockPath } from '../storage/remote/locks';
import { logAction, useShare, watchWorkLocks } from '../storage/remote/service';

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 시작 화면: 작품을 고르고 회차를 열거나, 캐릭터를 등록한다 */
export function StartScreen() {
  const storageKind = useStore((s) => s.storageKind);
  const shareStatus = useShare((s) => s.status);
  const shareUser = useShare((s) => s.user);
  const locks = useShare((s) => s.locks);
  const worksVersion = useShare((s) => s.worksVersion);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const managerFor = useStore((s) => s.characterManagerFor);
  const setCharacterManagerFor = useStore((s) => s.setCharacterManagerFor);
  const [works, setWorks] = useState<WorkInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() => lastOpened()?.code ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [episodePrompt, setEpisodePrompt] = useState<{ w: WorkInfo; value: string } | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const list = await storage.repository.listWorksInfo();
      setWorks(list);
      setSelected((cur) => (cur && list.some((w) => w.work.code === cur) ? cur : (list[0]?.work.code ?? null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 저장소가 바뀌거나(폴더/공유), 공유 저장소의 작품 파일·구성원이 바뀌면(다른 사람의 작업) 다시 읽는다
  useEffect(() => {
    void reload();
  }, [reload, storageKind, shareStatus, worksVersion]);

  // 공유 저장소면 고른 작품의 회차 잠금을 보여 준다(다른 사람이 작업 중인 회차)
  useEffect(() => {
    void watchWorkLocks(selected);
  }, [selected, shareStatus]);

  // 캐릭터 관리를 닫으면 요약을 새로 읽는다
  useEffect(() => {
    if (managerFor === null) void reload();
  }, [managerFor, reload]);

  const info = works?.find((w) => w.work.code === selected) ?? null;

  const createNew = async () => {
    const code = newCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (code.length !== 3) {
      setError('작품코드는 영문 대문자 3자입니다(예: ACS)');
      return;
    }
    if (works?.some((w) => w.work.code === code)) {
      setError(`작품코드 ${code}는 이미 있습니다`);
      return;
    }
    setBusy(true);
    try {
      await storage.repository.createWork(createWork(code, newName.trim() || code));
      logAction('create', `작품 ${code}`, null, code);
      setNewCode('');
      setNewName('');
      setError(null);
      await reload();
      setSelected(code);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const open = async (code: string, ep: number) => {
    setBusy(true);
    try {
      await openDocument(code, ep, true);
    } finally {
      setBusy(false);
    }
  };

  const askNewEpisode = (w: WorkInfo) => {
    const suggested = (w.episodes.length ? Math.max(...w.episodes.map((e) => e.number)) : 0) + 1;
    setEpisodePrompt({ w, value: String(suggested) });
  };

  const newEpisode = async (w: WorkInfo, answer: string) => {
    const next = Number.parseInt(answer.trim(), 10);
    if (!Number.isInteger(next) || next < 1 || next > 9999) {
      setError('회차 번호는 1~9999 사이의 숫자여야 합니다.');
      return;
    }
    setEpisodePrompt(null);
    setError(null);
    const exists = w.episodes.some((e) => e.number === next);
    setBusy(true);
    try {
      await openDocument(w.work.code, next, true);
      if (!exists) {
        await saveNow();
        logAction('create', `회차 ${next}`, null, w.work.code);
        // 새 회차는 글콘티(NTT 엑셀) 가져오기부터 — 필요 없으면 닫으면 된다
        useStore.getState().setScriptImportOpen(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const move = async (code: string, dir: -1 | 1) => {
    const changes = moveWork((works ?? []).map((w) => w.work.code), code, dir);
    if (!changes) return;
    for (const c of changes) {
      const w = works?.find((x) => x.work.code === c.code);
      if (w && w.work.order !== c.order) await storage.repository.saveWork({ ...w.work, order: c.order });
    }
    await reload();
  };

  const onCoverChosen = async (e: React.ChangeEvent<HTMLInputElement>, w: WorkInfo) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const blob = await makeCoverBlob(f);
      const file = '표지.jpg';
      await storage.repository.saveWorkCover(w.work.code, file, blob);
      await storage.repository.saveWork({ ...w.work, cover: file, updatedAt: nowIso() });
      setError(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeCover = async (w: WorkInfo) => {
    if (!w.work.cover) return;
    await storage.repository.removeWorkCover(w.work.code, w.work.cover);
    const { cover: _drop, ...rest } = w.work;
    await storage.repository.saveWork({ ...rest, updatedAt: nowIso() });
    await reload();
  };

  const renameWork = async (w: WorkInfo, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === w.work.name) return;
    await storage.repository.saveWork({ ...w.work, name: trimmed, updatedAt: nowIso() });
    await reload();
  };

  const deleteWork = async (w: WorkInfo) => {
    if (!window.confirm(`작품 ${w.work.code} "${w.work.name}"을 회차·컷·캐릭터까지 모두 지울까요? 되돌릴 수 없습니다. (출력·패키지 폴더는 남습니다)`)) return;
    await storage.repository.deleteWork(w.work.code);
    logAction('delete', `작품 ${w.work.code}`, null, w.work.code);
    await reload();
  };

  const deleteEpisode = async (w: WorkInfo, n: number) => {
    if (!window.confirm(`${w.work.code} ${n}화를 컷·썸네일까지 지울까요? 되돌릴 수 없습니다.`)) return;
    await storage.repository.deleteEpisode(w.work.code, n);
    logAction('delete', `회차 ${n}`, null, w.work.code);
    await reload();
  };

  return (
    <div className="start">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={logoUrl} alt="씬 돌" title="씬 돌" draggable={false} />
        </div>
        <div className="grow" />
        <StorageControls onChanged={() => void reload()} />
        <button onClick={() => setTransferOpen(true)} title="이동 파일(.scenedoll): 작품·캐릭터·소품·씬을 파일 하나로 내보내거나, 받은 파일을 합칩니다">
          EXPORT
        </button>
        <div className="sep" />
        <button className="icon" onClick={() => setSettingsOpen(true)} title="설정">
          <Icon name="settings" />
        </button>
        <button className="icon" onClick={() => setHelpOpen(true)} title="도움말">
          <Icon name="help" />
        </button>
      </header>
      <div className="start-body">
        <section className="start-works">
          <div className="panel-title" style={{ padding: '2px 0 6px' }}>
            작품 <span className="muted">{works?.length ?? 0}</span>
          </div>
          {!works && !error && <div className="muted small">불러오는 중…</div>}
          {works?.map((w, i) => (
            <div key={w.work.code} className={`work-card ${w.work.code === selected ? 'selected' : ''}`} onClick={() => setSelected(w.work.code)}>
              <WorkCover work={w.work} />
              <div className="work-card-body">
                <div className="row">
                  <b className="code">{w.work.code}</b>
                  <span className="grow name">{w.work.name}</span>
                </div>
                <div className="muted small">
                  회차 {w.episodes.length} · 캐릭터 {w.characters.length} · {dateLabel(w.work.updatedAt)}
                </div>
              </div>
              <div className="work-order">
                <button className="icon ghost" disabled={i === 0} onClick={(e) => (e.stopPropagation(), void move(w.work.code, -1))} title="위로">
                  <Icon name="up" size={13} />
                </button>
                <button className="icon ghost" disabled={i === works.length - 1} onClick={(e) => (e.stopPropagation(), void move(w.work.code, 1))} title="아래로">
                  <Icon name="down" size={13} />
                </button>
              </div>
            </div>
          ))}
          {works && works.length === 0 && <div className="muted small">아직 작품이 없습니다. 아래에서 첫 작품을 만드세요.</div>}
          <div className="card new-work">
            <b>새 작품</b>
            <div className="row">
              <input type="text" value={newCode} maxLength={3} placeholder="코드" onChange={(e) => setNewCode(e.target.value.toUpperCase())} style={{ width: 64 }} spellCheck={false} title="작품코드(영문 대문자 3자)" />
              <input type="text" value={newName} placeholder="작품명" className="grow" onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void createNew()} spellCheck={false} />
              <button className="primary icon" onClick={() => void createNew()} disabled={busy} title="작품 만들기">
                <Icon name="plus" />
              </button>
            </div>
          </div>
          {features.share && <SharePanel workCode={selected} onChanged={() => void reload()} />}
          {error && (
            <div className="small" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          )}
          <div className="muted small" style={{ marginTop: 'auto' }}>
            {storageKind === 'folder' ? '작업 폴더의 작품/ 아래에 저장됩니다.' : '작업 폴더를 지정하지 않아 브라우저 안에 저장됩니다. 탐색기에서 보려면 위의 작업 폴더를 누르세요.'}
          </div>
        </section>
        <section className="start-detail">
          {!info && <div className="placeholder">왼쪽에서 작품을 고르세요.</div>}
          {info && (
            <>
              <div className="detail-head">
                <b className="code">{info.work.code}</b>
                <input className="work-name" type="text" defaultValue={info.work.name} key={info.work.code} onBlur={(e) => void renameWork(info, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} spellCheck={false} title="작품명(고치고 Enter)" />
                <div className="grow" />
                <input ref={coverInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void onCoverChosen(e, info)} />
                <button className="ghost" onClick={() => coverInput.current?.click()} title="작품 목록에 보일 표지(썸네일) 이미지를 등록합니다">
                  <Icon name="gallery" /> 표지
                </button>
                {info.work.cover && (
                  <button className="icon ghost" onClick={() => void removeCover(info)} title="표지 지우기">
                    <Icon name="close" size={13} />
                  </button>
                )}
                <button className="ghost danger" onClick={() => void deleteWork(info)} title="작품 삭제">
                  <Icon name="trash" /> 작품 삭제
                </button>
              </div>

              <h3 className="section-title">
                회차 <span className="muted">{info.episodes.length}</span>
                <button className="primary" onClick={() => askNewEpisode(info)} disabled={busy}>
                  <Icon name="plus" /> 새 회차
                </button>
              </h3>
              <div className="episode-grid">
                {info.episodes.map((ep) => (
                  <div key={ep.number} className="episode-tile" onClick={() => void open(info.work.code, ep.number)} title="열기(편집 화면)">
                    <div className="row">
                      <b>{String(ep.number).padStart(3, '0')}화</b>
                      <LockBadge lock={locks[episodeLockPath(info.work.code, ep.number)]} me={shareUser?.id ?? null} />
                      <span className="grow muted small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ep.title ?? ''}
                      </span>
                      <button className="icon ghost danger" onClick={(e) => (e.stopPropagation(), void deleteEpisode(info, ep.number))} title="회차 삭제">
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                    <div className="muted small">
                      컷 {ep.cutCount} · {dateLabel(ep.updatedAt)}
                    </div>
                  </div>
                ))}
                {info.episodes.length === 0 && <div className="muted small">회차가 없습니다. 새 회차를 만드세요.</div>}
              </div>

              <h3 className="section-title">
                캐릭터 <span className="muted">{info.characters.length}</span>
                <button onClick={() => setCharacterManagerFor(info.work.code)}>
                  <Icon name="user" /> 캐릭터 관리
                </button>
              </h3>
              <div className="chr-grid">
                {sortCharacters(info.characters).map((c) => (
                  <CharacterCard key={c.id} workCode={info.work.code} chr={c} onClick={() => setCharacterManagerFor(info.work.code)} />
                ))}
              </div>

              {shareStatus === 'signedIn' && <MembersPanel workCode={info.work.code} />}
            </>
          )}
        </section>
      </div>
      {episodePrompt && (
        <div className="modal-backdrop" onClick={() => setEpisodePrompt(null)}>
          <div className="modal" style={{ width: 360 }} onClick={(e) => e.stopPropagation()}>
            <h2>새 회차</h2>
            <div className="small muted">만들 회차 번호(숫자)를 입력하세요. 이미 있는 번호면 그 회차를 엽니다.</div>
            <div className="row" style={{ marginTop: 10 }}>
              <input
                type="number"
                min={1}
                max={9999}
                autoFocus
                className="grow"
                value={episodePrompt.value}
                onChange={(e) => setEpisodePrompt({ ...episodePrompt, value: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && void newEpisode(episodePrompt.w, episodePrompt.value)}
              />
              <button className="primary" onClick={() => void newEpisode(episodePrompt.w, episodePrompt.value)}>
                만들기
              </button>
              <button onClick={() => setEpisodePrompt(null)}>취소</button>
            </div>
            {error && (
              <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>
                {error}
              </div>
            )}
          </div>
        </div>
      )}
      {transferOpen && <TransferDialog works={works ?? []} onClose={() => setTransferOpen(false)} onChanged={() => void reload()} />}
    </div>
  );
}

function WorkCover({ work }: { work: WorkInfo['work'] }) {
  const url = useWorkCover(work.code, work.cover, work.updatedAt);
  return <div className="work-cover">{url ? <img src={url} alt="" draggable={false} /> : <Icon name="book" size={20} />}</div>;
}

function CharacterCard({ workCode, chr, onClick }: { workCode: string; chr: WorkInfo['characters'][number]; onClick: () => void }) {
  const main = mainReferenceOf(chr);
  const url = useRefUrl(workCode, chr.id, main?.file);
  return (
    <div className="chr-card" onClick={onClick} title="캐릭터 관리 열기">
      <div className="thumb" style={{ borderColor: chr.color }}>
        {url ? <img src={url} alt={chr.name} draggable={false} /> : <Icon name="user" size={22} />}
      </div>
      <div className="meta">
        <div className="row">
          <span className="swatch" style={{ background: chr.color }} />
          <b className="grow">{chr.name}</b>
        </div>
        <div className="muted small">
          {chr.info.gender === 'male' ? '남' : chr.info.gender === 'female' ? '여' : '기타'} · {chr.heightCm}cm · 레퍼런스 {chr.references.length}장
        </div>
        {chr.info.oneLine && <div className="small one-line">{chr.info.oneLine}</div>}
      </div>
    </div>
  );
}
