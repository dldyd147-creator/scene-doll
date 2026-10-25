import { useEffect, useMemo, useRef, useState } from 'react';
import { exportCutImages, type AssembleExportResult } from '../assemble/exporter';
import { loadSource, releaseSource, type LoadedSource } from '../assemble/images';
import { buildMeta, clipCuts, makeClip } from '../assemble/ntt';
import { pngName } from '../describe/text';
import { storage } from '../storage';
import { logAction } from '../storage/remote/service';
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
  const settings = useStore((s) => s.settings);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const [sources, setSources] = useState<Record<number, LoadedSource>>({});
  const ref = useRef<Record<number, LoadedSource>>({});
  const [loading, setLoading] = useState(false);
  const [skip, setSkip] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<AssembleExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clipNote, setClipNote] = useState<string | null>(null);

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
    setClipNote(null);
    setError(null);
  }, [open]);

  const plan = useMemo(() => planExport(cuts, Object.fromEntries(Object.entries(sources).map(([n, s]) => [Number(n), s.kind])), skip), [cuts, sources, skip]);

  if (!open) return null;
  const close = () => !busy && setOpen(false);

  const nttReady = settings.nttUrl.trim() !== '' && settings.nttToken.trim() !== '';

  /** NTT 서버로 컷 그림 + 대사를 보내 CLIP 콘티(zip)를 받아 출력 폴더에 두고 내려받는다 */
  const doClip = async () => {
    setBusy('준비 중…');
    setError(null);
    setClipNote(null);
    try {
      const kinds = Object.fromEntries(Object.entries(sources).map(([n, src]) => [Number(n), src.kind]));
      const list = clipCuts(cuts, kinds, skip);
      if (!list.length) throw new Error('보낼 컷이 없습니다');
      const images = list.flatMap((c) => {
        const blob = sources[c.number]?.blob;
        return blob ? [{ name: pngName(work.code, episode.number, c.number), blob }] : [];
      });
      const zip = await makeClip({ url: settings.nttUrl, token: settings.nttToken, meta: buildMeta(work, episode, list), images, onProgress: setBusy });
      const name = work.code + '_' + String(episode.number).padStart(3, '0') + '_콘티.zip';
      await storage.repository.writeOutput(work.code, episode.number, '원고/' + name, zip);
      const url = URL.createObjectURL(zip);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      logAction('assemble', episode.number + '화 CLIP 콘티 ' + list.length + '컷', { images: images.length }, work.code);
      setClipNote('CLIP 콘티를 받았습니다 → 출력/' + work.code + '/' + String(episode.number).padStart(3, '0') + '/원고/' + name + ' (' + list.length + '컷, 그림 ' + images.length + '장). 압축을 풀어 .clip을 클립 스튜디오로 여세요.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

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
          컷마다 고른 대표 후보와 글콘티 대사를 NTT 서버로 보내 클립 스튜디오 콘티(.clip)를 받습니다. 그림은 컷 칸 안에 놓이고 대사는 NTT의 말풍선 규칙으로 텍스트 레이어가 됩니다. [컷 그림만]은 PNG만 <code>출력/…/원고/</code>에 내보냅니다.
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
        {clipNote && <div className="asm-result small">{clipNote}</div>}
        {!nttReady && (
          <div className="small muted">
            CLIP 콘티를 바로 받으려면 설정에 NTT 서버 주소와 연동 토큰을 넣으세요. <button onClick={() => setSettingsOpen(true)}>설정 열기</button>
          </div>
        )}
        <div className="actions">
          <button className="primary" disabled={!!busy || loading || !nttReady || !cuts.length} onClick={() => void doClip()} title="컷 그림과 대사를 NTT 서버로 보내 클립 스튜디오 콘티(.clip)를 만들어 받습니다">
            <Icon name="export" /> {busy ?? 'CLIP 콘티 받기'}
          </button>
          <button disabled={!!busy || loading || !plan.items.length} onClick={() => void doExport()} title="컷 그림만 PNG로 내보냅니다">
            <Icon name="export" /> 컷 그림만
          </button>
        </div>
      </div>
    </div>
  );
}
