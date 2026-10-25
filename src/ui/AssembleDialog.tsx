import { useEffect, useMemo, useRef, useState } from 'react';
import { hitTest, type Pt, type ResolvedBubble } from '../assemble/bubbles';
import { exportAssembly, type AssembleExportResult } from '../assemble/exporter';
import { infoOf, loadSource, type LoadedSource } from '../assemble/images';
import { normalizeAssembly, type AssemblySettings, type BubbleOverride, type BubbleShape } from '../assemble/model';
import { buildPlan, SOURCE_LABEL, type PlanItem } from '../assemble/plan';
import { canvasMeasure, drawCut, drawSelection } from '../assemble/render';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { saveNow } from './save';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WIDTH_PRESETS = [690, 720, 800, 1000];

/** 숫자 칸: 입력 중에는 그대로 두고 Enter·포커스 아웃에서 확정(범위 밖은 normalize가 고친다) */
function NumField({ value, onCommit, step = 1, width = 70 }: { value: number; onCommit: (v: number) => void; step?: number; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && text.trim() !== '') onCommit(n);
    else setText(String(value));
  };
  return <input type="number" value={text} step={step} style={{ width }} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

/** 컷 하나의 미리보기: 내보내기와 같은 drawCut으로 그리고, 위에서 말풍선을 끌어 옮긴다 */
function CutCanvas({ item, img, width, family, selectedKey, onSelect, onDrag }: { item: PlanItem; img: ImageBitmap | null; width: number; family: string; selectedKey: string | null; onSelect: (key: string | null) => void; onDrag: (b: ResolvedBubble, part: 'body' | 'tip' | 'width', p: Pt, start: { p: Pt; b: ResolvedBubble }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ key: string; part: 'body' | 'tip' | 'width'; start: Pt; b: ResolvedBubble } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawCut(ctx, { ...item, y: 0 }, img, width, family);
    const sel = item.bubbles.find((b) => b.key === selectedKey && !b.hidden);
    if (sel) drawSelection(ctx, sel, width);
  }, [item, img, width, family, selectedKey]);

  const point = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * width) / r.width, y: ((e.clientY - r.top) * item.height) / r.height };
  };
  const handleR = Math.max(10, width * 0.015);

  return (
    <canvas
      ref={ref}
      className="asm-cut"
      width={width}
      height={item.height}
      onPointerDown={(e) => {
        const p = point(e);
        const hit = hitTest(item.bubbles, p, handleR);
        if (!hit) return onSelect(null);
        // 고른 말풍선의 손잡이가 아니면 몸통으로 취급(손잡이는 고른 뒤에만 보인다)
        const part = hit.part !== 'body' && hit.key !== selectedKey ? 'body' : hit.part;
        const b = item.bubbles.find((x) => x.key === hit.key)!;
        onSelect(hit.key);
        drag.current = { key: hit.key, part, start: p, b };
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        onDrag(d.b, d.part, point(e), { p: d.start, b: d.b });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}

export function AssembleDialog() {
  const open = useStore((s) => s.assembleOpen);
  const setOpen = useStore((s) => s.setAssembleOpen);
  const work = useStore((s) => s.work);
  const episode = useStore((s) => s.episode);
  const cuts = useStore((s) => s.cuts);
  const thumbnails = useStore((s) => s.thumbnails);
  const readOnly = useStore((s) => s.readOnly);
  const updateAssembly = useStore((s) => s.updateAssembly);

  const assembly = useMemo(() => normalizeAssembly(episode.assembly), [episode.assembly]);
  const st = assembly.settings;
  const [sources, setSources] = useState<Record<number, LoadedSource>>({});
  const sourcesRef = useRef<Record<number, LoadedSource>>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<AssembleExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 컷 그림 읽기: 대표 후보 경로가 바뀐 컷만 다시 읽는다
  const sig = cuts.map((c) => `${c.number}:${c.generatedImages?.[0] ?? ''}:${c.confirmed ? 1 : 0}:${thumbnails[c.number] ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!open) return;
    let dead = false;
    setLoading(true);
    (async () => {
      const next: Record<number, LoadedSource> = {};
      for (const c of cuts) {
        const prev = sourcesRef.current[c.number];
        const want = c.generatedImages?.[0];
        if (prev && ((prev.kind === 'generated' && prev.key === want) || (prev.kind !== 'generated' && !want && prev.kind !== 'none'))) next[c.number] = prev;
        else {
          prev?.bitmap?.close();
          next[c.number] = await loadSource(c, work.code, episode.number, thumbnails);
        }
        if (dead) return;
      }
      sourcesRef.current = next;
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
    for (const s of Object.values(sourcesRef.current)) s.bitmap?.close();
    sourcesRef.current = {};
    setSources({});
    setSelected(null);
    setResult(null);
    setError(null);
  }, [open]);

  const measure = useMemo(() => canvasMeasure(st.fontFamily), [st.fontFamily]);
  const plan = useMemo(() => {
    const infos = Object.fromEntries(Object.entries(sources).map(([n, s]) => [Number(n), infoOf(s)]));
    return buildPlan(cuts, infos, assembly, measure);
  }, [cuts, sources, assembly, measure]);

  if (!open) return null;

  const setSetting = <K extends keyof AssemblySettings>(k: K, v: AssemblySettings[K]) => updateAssembly((a) => ({ ...a, settings: { ...a.settings, [k]: v } }));
  const setOverride = (key: string, patch: BubbleOverride) => updateAssembly((a) => ({ ...a, bubbles: { ...a.bubbles, [key]: { ...a.bubbles[key], ...patch } } }));
  const clearOverride = (key: string) =>
    updateAssembly((a) => {
      const bubbles = { ...a.bubbles };
      delete bubbles[key];
      return { ...a, bubbles };
    });
  const toggleCut = (n: number) => updateAssembly((a) => ({ ...a, skip: a.skip.includes(n) ? a.skip.filter((x) => x !== n) : [...a.skip, n] }));

  const allBubbles = plan.items.flatMap((it) => it.bubbles.map((b) => ({ it, b })));
  const sel = allBubbles.find((x) => x.b.key === selected);
  const hidden = allBubbles.filter((x) => x.b.hidden);

  const drag = (item: PlanItem) => (b: ResolvedBubble, part: 'body' | 'tip' | 'width', p: Pt, start: { p: Pt; b: ResolvedBubble }) => {
    const W = st.width;
    const H = item.height;
    if (part === 'body') {
      const cx = start.b.rect.x + start.b.rect.w / 2 + (p.x - start.p.x);
      const cy = start.b.rect.y + start.b.rect.h / 2 + (p.y - start.p.y);
      // 꼬리 끝을 직접 놓은 적이 없으면 자동 꼬리가 몸통을 따라오고, 있으면 그 자리에 둔다
      setOverride(b.key, { cx: cx / W, cy: cy / H, w: start.b.rect.w / W });
    } else if (part === 'width') {
      const cx = start.b.rect.x + start.b.rect.w / 2;
      setOverride(b.key, { w: Math.min(1, Math.max(0.1, (2 * (p.x - cx)) / W)), cx: cx / W, cy: (start.b.rect.y + start.b.rect.h / 2) / H });
    } else {
      setOverride(b.key, { tail: { x: p.x / W, y: p.y / H } });
    }
  };

  const doExport = async () => {
    setBusy('준비 중…');
    setError(null);
    setResult(null);
    try {
      await saveNow();
      const images = Object.fromEntries(Object.entries(sources).map(([n, s]) => [Number(n), s.bitmap]));
      const r = await exportAssembly({ work, episode, plan, settings: st, images, onProgress: setBusy });
      setResult(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const close = () => !busy && setOpen(false);
  const withDialogue = cuts.reduce((n, c) => n + (c.dialogue?.length ?? 0), 0);

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide asm" onClick={(e) => e.stopPropagation()}>
        <h2>
          <Icon name="layers" /> 원고 조립 <span className="muted small">{work.code} {episode.number}화 · 컷 {plan.items.length}/{cuts.length} · {plan.layout.width}×{plan.layout.height}px · 슬라이스 {plan.slices.length}장</span>
          <span className="grow" />
          <button className="icon close-x" onClick={close} title="닫기">
            <Icon name="close" />
          </button>
        </h2>
        {readOnly && <div className="small" style={{ color: 'var(--danger)' }}>보기 전용 회차입니다. 말풍선·설정을 바꿔도 저장되지 않습니다(이 창에서도 반영되지 않음).</div>}
        <div className="asm-body">
          <div className="asm-preview">
            {loading && <div className="muted small">컷 그림을 읽는 중…</div>}
            {!loading && !plan.items.length && <div className="muted">조립할 컷이 없습니다. 컷을 확정하거나 5단계에서 후보를 만드세요.</div>}
            <div className="asm-strip" style={{ background: st.background, paddingTop: `${(st.margin / st.width) * 100}%`, paddingBottom: `${(st.margin / st.width) * 100}%` }}>
              {plan.items.map((it, i) => (
                <div key={it.number} className="asm-cutwrap" style={{ marginBottom: i < plan.items.length - 1 ? `${(st.gutter / st.width) * 100}%` : 0 }}>
                  <span className="asm-tag">{it.number}{it.kind !== 'generated' ? ` · ${SOURCE_LABEL[it.kind]}` : ''}</span>
                  <CutCanvas item={it} img={sources[it.number]?.bitmap ?? null} width={st.width} family={st.fontFamily} selectedKey={selected} onSelect={setSelected} onDrag={drag(it)} />
                </div>
              ))}
            </div>
          </div>
          <div className="asm-side">
            <h3>말풍선 {withDialogue ? `· 대사 ${withDialogue}개` : ''}</h3>
            {!withDialogue && <div className="muted small">대사가 없습니다. 원고뷰의 글콘티 칸이나 글콘티 가져오기로 대사를 넣으면 말풍선이 생깁니다.</div>}
            {sel ? (
              <div className="asm-sel">
                <div className="small muted">컷 {sel.it.number} · {sel.b.speaker || '화자 없음'} — 몸통을 끌면 이동, 파란 점은 폭, 빨간 점은 꼬리 끝</div>
                <textarea rows={3} value={sel.b.text} onChange={(e) => setOverride(sel.b.key, { text: e.target.value })} />
                <div className="gen-row">
                  <span className="segmented">
                    {(['ellipse', 'round'] as BubbleShape[]).map((sh) => (
                      <button key={sh} className={sel.b.shape === sh ? 'active' : ''} onClick={() => setOverride(sel.b.key, { shape: sh })}>
                        {sh === 'ellipse' ? '타원' : '둥근 사각형'}
                      </button>
                    ))}
                  </span>
                  <button onClick={() => setOverride(sel.b.key, { tail: null })} title="꼬리 없이 그립니다">꼬리 없음</button>
                  <button onClick={() => updateAssembly((a) => { const o = { ...a.bubbles[sel.b.key] }; delete o.tail; return { ...a, bubbles: { ...a.bubbles, [sel.b.key]: o } }; })} title="꼬리를 기본(컷 안쪽 향함)으로">꼬리 자동</button>
                  <button onClick={() => { setOverride(sel.b.key, { hidden: true }); setSelected(null); }}>숨기기</button>
                  <button onClick={() => clearOverride(sel.b.key)} disabled={!sel.b.edited} title="위치·글·모양을 대사 기본값으로 되돌립니다">되돌리기</button>
                </div>
              </div>
            ) : (
              withDialogue > 0 && <div className="muted small">미리보기의 말풍선을 눌러 고르세요.</div>
            )}
            {hidden.length > 0 && (
              <div className="small">
                숨김:{' '}
                {hidden.map((x) => (
                  <button key={x.b.key} className="mini" onClick={() => setOverride(x.b.key, { hidden: false })} title="다시 보이기">
                    {x.it.number}-{x.b.index + 1} {x.b.text.slice(0, 6)}
                  </button>
                ))}
              </div>
            )}

            <h3>스트립</h3>
            <div className="asm-grid">
              <span>폭(px)</span>
              <span className="gen-row">
                <NumField value={st.width} onCommit={(v) => setSetting('width', v)} step={10} />
                {WIDTH_PRESETS.map((w) => (
                  <button key={w} className={`mini ${st.width === w ? 'active' : ''}`} onClick={() => setSetting('width', w)}>{w}</button>
                ))}
              </span>
              <span>컷 사이 간격</span>
              <NumField value={st.gutter} onCommit={(v) => setSetting('gutter', v)} step={10} />
              <span>위·아래 여백</span>
              <NumField value={st.margin} onCommit={(v) => setSetting('margin', v)} step={10} />
              <span>슬라이스 높이(최대)</span>
              <NumField value={st.sliceMax} onCommit={(v) => setSetting('sliceMax', v)} step={10} />
              <span>배경색</span>
              <input type="color" value={st.background} onChange={(e) => setSetting('background', e.target.value)} />
            </div>
            <h3>말풍선 기본값</h3>
            <div className="asm-grid">
              <span>모양</span>
              <span className="segmented">
                {(['ellipse', 'round'] as BubbleShape[]).map((sh) => (
                  <button key={sh} className={st.shape === sh ? 'active' : ''} onClick={() => setSetting('shape', sh)}>
                    {sh === 'ellipse' ? '타원' : '둥근 사각형'}
                  </button>
                ))}
              </span>
              <span>꼬리</span>
              <label><input type="checkbox" checked={st.tail} onChange={(e) => setSetting('tail', e.target.checked)} /> 기본으로 그림</label>
              <span>글자 크기 배율</span>
              <NumField value={st.fontScale} onCommit={(v) => setSetting('fontScale', v)} step={0.1} />
              <span>글꼴(화면·PNG)</span>
              <input value={st.fontFamily} onChange={(e) => setSetting('fontFamily', e.target.value)} />
              <span>글꼴(PSD 글 레이어)</span>
              <input value={st.psdFont} onChange={(e) => setSetting('psdFont', e.target.value)} title="PostScript 이름. 맑은 고딕 = MalgunGothic" />
            </div>

            <h3>컷</h3>
            <div className="asm-cuts">
              {cuts.map((c) => {
                const src = sources[c.number];
                const skipped = assembly.skip.includes(c.number);
                const inPlan = plan.items.some((i) => i.number === c.number);
                return (
                  <label key={c.number} className={skipped ? 'muted' : ''} title={src ? `${SOURCE_LABEL[src.kind]}${src.kind === 'generated' ? ` · ${c.generatedImages?.length ?? 0}장 중 대표` : ''}` : ''}>
                    <input type="checkbox" checked={!skipped} onChange={() => toggleCut(c.number)} /> {c.number}
                    <span className={`asm-kind ${src?.kind ?? ''} ${!inPlan && !skipped ? 'out' : ''}`}>{skipped ? '뺌' : !inPlan ? '없음' : src ? SOURCE_LABEL[src.kind] : '…'}</span>
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
                <div>
                  <b>내보냈습니다</b> → <code>{result.folder}/</code>
                </div>
                <div>전체 PNG 1장 · 슬라이스 {result.sliceFiles.length}장{result.psdFile ? ` · PSD(${result.psdFile})` : ''}</div>
                {result.psdNote && <div style={{ color: 'var(--danger)' }}>{result.psdNote}</div>}
              </div>
            )}
            <div className="actions">
              <button className="primary" disabled={!!busy || loading || !plan.items.length} onClick={() => void doExport()} title="출력/작품코드/회차/원고/ 에 전체 PNG · 슬라이스 PNG · 레이어 PSD를 씁니다(공유 저장소에는 올리지 않음)">
                <Icon name="export" /> {busy ?? '내보내기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
