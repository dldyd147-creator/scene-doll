import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { PRESET_ORDER, PRESETS } from '../generate/batch';
import { engineFor, GEN_ERROR_LABEL } from '../generate/engine';
import { disposeBatches, disposeOutcomes, prepareBatches, runBatches, type BatchOutcome, type PreparedBatch, type Progress } from '../generate/runner';
import type { Cut } from '../model/types';
import type { GenPreset, GenSizeMode } from '../state/settings';
import { useStore } from '../state/store';
import { storage } from '../storage';
import { paths } from '../storage/repository';
import { Icon } from './icons';
import { useThumb } from './library';
import { saveNow } from './save';

type Tab = 'generate' | 'candidates';
type Phase = 'setup' | 'preparing' | 'review' | 'running' | 'done';
type Scope = 'all' | 'current' | 'missing' | 'failed';

const pad3 = (n: number) => String(n).padStart(3, '0');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 후보 썸네일 하나: 클릭하면 대표, 도구 줄에 새 탭·삭제 */
function Candidate({ path, main, onMain, onDelete }: { path: string; main: boolean; onMain: () => void; onDelete: () => void }) {
  const url = useThumb(path);
  return (
    <div className={`cand ${main ? 'main' : ''}`} title={`${path}${main ? ' · 대표' : ' · 클릭하면 대표로'}`}>
      {url ? <img src={url} alt="" onClick={onMain} /> : <span className="small muted cand-empty">{url === null ? '…' : '파일 없음'}</span>}
      <span className="cand-tools">
        {main ? (
          <span className="badge">대표</span>
        ) : (
          <button className="icon" onClick={onMain} title="이 후보를 대표로(generatedImages[0])">
            <Icon name="check" size={12} />
          </button>
        )}
        {url && (
          <a href={url} target="_blank" rel="noreferrer" title="새 탭에서 열기">
            <Icon name="external" size={12} />
          </a>
        )}
        <button className="icon danger" onClick={onDelete} title="후보 파일 삭제">
          <Icon name="trash" size={12} />
        </button>
      </span>
    </div>
  );
}

function Segmented<T extends string | number>({ value, options, onChange, labels }: { value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<string, string>> }) {
  return (
    <span className="segmented">
      {options.map((o) => (
        <button key={String(o)} className={o === value ? 'active' : ''} onClick={() => onChange(o)}>
          {labels?.[String(o)] ?? String(o)}
        </button>
      ))}
    </span>
  );
}

const SIZE_LABEL: Record<GenSizeMode, string> = { custom: '격자 비율', fixed: '고정 3종', auto: '자동' };

/**
 * 5단계 이미지 생성 대화상자.
 * [묶음 생성] 탭: 대상 컷·프리셋·묶음 상한 → [묶음 준비](렌더·격자·프롬프트, 네트워크 없음) → 프롬프트 확인·수정 → [보내기] → 진행률·취소.
 * [후보 비교] 탭: 컷별 후보 썸네일, 대표 선택, 실패 표시, 실패 컷만 재생성(단독/재묶음), 컷 단독 생성.
 */
export function GenerateDialog({ engine }: { engine: Engine }) {
  const open = useStore((s) => s.generateOpen);
  const setOpen = useStore((s) => s.setGenerateOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const cuts = useStore((s) => s.cuts);
  const currentCutIndex = useStore((s) => s.currentCutIndex);
  const thumbnails = useStore((s) => s.thumbnails);
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const setGeneratedMain = useStore((s) => s.setGeneratedMain);
  const removeGeneratedImage = useStore((s) => s.removeGeneratedImage);
  const setCutGroupTags = useStore((s) => s.setCutGroupTags);

  const [tab, setTab] = useState<Tab>('generate');
  const [phase, setPhase] = useState<Phase>('setup');
  const [scope, setScope] = useState<Scope>('all');
  const [single, setSingle] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batches, setBatches] = useState<PreparedBatch[]>([]);
  const [outcomes, setOutcomes] = useState<BatchOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 마지막 실행에서 실패한 컷 → 이유 / 성공한 컷 → 새 후보 수 */
  const [lastFailed, setLastFailed] = useState<Map<number, string>>(new Map());
  const [lastOk, setLastOk] = useState<Map<number, number>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const batchesRef = useRef<PreparedBatch[]>([]);
  const outcomesRef = useRef<BatchOutcome[]>([]);

  const confirmed = useMemo(() => cuts.filter((c) => c.confirmed), [cuts]);
  const currentCut = cuts[currentCutIndex];
  const failedCuts = useMemo(() => confirmed.filter((c) => lastFailed.has(c.number)), [confirmed, lastFailed]);
  const targets: Cut[] = useMemo(() => {
    if (scope === 'current') return currentCut?.confirmed ? [currentCut] : [];
    if (scope === 'missing') return confirmed.filter((c) => !(c.generatedImages ?? []).length);
    if (scope === 'failed') return failedCuts;
    return confirmed;
  }, [scope, confirmed, currentCut, failedCuts]);

  const gen = useMemo(() => engineFor(settings), [settings]);
  const remoteUnset = settings.genEngine === 'remote' && !settings.genEndpoint.trim();
  const folder = paths.generatedDir(work.code, episode.number);

  const resetWork = () => {
    abortRef.current?.abort();
    disposeBatches(batchesRef.current);
    disposeOutcomes(outcomesRef.current);
    batchesRef.current = [];
    outcomesRef.current = [];
    setBatches([]);
    setOutcomes([]);
    setProgress(null);
    setPhase('setup');
  };

  // 닫히면 진행 중인 일을 취소하고 미리보기 URL을 해제한다(실패·성공 표시는 남긴다)
  useEffect(() => {
    if (!open) resetWork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const busy = phase === 'preparing' || phase === 'running';

  const prepare = async (list: Cut[], asSingle: boolean) => {
    if (!list.length) return;
    setError(null);
    disposeBatches(batchesRef.current);
    batchesRef.current = [];
    setBatches([]);
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase('preparing');
    setProgress({ done: 0, total: list.length, current: '' });
    setTab('generate');
    try {
      const prepared = await prepareBatches(engine, { cuts: list, single: asSingle, settings }, setProgress, ac.signal);
      if (ac.signal.aborted) {
        disposeBatches(prepared);
        setPhase('setup');
        return;
      }
      batchesRef.current = prepared;
      setBatches(prepared);
      setPhase('review');
    } catch (e) {
      setError(message(e));
      setPhase('setup');
    }
  };

  const run = async () => {
    if (!batches.length) return;
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    disposeOutcomes(outcomesRef.current);
    outcomesRef.current = [];
    setOutcomes([]);
    setPhase('running');
    setProgress({ done: 0, total: batches.length, current: '' });
    const results = await runBatches(gen, batches, {
      n: settings.genCandidates,
      quality: settings.genQuality,
      signal: ac.signal,
      onProgress: setProgress,
      onBatch: (o) => {
        outcomesRef.current = [...outcomesRef.current, o];
        setOutcomes(outcomesRef.current);
      },
    });
    const failed = new Map<number, string>();
    const ok = new Map<number, number>();
    for (const o of results)
      for (const c of o.cuts) {
        const n = o.saved[c]?.length ?? 0;
        if (o.ok && n) ok.set(c, n);
        else failed.set(c, `${GEN_ERROR_LABEL[o.errorKind ?? 'request']}${o.error ? `: ${o.error}` : ''}`);
      }
    setLastFailed(failed);
    setLastOk(ok);
    setPhase('done');
    setTab('candidates');
  };

  const cancel = () => abortRef.current?.abort();

  const close = () => {
    if (busy) cancel();
    setOpen(false);
  };

  const deleteCandidate = async (cut: Cut, path: string) => {
    if (!window.confirm(`후보 파일을 지울까요?\n${path}`)) return;
    try {
      await storage.repository.deleteGenerated(path);
    } catch (e) {
      setError(`삭제 실패: ${message(e)}`);
    }
    removeGeneratedImage(cut.number, path);
    void saveNow();
  };

  const setPrompt = (id: string, prompt: string) => {
    const next = batches.map((b) => (b.id === id ? { ...b, prompt } : b));
    batchesRef.current = next;
    setBatches(next);
  };

  const dropBatch = (id: string) => {
    const b = batches.find((x) => x.id === id);
    if (b) disposeBatches([b]);
    const next = batches.filter((x) => x.id !== id);
    batchesRef.current = next;
    setBatches(next);
  };

  const attachCount = batches.reduce((n, b) => n + b.images.length, 0);
  const totalWidth = (b: PreparedBatch) => b.size === 'auto' ? `${b.layout.width}×${b.layout.height} → 자동` : b.size.replace('x', '×');

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide gen" onClick={(e) => e.stopPropagation()}>
        <h2>
          <Icon name="sparkles" /> 이미지 생성 <span className="muted small">{gen.label} · 생성/{work.code}/{pad3(episode.number)}/</span>
          <span className="grow" />
          <button className="icon close-x" onClick={close} title="닫기">
            <Icon name="close" />
          </button>
        </h2>
        <div className="gen-tabs">
          <button className={tab === 'generate' ? 'active' : ''} onClick={() => setTab('generate')}>
            묶음 생성
          </button>
          <button className={tab === 'candidates' ? 'active' : ''} onClick={() => setTab('candidates')}>
            후보 비교 {lastFailed.size ? <span className="gen-status fail">실패 {lastFailed.size}</span> : null}
          </button>
        </div>
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}

        {tab === 'generate' && phase === 'setup' && (
          <>
            {remoteUnset && (
              <div className="small" style={{ color: 'var(--danger)' }}>
                원격 엔진이 선택됐지만 함수 주소가 없습니다.{' '}
                <button onClick={() => setSettingsOpen(true)}>설정 열기</button>
              </div>
            )}
            <div className="setting">
              <span>대상 컷</span>
              <span className="gen-row">
                <Segmented value={scope} options={lastFailed.size ? (['all', 'missing', 'current', 'failed'] as const) : (['all', 'missing', 'current'] as const)} onChange={setScope} labels={{ all: `확정 전체 ${confirmed.length}`, missing: `후보 없는 컷 ${confirmed.filter((c) => !(c.generatedImages ?? []).length).length}`, current: `현재 컷${currentCut?.confirmed ? '' : '(미확정)'}`, failed: `실패 컷 ${failedCuts.length}` }} />
                <button className={single ? 'active' : ''} onClick={() => setSingle(!single)} title="켜면 컷마다 따로 생성(격자 없음). 끄면 묶음 태그끼리 상한까지 묶음">
                  {single ? '단독' : '묶음'}
                </button>
              </span>
              <span />
            </div>
            <div className="setting">
              <span>강도 프리셋</span>
              <span className="gen-row">
                <Segmented value={settings.genPreset} options={PRESET_ORDER} onChange={(v: GenPreset) => update({ genPreset: v })} labels={{ doll: PRESETS.doll.label, balanced: PRESETS.balanced.label, prompt: PRESETS.prompt.label }} />
                <span className="small muted">{PRESETS[settings.genPreset].short}</span>
              </span>
              <span />
            </div>
            <div className="setting">
              <span>묶음 상한 · 후보 장수</span>
              <span className="gen-row">
                <Segmented value={settings.genMaxPerBatch} options={[4, 6, 8] as const} onChange={(v) => update({ genMaxPerBatch: v })} labels={{ 4: '4컷', 6: '6컷', 8: '8컷' }} />
                <Segmented value={settings.genCandidates} options={[1, 2, 3, 4] as const} onChange={(v) => update({ genCandidates: v })} labels={{ 1: '1장', 2: '2장', 3: '3장', 4: '4장' }} />
              </span>
              <span />
            </div>
            <div className="setting">
              <span>첨부 · 크기</span>
              <span className="gen-row">
                <button className={settings.genAttachLine ? 'active' : ''} onClick={() => update({ genAttachLine: !settings.genAttachLine })} title="돌 격자와 같은 구성의 선화 격자를 함께 첨부">
                  선화
                </button>
                <button className={settings.genAttachMask ? 'active' : ''} onClick={() => update({ genAttachMask: !settings.genAttachMask })} title="캐릭터 고정색 평면의 색 마스크 격자를 함께 첨부">
                  마스크
                </button>
                <span className="small muted">레퍼런스 {settings.genRefsPerCharacter}장/캐릭터</span>
                <Segmented value={settings.genSizeMode} options={['custom', 'fixed', 'auto'] as const} onChange={(v) => update({ genSizeMode: v })} labels={SIZE_LABEL} />
                <span className="small muted">칸 {settings.genCellPx}px · 품질 {settings.genQuality}</span>
                <button className="icon" onClick={() => setSettingsOpen(true)} title="이미지 생성 설정(엔진·함수 주소·토큰·칸 크기·품질·화풍)">
                  <Icon name="settings" />
                </button>
              </span>
              <span />
            </div>
            {targets.length > 0 && !single && (
              <details open>
                <summary className="small">
                  묶음 태그 <span className="muted">같은 태그끼리 묶임(첫 태그 기준) · 비우면 순서대로</span>
                </summary>
                <div className="gen-tags">
                  {targets.map((c) => (
                    <label key={c.number}>
                      <span className="muted">{pad3(c.number)}</span>
                      <input
                        type="text"
                        defaultValue={(c.groupTags ?? []).join(', ')}
                        placeholder="태그"
                        spellCheck={false}
                        onBlur={(e) =>
                          setCutGroupTags(
                            c.number,
                            e.target.value
                              .split(/[,，]/)
                              .map((t) => t.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            )}
            <div className="muted small">묶음 준비는 네트워크 없이 돌 렌더를 격자 한 장으로 합성하고 프롬프트를 씁니다. 보내기 전에 프롬프트를 확인·수정할 수 있습니다.</div>
            <div className="actions">
              <button onClick={close}>닫기</button>
              <button className="primary" onClick={() => void prepare(targets, single)} disabled={!targets.length || remoteUnset}>
                {targets.length ? `묶음 준비 (${targets.length}컷)` : '대상 컷 없음'}
              </button>
            </div>
          </>
        )}

        {tab === 'generate' && (phase === 'preparing' || phase === 'running') && progress && (
          <>
            <div className="progress">
              <div className="bar">
                <div className="fill" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
              <div className="small muted">
                {phase === 'preparing' ? '준비' : '생성'} {progress.done}/{progress.total} {progress.current}
              </div>
            </div>
            {phase === 'running' && outcomes.length > 0 && (
              <div className="small">
                {outcomes.map((o) => (
                  <div key={o.batchId}>
                    컷 {o.cuts.map(pad3).join('·')}: {o.ok ? <span className="gen-status ok">완료</span> : <span className="gen-status fail">{GEN_ERROR_LABEL[o.errorKind ?? 'request']}</span>} {o.error && <span className="muted">{o.error}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="actions">
              <button onClick={cancel}>취소</button>
            </div>
          </>
        )}

        {tab === 'generate' && phase === 'review' && (
          <>
            <div className="small">
              {batches.length}묶음 · 첨부 {attachCount}장 · {gen.label}
              {settings.genEngine === 'remote' && <span className="muted"> · {settings.genEndpoint}</span>}
            </div>
            <div className="gen-batches">
              {batches.map((b, i) => (
                <div key={b.id} className="gen-batch">
                  <div className="meta">
                    <img className="grid-thumb" src={b.gridUrl} alt="" />
                    <div>
                      <b>묶음 {i + 1}</b> {b.key ? <span className="muted">· {b.key}</span> : null}
                    </div>
                    <div>컷 {b.cuts.map((c) => pad3(c.number)).join('·')}</div>
                    <div className="muted">
                      {b.layout.cols}×{b.layout.rows} 격자 · {totalWidth(b)}px
                    </div>
                    <div className="muted">첨부 {b.images.length}장: {b.images.map((im) => im.role === 'grid' ? '격자' : im.role === 'line' ? '선화' : im.role === 'mask' ? '마스크' : '레퍼런스').filter((v, k, a) => a.indexOf(v) === k).join('·')}</div>
                    {b.warnings.map((w) => (
                      <div key={w} className="gen-warn">
                        ⚠ {w}
                      </div>
                    ))}
                    <button onClick={() => dropBatch(b.id)} title="이 묶음은 보내지 않음">
                      빼기
                    </button>
                  </div>
                  <textarea value={b.prompt} spellCheck={false} onChange={(e) => setPrompt(b.id, e.target.value)} title="보낼 프롬프트. 고치면 그대로 전송됩니다" />
                </div>
              ))}
            </div>
            <div className="actions">
              <button onClick={resetWork}>← 설정</button>
              <button className="primary" onClick={() => void run()} disabled={!batches.length}>
                보내기 ({batches.length}묶음 × {settings.genCandidates}장)
              </button>
            </div>
          </>
        )}

        {tab === 'generate' && phase === 'done' && (
          <>
            <div className="small">
              완료: 묶음 {outcomes.filter((o) => o.ok).length}/{outcomes.length} 성공 · 새 후보 {[...lastOk.values()].reduce((a, b) => a + b, 0)}장 → <code>{folder}</code>
              {lastFailed.size ? <span style={{ color: 'var(--danger)' }}> · 실패 컷 {lastFailed.size}</span> : null}
            </div>
            {outcomes.some((o) => o.resultUrls.length) && (
              <details open>
                <summary className="small">결과 격자(자르기 전)</summary>
                <div className="gen-results">
                  {outcomes.flatMap((o) => o.resultUrls.map((u, k) => (
                    <a key={`${o.batchId}-${k}`} href={u} target="_blank" rel="noreferrer" title={`컷 ${o.cuts.map(pad3).join('·')} · 후보 ${k + 1}`}>
                      <img src={u} alt="" />
                    </a>
                  )))}
                </div>
              </details>
            )}
            <div className="actions">
              <button onClick={resetWork}>다시 설정</button>
              <button className="primary" onClick={() => setTab('candidates')}>
                후보 비교 →
              </button>
            </div>
          </>
        )}

        {tab === 'candidates' && (
          <>
            {lastFailed.size > 0 && (
              <div className="gen-row small">
                <span style={{ color: 'var(--danger)' }}>실패 컷 {lastFailed.size}개</span>
                <button onClick={() => void prepare(failedCuts, true)} disabled={busy} title="실패한 컷을 하나씩 따로 생성">
                  <Icon name="rotate" /> 단독 재생성
                </button>
                <button onClick={() => void prepare(failedCuts, false)} disabled={busy} title="실패한 컷만 다시 묶어 생성">
                  <Icon name="rotate" /> 재묶음 재생성
                </button>
                <button onClick={() => setLastFailed(new Map())} title="실패 표시 지우기">
                  표시 지움
                </button>
              </div>
            )}
            {!confirmed.length && <div className="muted">확정된 컷이 없습니다. 컷 확정(Ctrl+Enter) 뒤에 생성하세요.</div>}
            <div className="cand-rows">
              {confirmed.map((c) => {
                const list = c.generatedImages ?? [];
                const fail = lastFailed.get(c.number);
                const ok = lastOk.get(c.number);
                return (
                  <div key={c.number} className={`cand-row ${fail ? 'failed' : ''}`}>
                    <div className="cut-thumb" title={`컷 ${pad3(c.number)} 돌 렌더`}>
                      {thumbnails[c.number] ? <img src={thumbnails[c.number]} alt="" /> : <span className="small muted">{pad3(c.number)}</span>}
                    </div>
                    <div className="cand-main">
                      <div className="gen-row small">
                        <b>{pad3(c.number)}</b>
                        {c.groupTags?.length ? <span className="muted">{c.groupTags.join(', ')}</span> : null}
                        <span className="muted">후보 {list.length}장</span>
                        {fail && <span className="gen-status fail" title={fail}>실패 · {fail.length > 60 ? fail.slice(0, 60) + '…' : fail}</span>}
                        {ok && <span className="gen-status ok">새 후보 {ok}장</span>}
                      </div>
                      <div className="cand-list">
                        {list.map((p, i) => (
                          <Candidate key={p} path={p} main={i === 0} onMain={() => { setGeneratedMain(c.number, p); void saveNow(); }} onDelete={() => void deleteCandidate(c, p)} />
                        ))}
                        {!list.length && <span className="small muted">아직 후보가 없습니다</span>}
                      </div>
                    </div>
                    <button onClick={() => void prepare([c], true)} disabled={busy} title="이 컷만 단독으로 생성(프롬프트 확인 뒤 보내기)">
                      <Icon name="sparkles" size={14} /> 단독
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="actions">
              <button onClick={() => setTab('generate')}>← 묶음 생성</button>
              <button className="primary" onClick={close}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
