import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { DETAIL_ORDER, DETAILS, PRESET_ORDER, PRESETS } from '../generate/batch';
import { availableOnWeb, keyState, maxImagesFor, selectedApi } from '../generate/apiList';
import { currentApi, engineFor, formatUsage, GEN_ERROR_LABEL } from '../generate/engine';
import { normalizeApiList } from '../generate/apiList';
import { useKeyStatus } from '../generate/keyStatus';
import { estimateRemaining, estimateTotal, loadTimeHistory, perBatchSeconds, recordDuration, roughDuration, saveTimeHistory } from '../generate/timeEstimate';
import { isDesktop } from '../native';
import { disposeBatches, disposeOutcomes, prepareBatches, runBatches, type BatchOutcome, type PreparedBatch, type Progress } from '../generate/runner';
import type { Cut } from '../model/types';
import type { GenDetail, GenGridRef, GenPreset, GenSizeMode } from '../state/settings';
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
function Candidate({ path, main, onMain, onDelete, onZoom }: { path: string; main: boolean; onMain: () => void; onDelete: () => void; onZoom: (url: string, path: string) => void }) {
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
          <button className="icon" onClick={() => onZoom(url, path)} title="크게 보기(이 그림을 만든 프롬프트도 함께)">
            <Icon name="external" size={12} />
          </button>
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
const WIN_POS_KEY = 'scene-doll.generateWin.pos';

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
  // 떠 있는 창: 제목줄로 옮기고, 접어 둘 수 있다. 바깥(조작뷰)을 눌러도 닫히거나 생성이 취소되지 않는다
  const [winPos, setWinPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(WIN_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
      }
    } catch {
      /* 저장 불가 환경 */
    }
    return { x: Math.max(16, Math.round((window.innerWidth - 760) / 2)), y: 48 };
  });
  const winDrag = useRef<{ dx: number; dy: number } | null>(null);
  const [mini, setMini] = useState(false);
  const [single, setSingle] = useState(false);
  // 크게 보기: 새 탭(blob 주소)은 브라우저가 about:blank#blocked로 막는 일이 있어 앱 안 덮개로 연다
  const [zoom, setZoom] = useState<{ url: string; prompt?: string; title?: string } | null>(null);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setZoom(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoom]);
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
  // 예상 시간: 묶음 하나가 걸린 시간을 API 항목별로 기억해 다음 예상에 쓴다
  const [timeHistory, setTimeHistory] = useState(loadTimeHistory);
  const [now, setNow] = useState(() => Date.now());
  const batchStartRef = useRef(Date.now());

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
  const api = currentApi(settings);
  // 수위 거부 때 자동으로 다시 보낼 대체 모델(고르지 않았거나 지금 모델과 같으면 없음)
  const fallbackApi = useMemo(() => {
    if (!settings.genFallbackApiId || settings.genFallbackApiId === api.id) return null;
    const list = normalizeApiList(settings.genApis);
    return list.some((e) => e.id === settings.genFallbackApiId) ? selectedApi(list, settings.genFallbackApiId) : null;
  }, [settings.genFallbackApiId, settings.genApis, api.id]);
  const fallback = useMemo(() => (fallbackApi ? { gen: engineFor({ ...settings, genApiId: fallbackApi.id }), maxImages: maxImagesFor(fallbackApi), label: fallbackApi.label } : undefined), [fallbackApi, settings]);
  const keyIds = useKeyStatus((k) => k.ids);
  const per = useMemo(() => perBatchSeconds(timeHistory, api), [timeHistory, api]);
  // 생성 중에는 1초마다 남은 시간을 다시 계산하고, 묶음이 하나 끝나면 그 묶음의 시작 시각을 새로 잡는다
  useEffect(() => {
    if (phase !== 'running') return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [phase]);
  const doneBatches = progress?.done ?? 0;
  useEffect(() => {
    batchStartRef.current = Date.now();
  }, [doneBatches]);
  useEffect(() => {
    if (isDesktop) void useKeyStatus.getState().refresh();
  }, []);
  // 설정이 모자라면 생성 버튼을 막고 안내한다: 데스크톱은 키, 웹은 함수 주소, 웹에서 쓸 수 없는 항목
  const setupProblem: string | null =
    api.service === 'mock' ? null : isDesktop ? (keyState(api, keyIds) === 'missing' ? `${api.label}의 API 키가 없습니다.` : null) : !availableOnWeb(api.service) ? `${api.label}은(는) 설치형 프로그램에서만 쓸 수 있습니다.` : !settings.genEndpoint.trim() ? '함수 주소(엔드포인트)가 없습니다.' : null;
  const remoteUnset = setupProblem !== null;
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
      const prepared = await prepareBatches(engine, { cuts: list, single: asSingle, settings, maxImages: maxImagesFor(api) }, setProgress, ac.signal);
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
    batchStartRef.current = Date.now();
    setProgress({ done: 0, total: batches.length, current: '' });
    const results = await runBatches(gen, batches, {
      n: settings.genCandidates,
      quality: settings.genQuality,
      signal: ac.signal,
      onProgress: setProgress,
      fallback,
      onBatch: (o) => {
        if (o.ok && o.seconds) {
          const next = recordDuration(loadTimeHistory(), api.id, o.seconds);
          saveTimeHistory(next);
          setTimeHistory(next);
        }
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
    <div className="hand-win-layer">
      <div className={`modal wide gen gen-float${mini ? ' mini' : ''}`} style={{ left: winPos.x, top: winPos.y }}>
        <h2
          className="hand-win-bar"
          title="제목줄을 끌어 창을 옮깁니다. 생성 중에도 뒤의 조작뷰를 만질 수 있습니다"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            winDrag.current = { dx: e.clientX - winPos.x, dy: e.clientY - winPos.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = winDrag.current;
            if (!d) return;
            setWinPos({ x: Math.min(window.innerWidth - 120, Math.max(-600, e.clientX - d.dx)), y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - d.dy)) });
          }}
          onPointerUp={() => {
            if (!winDrag.current) return;
            winDrag.current = null;
            try {
              localStorage.setItem(WIN_POS_KEY, JSON.stringify(winPos));
            } catch {
              /* 저장 불가 환경 */
            }
          }}
        >
          <Icon name="sparkles" /> 이미지 생성 <span className="muted small">{gen.label} · 생성/{work.code}/{pad3(episode.number)}/</span>
          {mini && (phase === 'preparing' || phase === 'running') && progress && (
            <span className="small">
              {progress.done}/{progress.total}
            </span>
          )}
          <span className="grow" />
          <button className="icon ghost" onClick={() => setMini(!mini)} title={mini ? '창 펼치기' : '창 접기(생성은 계속됩니다)'}>
            <Icon name={mini ? 'plus' : 'minus'} />
          </button>
          <button className="icon close-x" onClick={close} title={busy ? '닫기(생성 중이면 취소됩니다)' : '닫기'}>
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
            <div className="small muted">
              {fallbackApi ? `수위 거부 시 자동 재호출: ${fallbackApi.label}` : '수위 거부 시 자동 재호출 모델 없음 — 설정 > 이미지 생성에서 "수위 대체"를 고르면 거부된 묶음이 그 모델로 자동 재호출됩니다'}
              {fallbackApi && isDesktop && keyState(fallbackApi, keyIds) === 'missing' && <span style={{ color: 'var(--danger)' }}> (키 없음)</span>}
            </div>
            {remoteUnset && (
              <div className="small" style={{ color: 'var(--danger)' }}>
                {setupProblem}{' '}
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
              <span>투시 격자(AI 참조)</span>
              <span className="gen-row">
                <Segmented value={settings.genGridRef} options={['off', 'floor', 'both'] as const} onChange={(v: GenGridRef) => update({ genGridRef: v })} labels={{ off: '끔', floor: '바닥', both: '바닥+벽' }} />
                <span className="small muted">앵글·쇼트를 읽게 첨부 렌더에 옅은 격자를 넣음(그림에는 그리지 않게 지시)</span>
              </span>
              <span />
            </div>
            <div className="setting">
              <span>그림 디테일</span>
              <span className="gen-row">
                <Segmented value={settings.genDetail} options={DETAIL_ORDER} onChange={(v: GenDetail) => update({ genDetail: v })} labels={{ normal: DETAILS.normal.label, simple: DETAILS.simple.label, lineart: DETAILS.lineart.label }} />
                <span className="small muted">{DETAILS[settings.genDetail].short}</span>
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
                {phase === 'running' && progress.total > 0 && <span> · 남은 시간 {roughDuration(estimateRemaining(per, progress.total, progress.done, (now - batchStartRef.current) / 1000))}</span>}
              </div>
            </div>
            {phase === 'running' && outcomes.length > 0 && (
              <div className="small">
                {outcomes.map((o) => (
                  <div key={o.batchId}>
                    컷 {o.cuts.map(pad3).join('·')}: {o.ok ? <span className="gen-status ok">완료</span> : <span className="gen-status fail">{GEN_ERROR_LABEL[o.errorKind ?? 'request']}</span>} {o.error && <span className="muted">{o.error}</span>}
                    {o.ok && <span className="muted"> {[o.viaFallback ? `수위 거부 → ${o.viaFallback}` : null, o.model, formatUsage(o.usage), o.boundary].filter(Boolean).join(' · ')}</span>}
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
              {batches.length > 0 && (
                <span title={per.basis === 'history' ? `이 항목으로 생성한 최근 ${per.samples}번의 묶음당 시간(중앙값 ${Math.round(per.seconds)}초)으로 계산했습니다` : '아직 이 항목으로 생성한 기록이 없어 서비스별 대략값(묶음당 ' + Math.round(per.seconds) + '초)으로 계산했습니다. 한 번 생성하면 실제 시간으로 바뀝니다'}>
                  {' · '}예상 {roughDuration(estimateTotal(per, batches.length))}
                  <span className="muted">{per.basis === 'history' ? ` (최근 ${per.samples}회 기준)` : ' (처음이라 대략)'}</span>
                </span>
              )}
              {!isDesktop && api.service !== 'mock' && <span className="muted"> · {settings.genEndpoint}</span>}
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
            {outcomes.some((o) => o.usage || o.boundary || o.error) && (
              <div className="small muted">
                {outcomes.map((o) => (
                  <div key={o.batchId}>
                    컷 {o.cuts.map(pad3).join('·')}: {o.ok ? [o.viaFallback ? `수위 거부 → ${o.viaFallback}` : null, o.model, formatUsage(o.usage), o.boundary].filter(Boolean).join(' · ') || '완료' : `${GEN_ERROR_LABEL[o.errorKind ?? 'request']}${o.error ? `: ${o.error}` : ''}`}
                  </div>
                ))}
              </div>
            )}
            {outcomes.some((o) => o.resultUrls.length) && (
              <details open>
                <summary className="small">결과 격자(자르기 전)</summary>
                <div className="gen-results">
                  {outcomes.flatMap((o) => o.resultUrls.map((u, k) => (
                    <img key={`${o.batchId}-${k}`} src={u} alt="" style={{ cursor: 'zoom-in' }} onClick={() => setZoom({ url: u, prompt: batches.find((x) => x.id === o.batchId)?.prompt, title: `컷 ${o.cuts.map(pad3).join('·')} · 후보 ${k + 1}` })} title={`컷 ${o.cuts.map(pad3).join('·')} · 후보 ${k + 1} · 클릭하면 크게`} />
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
                          <Candidate key={p} path={p} main={i === 0} onMain={() => { setGeneratedMain(c.number, p); void saveNow(); }} onDelete={() => void deleteCandidate(c, p)} onZoom={(url, path) => setZoom({ url, prompt: c.generatedPrompts?.[path], title: `컷 ${pad3(c.number)} · ${path.split('/').pop()}` })} />
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
      {zoom && (
        <div
          className="gen-zoom"
          onClick={(e) => {
            // 백드롭의 닫기로 번지지 않게: 미리보기만 닫는다
            e.stopPropagation();
            setZoom(null);
          }}
          title="누르면 닫힘"
        >
          <img src={zoom.url} alt="" />
          <div className="gen-zoom-prompt" onClick={(e) => e.stopPropagation()}>
            <div className="gen-zoom-head">
              <b>프롬프트</b> <span className="muted small">{zoom.title}</span>
              {zoom.prompt && (
                <button className="icon" onClick={() => void navigator.clipboard?.writeText(zoom.prompt ?? '')} title="프롬프트 복사">
                  <Icon name="copy" size={12} />
                </button>
              )}
            </div>
            <pre>{zoom.prompt ?? '이 그림의 프롬프트 기록이 없습니다(기록 기능 이전에 만든 그림)'}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
