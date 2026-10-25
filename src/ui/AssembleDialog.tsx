import { useEffect, useMemo, useRef, useState } from 'react';
import { exportCutImages, type AssembleExportResult } from '../assemble/exporter';
import { loadSource, releaseSource, type LoadedSource } from '../assemble/images';
import { planExport, SOURCE_LABEL } from '../assemble/plan';
import { useStore } from '../state/store';
import { Icon } from './icons';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 6단계 원고 내보내기: 컷마다 고른 그림(대표 후보)을 NTT에 올릴 컷 그림으로 내보낸다.
 * 대사·장면 설명·컷 칸새·CLIP 파일은 NTT 글콘티의 CLIP 내보내기가 만든다(여기서는 그림만).
 */
export function AssembleDialog() {
  const open = useStore((s) => s.assembleOpen);
  const setOpen = useStore((s) => s.setAssembleOpen);
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const cuts = useStore((s) => s.cuts);
  const thumbnails = useStore((s) => s.thumbnails);

  const [sources, setSources] = useState<Record<number, LoadedSource>>({});
  const ref = useRef<Record<number, LoadedSource>>({});
  const [loading, setLoading] = useState(false);
  const [skip, setSkip] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<AssembleExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sig = cuts.map((c) => `${c.number}:${c.generatedImages?.[0] ?? ''}:${thumbnails[c.number] ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!open) return;
    let dead = false;
    setLoading(true);
    (async () => {
      const next: Record<number, LoadedSource> = {};
      for (const c of cuts) {
        const prev = ref.current[c.number];
        const want = c.generatedImages?.[0];
        if (prev && prev.kind === 'generated' && prev.key === want) next[c.number] = prev;
        else {
          releaseSource(prev);
          next[c.number] = await loadSource(c, work.code, episode.number, thumbnails);
        }
        if (dead) return;
      }
      ref.current = next;
      setSources(next);
      setLoading(false);
    })().catch((e) => {
      setError(message(e));
      setLoading(false);
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig, work.code, episode.number]);

  useEffect(() => {
    if (open) return;
    for (const s of Object.values(ref.current)) releaseSource(s);
    ref.current = {};
    setSources({});
    setResult(null);
    setError(null);
  }, [open]);

  const plan = useMemo(() => planExport(cuts, Object.fromEntries(Object.entries(sources).map(([n, s]) => [Number(n), s.kind])), skip), [cuts, sources, skip]);

  if (!open) return null;
  const close = () => !busy && setOpen(false);

  const doExport = async () => {
    setBusy('준비 중…');
    setError(null);
    setResult(null);
    try {
      setResult(await exportCutImages(work, episode, plan, sources, setBusy));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide asm" onClick={(e) => e.stopPropagation()}>
        <h2>
          <Icon name="layers" /> 원고 내보내기 <span className="muted small">{work.code} {episode.number}화 · 컷 그림 {plan.items.length}/{cuts.length}장</span>
          <span className="grow" />
          <button className="icon close-x" onClick={close} title="닫기">
            <Icon name="close" />
          </button>
        </h2>
        <div className="small muted">
          컷마다 고른 대표 후보를 <code>출력/{work.code}/{String(episode.number).padStart(3, '0')}/원고/{work.code}_{String(episode.number).padStart(3, '0')}_컷번호.png</code>로 내보냅니다. 대사·장면 설명·컷 위치가 든 CLIP 파일은 NTT 글콘티의 [내보내기 → CLIP]에서 이 그림들을 올려 만듭니다(파일 이름 끝 숫자 = NTT 컷 번호).
        </div>
        {loading && <div className="muted small">컷 그림을 읽는 중…</div>}
        <div className="asm-grid2">
          {cuts.map((c) => {
            const src = sources[c.number];
            const skipped = skip.includes(c.number);
            return (
              <label key={c.number} className={`asm-card ${skipped || !src || src.kind === 'none' ? 'off' : ''}`}>
                <div className="asm-thumb">{src?.url ? <img src={src.url} alt="" /> : <span className="muted small">{src ? '그림 없음' : '…'}</span>}</div>
                <div className="small">
                  <input type="checkbox" checked={!skipped && !!src && src.kind !== 'none'} disabled={!src || src.kind === 'none'} onChange={() => setSkip((s) => (s.includes(c.number) ? s.filter((x) => x !== c.number) : [...s, c.number]))} /> 컷 {c.number}
                  <span className={`asm-kind ${src?.kind ?? ''}`}>{src ? SOURCE_LABEL[src.kind] : ''}</span>
                </div>
              </label>
            );
          })}
        </div>
        {plan.warnings.length > 0 && (
          <div className="asm-warn small">
            {plan.warnings.map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
          </div>
        )}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        {result && (
          <div className="asm-result small">
            <b>내보냈습니다</b> → <code>{result.folder}/</code> · {result.files.length}장. 이 폴더의 PNG를 모두 골라 NTT 글콘티 [내보내기 → CLIP] 창의 '컷 그림 넣기'에 올리세요.
          </div>
        )}
        <div className="actions">
          <button className="primary" disabled={!!busy || loading || !plan.items.length} onClick={() => void doExport()}>
            <Icon name="export" /> {busy ?? '컷 그림 내보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
