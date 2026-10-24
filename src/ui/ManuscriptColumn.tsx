import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';

const FOCALS = [24, 28, 35, 50, 85, 135];

/** 원고뷰 + 카메라 패널. 돌 조작은 못 하고 보기·카메라·컷 확정만 한다 */
export function ManuscriptColumn({ engine }: { engine: Engine }) {
  const cut = useStore((s) => s.cuts[s.currentCutIndex]);
  const commitCut = useStore((s) => s.commitCut);
  const [liveAspect, setLiveAspect] = useState(cut.aspect);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLiveAspect(cut.aspect), [cut.aspect]);

  // 열 너비·높이에 맞춰 원고뷰 크기를 정한다(가로 고정, 세로는 화면비. 넘치면 가로를 줄인다)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const availW = el.clientWidth - 20;
      const availH = el.clientHeight - 20;
      const w = Math.max(40, Math.min(availW, availH / liveAspect));
      setSize({ w, h: w * liveAspect });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [liveAspect]);

  const viewRef = useCallback((el: HTMLDivElement | null) => engine.setViewElement('manuscript', el), [engine]);

  const previewAspect = (a: number) => {
    setLiveAspect(a);
    engine.previewCamera({}, a);
  };
  const commitAspect = (a: number) =>
    commitCut((c) => {
      c.aspect = a;
    });
  const setCamera = (partial: Partial<typeof cut.camera>) =>
    commitCut((c) => {
      c.camera = { ...c.camera, ...partial };
    });

  const presets = {
    eye: () => setCamera({ position: [cut.camera.position[0], 1.5, cut.camera.position[2]], pitch: 0 }),
    high: () => setCamera({ position: [cut.camera.position[0], 2.8, cut.camera.position[2]], pitch: -24 }),
    low: () => setCamera({ position: [cut.camera.position[0], 0.5, cut.camera.position[2]], pitch: 16 }),
  };

  return (
    <section className="manu-col">
      <div className="panel-title">
        <span>원고뷰</span>
        <span className="muted">1 : {liveAspect.toFixed(2)}</span>
      </div>
      <div className="manu-wrap" ref={wrapRef}>
        <div className="manu-view view" ref={viewRef} style={{ width: size.w, height: size.h }}>
          <span className="no-edit">보기 전용 · 돌 조작은 조작뷰에서</span>
        </div>
      </div>
      <div className="camera-panel">
        <div className="row">
          <label className="field" style={{ flex: 1 }}>
            화면비
            <input
              type="range"
              min={1}
              max={2}
              step={0.05}
              value={liveAspect}
              onChange={(e) => previewAspect(Number(e.target.value))}
              onPointerUp={(e) => commitAspect(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => commitAspect(Number((e.target as HTMLInputElement).value))}
            />
            <span className="muted" style={{ width: 44, textAlign: 'right' }}>
              1:{liveAspect.toFixed(2)}
            </span>
          </label>
        </div>
        <div className="row">
          <label className="field">
            화각
            <select value={FOCALS.includes(cut.camera.focalLength) ? cut.camera.focalLength : 'custom'} onChange={(e) => e.target.value !== 'custom' && setCamera({ focalLength: Number(e.target.value) })}>
              {FOCALS.map((f) => (
                <option key={f} value={f}>
                  {f}mm
                </option>
              ))}
              {!FOCALS.includes(cut.camera.focalLength) && <option value="custom">{cut.camera.focalLength}mm</option>}
            </select>
          </label>
          <label className="field">
            높이
            <input className="num" type="number" step={0.1} value={cut.camera.position[1]} onChange={(e) => setCamera({ position: [cut.camera.position[0], Number(e.target.value), cut.camera.position[2]] })} />
            m
          </label>
          <label className="field">
            상하
            <input className="num" type="number" step={1} value={cut.camera.pitch} onChange={(e) => setCamera({ pitch: Number(e.target.value) })} />°
          </label>
        </div>
        <div className="row">
          <label className="field">
            회전
            <input className="num" type="number" step={1} value={cut.camera.yaw} onChange={(e) => setCamera({ yaw: Number(e.target.value) })} />°
          </label>
          <label className="field">
            롤
            <input className="num" type="number" step={1} value={cut.camera.roll} onChange={(e) => setCamera({ roll: Number(e.target.value) })} />°
          </label>
          <span className="presets" style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
            <button onClick={presets.eye} title="아이레벨 1.5m">
              아이레벨
            </button>
            <button onClick={presets.high} title="하이앵글">
              하이
            </button>
            <button onClick={presets.low} title="로우앵글">
              로우
            </button>
          </span>
        </div>
        <div className="row">
          <button onClick={() => engine.copyWorkViewToManuscript()} title="지금 조작뷰에서 보는 시점을 원고 카메라로 복사">
            조작뷰 시점 → 원고 카메라
          </button>
          <button onClick={() => engine.moveWorkViewToManuscript()} title="조작뷰를 원고 카메라 자리로 옮김">
            원고 카메라 → 조작뷰
          </button>
        </div>
      </div>
    </section>
  );
}
