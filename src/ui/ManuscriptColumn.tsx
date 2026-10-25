import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { CameraState } from '../model/types';
import { useStore } from '../state/store';
import { DragNumber } from './DragNumber';
import { Icon } from './icons';
import { confirmCurrentCut } from './cuts';

const FOCALS = [24, 28, 35, 50, 85, 135];
const pad3 = (n: number) => String(n).padStart(3, '0');

/** 원고뷰 + 카메라 패널. 돌 조작은 못 하고 보기·카메라·컷 확정만 한다 */
export function ManuscriptColumn({ engine }: { engine: Engine }) {
  const cut = useStore((s) => s.cuts[s.currentCutIndex]);
  const cutCount = useStore((s) => s.cuts.length);
  const commitCut = useStore((s) => s.commitCut);
  const setCutMemo = useStore((s) => s.setCutMemo);
  const hasSelection = useStore((s) => !!s.selection.dollId);
  const openSceneBrowser = useStore((s) => s.openSceneBrowser);
  const setSceneSaveOpen = useStore((s) => s.setSceneSaveOpen);
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
  /** 위치는 cm로 보여 주고 m로 저장한다 */
  const posCm = (i: 0 | 1 | 2, cmValue: number): [number, number, number] => {
    const p: [number, number, number] = [...cam.position];
    p[i] = Math.round(cmValue) / 100;
    return p;
  };

  return (
    <section className="manu-col">
      <div className="panel-title">
        <span title="현재 컷 / 전체 컷">
          {pad3(cut.number)}/{pad3(cutCount)}
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
            <Icon name="check" /> {cut.confirmed ? '재확정' : '컷 확정'} <kbd>Ctrl+Enter</kbd>
          </button>
          <span className="muted small grow">{cut.confirmed ? '확정됨 · 고치면 재확정' : '작업 중'}</span>
          <button className="icon" onClick={() => setSceneSaveOpen(true)} title="씬 저장: 현재 씬(돌 배치·포즈·카메라·화면비)을 씬 라이브러리에 넣음. 인원·샷·앵글은 자동 태그, 상황 태그는 버튼으로">
            <Icon name="bookmarkPlus" />
          </button>
          <button className="icon" onClick={() => openSceneBrowser()} title="씬 검색기 (`): 저장된 씬을 태그 버튼으로 걸러 불러오고 슬롯마다 캐릭터를 지정해 교체·추가">
            <Icon name="search" />
          </button>
        </div>
        <div className="row">
          <input className="memo" type="text" value={cut.memo} onChange={(e) => setCutMemo(e.target.value)} placeholder="메모(설명 텍스트의 메모 줄)" spellCheck={false} />
        </div>
        <div className="row">
          <span className="label">화면비</span>
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
        </div>
        <div className="row">
          <span className="label">화각</span>
          <select value={FOCALS.includes(cam.focalLength) ? cam.focalLength : 'custom'} onChange={(e) => e.target.value !== 'custom' && setCamera({ focalLength: Number(e.target.value) })}>
            {FOCALS.map((f) => (
              <option key={f} value={f}>
                {f}mm
              </option>
            ))}
            {!FOCALS.includes(cam.focalLength) && <option value="custom">{cam.focalLength}mm</option>}
          </select>
          <DragNumber value={cam.focalLength} step={0.5} min={14} max={300} digits={0} unit="mm" width={64} onPreview={(v) => preview({ focalLength: Math.round(v) })} onChange={(v) => setCamera({ focalLength: Math.round(v) })} />
        </div>
        <div className="row" title="cm 단위. X 좌우, Y 앞뒤, Z 위아래(높이)">
          <span className="label">위치</span>
          <DragNumber value={cam.position[0] * 100} step={1} digits={0} unit="X" width={66} onPreview={(v) => preview({ position: posCm(0, v) })} onChange={(v) => setCamera({ position: posCm(0, v) })} />
          <DragNumber value={cam.position[2] * 100} step={1} digits={0} unit="Y" width={66} onPreview={(v) => preview({ position: posCm(2, v) })} onChange={(v) => setCamera({ position: posCm(2, v) })} />
          <DragNumber value={cam.position[1] * 100} step={1} digits={0} unit="Z↑" width={70} onPreview={(v) => preview({ position: posCm(1, v) })} onChange={(v) => setCamera({ position: posCm(1, v) })} />
        </div>
        <div className="row">
          <span className="label">각도</span>
          <DragNumber value={cam.yaw} step={0.5} digits={1} unit="회전°" width={72} onPreview={(v) => preview({ yaw: v })} onChange={(v) => setCamera({ yaw: Math.round(v * 10) / 10 })} />
          <DragNumber value={cam.pitch} step={0.5} min={-89} max={89} digits={1} unit="상하°" width={72} onPreview={(v) => preview({ pitch: v })} onChange={(v) => setCamera({ pitch: Math.round(v * 10) / 10 })} />
          <DragNumber value={cam.roll} step={0.5} min={-180} max={180} digits={1} unit="롤°" width={64} onPreview={(v) => preview({ roll: v })} onChange={(v) => setCamera({ roll: Math.round(v * 10) / 10 })} />
        </div>
        <div className="row">
          <span className="label">시점</span>
          <button onClick={() => engine.cameraEyeLevel()} title="아이레벨: 선택한 캐릭터의 눈높이(앉아 있으면 앉은 눈높이)에 카메라를 수평으로. 선택이 없으면 첫 돌">
            <Icon name="eyeLevel" /> 아이레벨
          </button>
          <button onClick={() => engine.cameraPov()} title="시점샷(POV): 선택한 캐릭터의 눈에서 머리가 보는 방향으로">
            <Icon name="pov" /> POV
          </button>
          <button className="icon" onClick={() => engine.aimManuscriptAtSubject()} title="카메라가 피사체(선택한 돌)를 바라보게. 위치는 그대로">
            <Icon name="aim" />
          </button>
          <button className="icon" onClick={() => engine.fitManuscript('all')} title="모든 돌이 프레임에 들어오게 거리 조절">
            <Icon name="fitAll" />
          </button>
          <button className="icon" disabled={!hasSelection} onClick={() => engine.fitManuscript('selected')} title="선택한 돌이 프레임에 들어오게">
            <Icon name="focus" />
          </button>
        </div>
        <div className="row copy-row">
          <button className="big" onClick={() => engine.moveWorkViewToManuscript()} title="원고 카메라 → 조작뷰: 왼쪽(원고) 시점을 오른쪽(조작뷰)으로 가져옴">
            <Icon name="toWork" size={18} /> 원고→조작뷰
          </button>
          <button className="big" onClick={() => engine.copyWorkViewToManuscript()} title="조작뷰 시점 → 원고 카메라: 오른쪽(조작뷰) 시점을 왼쪽(원고 카메라)으로 복사">
            조작뷰→원고 <Icon name="toManu" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
