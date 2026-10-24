import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { CameraState } from '../model/types';
import { useStore } from '../state/store';
import { DragNumber } from './DragNumber';
import { confirmCurrentCut } from './cuts';

const FOCALS = [24, 28, 35, 50, 85, 135];

/** 원고뷰 + 카메라 패널. 돌 조작은 못 하고 보기·카메라·컷 확정만 한다 */
export function ManuscriptColumn({ engine }: { engine: Engine }) {
  const cut = useStore((s) => s.cuts[s.currentCutIndex]);
  const commitCut = useStore((s) => s.commitCut);
  const setCutMemo = useStore((s) => s.setCutMemo);
  const hasSelection = useStore((s) => !!s.selection.dollId);
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

  const viewRef = useCallback(
    (el: HTMLDivElement | null) => {
      engine.setViewElement('manuscript', el);
      engine.setManuscriptSurface(el);
    },
    [engine],
  );

  const previewAspect = (a: number) => {
    setLiveAspect(a);
    engine.previewCamera({}, a);
  };
  const commitAspect = (a: number) => {
    if (Math.abs(a - cut.aspect) < 1e-6) return;
    commitCut((c) => {
      c.aspect = a;
    });
  };
  const setCamera = (partial: Partial<CameraState>) =>
    commitCut((c) => {
      c.camera = { ...c.camera, ...partial };
    });
  const preview = (partial: Partial<CameraState>) => engine.previewCamera(partial);
  const cam = cut.camera;
  const pos = (i: 0 | 1 | 2, v: number): [number, number, number] => {
    const p: [number, number, number] = [...cam.position];
    p[i] = Math.round(v * 1000) / 1000;
    return p;
  };

  return (
    <section className="manu-col">
      <div className="panel-title">
        <span>
          원고뷰 <span className="muted">컷 {String(cut.number).padStart(3, '0')}</span>
        </span>
        <span className="muted">1 : {liveAspect.toFixed(2)}</span>
      </div>
      <div className="manu-wrap" ref={wrapRef}>
        <div className="manu-view view" ref={viewRef} style={{ width: size.w, height: size.h }} title="드래그: 카메라 궤도 회전 · Shift+드래그: 팬 · 휠: 거리 · Ctrl+휠: 화각">
          <span className="no-edit">보기 전용 · 드래그로 카메라 회전 · 휠로 거리</span>
        </div>
      </div>
      <div className="camera-panel">
        <div className="row">
          <button className={`primary confirm ${cut.confirmed ? 'done' : ''}`} onClick={() => void confirmCurrentCut(engine)} title="현재 컷을 확정하고 다음 컷으로 (Ctrl+Enter)">
            {cut.confirmed ? '재확정' : '컷 확정'} <kbd>Ctrl+Enter</kbd>
          </button>
          <span className="muted small">{cut.confirmed ? '확정됨 · 고치면 재확정' : '작업 중'}</span>
        </div>
        <div className="row">
          <input className="memo" type="text" value={cut.memo} onChange={(e) => setCutMemo(e.target.value)} placeholder="메모(설명 텍스트의 메모 줄에 들어감)" spellCheck={false} />
        </div>
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
            <select value={FOCALS.includes(cam.focalLength) ? cam.focalLength : 'custom'} onChange={(e) => e.target.value !== 'custom' && setCamera({ focalLength: Number(e.target.value) })}>
              {FOCALS.map((f) => (
                <option key={f} value={f}>
                  {f}mm
                </option>
              ))}
              {!FOCALS.includes(cam.focalLength) && <option value="custom">{cam.focalLength}mm</option>}
            </select>
          </label>
          <DragNumber value={cam.focalLength} step={0.5} min={14} max={300} digits={0} unit="mm" width={64} onPreview={(v) => preview({ focalLength: Math.round(v) })} onChange={(v) => setCamera({ focalLength: Math.round(v) })} />
        </div>
        <div className="row">
          <span className="muted">위치</span>
          <DragNumber value={cam.position[0]} step={0.01} digits={2} unit="x" width={66} onPreview={(v) => preview({ position: pos(0, v) })} onChange={(v) => setCamera({ position: pos(0, v) })} />
          <DragNumber value={cam.position[1]} step={0.01} digits={2} unit="높이" width={76} onPreview={(v) => preview({ position: pos(1, v) })} onChange={(v) => setCamera({ position: pos(1, v) })} />
          <DragNumber value={cam.position[2]} step={0.01} digits={2} unit="z" width={66} onPreview={(v) => preview({ position: pos(2, v) })} onChange={(v) => setCamera({ position: pos(2, v) })} />
        </div>
        <div className="row">
          <span className="muted">각도</span>
          <DragNumber value={cam.yaw} step={0.5} digits={1} unit="회전°" width={74} onPreview={(v) => preview({ yaw: v })} onChange={(v) => setCamera({ yaw: Math.round(v * 10) / 10 })} />
          <DragNumber value={cam.pitch} step={0.5} min={-89} max={89} digits={1} unit="상하°" width={74} onPreview={(v) => preview({ pitch: v })} onChange={(v) => setCamera({ pitch: Math.round(v * 10) / 10 })} />
          <DragNumber value={cam.roll} step={0.5} min={-180} max={180} digits={1} unit="롤°" width={66} onPreview={(v) => preview({ roll: v })} onChange={(v) => setCamera({ roll: Math.round(v * 10) / 10 })} />
        </div>
        <div className="row">
          <span className="presets" style={{ display: 'inline-flex', gap: 4 }}>
            <button onClick={() => engine.cameraPreset('eye')} title="아이레벨: 눈높이에서 수평">
              아이레벨
            </button>
            <button onClick={() => engine.cameraPreset('high')} title="하이앵글: 위에서 내려다봄">
              하이
            </button>
            <button onClick={() => engine.cameraPreset('low')} title="로우앵글: 아래에서 올려다봄">
              로우
            </button>
          </span>
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
            <button onClick={() => engine.fitManuscript('all')} title="모든 돌이 프레임에 들어오게 거리 조절">
              전체 맞춤
            </button>
            <button disabled={!hasSelection} onClick={() => engine.fitManuscript('selected')} title="선택한 돌이 프레임에 들어오게">
              선택 맞춤
            </button>
            <button onClick={() => engine.aimManuscriptAtSubject()} title="카메라가 피사체를 바라보게(위치 유지)">
              바라보기
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
