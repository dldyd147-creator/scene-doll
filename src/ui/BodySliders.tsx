import { useCallback, useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { Engine } from '../engine/Engine';
import type { BodyPose, BodySlider } from '../engine/bodyPose';
import { selectCurrentCut, useStore } from '../state/store';

const ZERO: BodyPose = { bend: 0, shoulderUp: { left: 0, right: 0 }, shoulderFwd: { left: 0, right: 0 } };
const corner = new Vector3();
const FOLD_KEY = 'scene-doll.bodySliders.folded';

function loadFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

interface RowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  title: string;
  onChange: (v: number) => void;
  onCommit: () => void;
}

function Row({ label, value, min, max, title, onChange, onCommit }: RowProps) {
  return (
    <div className="body-row" title={title}>
      <label>{label}</label>
      <input type="range" min={min} max={max} step={1} value={Math.round(value)} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} onDoubleClick={() => onChange(0)} />
      <span className="val">{Math.round(value)}°</span>
    </div>
  );
}

/**
 * 몸통 슬라이더: 선택한 돌의 가슴께에 달려 따라다닌다. 허리를 숙이고 펴는 슬라이더와 양 어깨 올림·앞뒤 슬라이더.
 * 값은 상대 조작(끄는 만큼 더 돈다)이라 자세가 튀지 않고, 관절 한계에서 멈추면 슬라이더도 거기서 멈춘다. 더블클릭하면 0(원래 자세)
 */
export function BodySliders({ engine }: { engine: Engine }) {
  const dollId = useStore((s) => s.selection.dollId);
  const dragging = useRef(false);
  const [pose, setPose] = useState<BodyPose>(ZERO);
  const [folded, setFolded] = useState(loadFolded);
  const box = useRef<HTMLDivElement>(null);

  const read = useCallback(() => {
    const rig = dollId ? engine.dolls.get(dollId) : undefined;
    if (rig) setPose(engine.readBodyPose(rig));
  }, [engine, dollId]);

  // 돌을 고르거나 자세가 바뀌면(되돌리기·포즈 적용 등) 값을 새로 읽는다. 슬라이더를 끄는 중에는 건드리지 않는다
  useEffect(() => {
    read();
    return useStore.subscribe(selectCurrentCut, () => {
      if (!dragging.current) read();
    });
  }, [read]);

  // 돌의 가슴께(화면 좌표)를 따라다닌다. 오른쪽으로 비켜 서고, 화면 밖으로 나가지 않게 한다
  useEffect(() => {
    if (!dollId) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = box.current;
      const rig = engine.dolls.get(dollId);
      const parent = el?.parentElement;
      if (!el || !rig || !parent) return;
      const bone = rig.skel.bones.has('Spine2') ? 'Spine2' : rig.skel.order[0];
      const p = rig.worldPos(bone).project(engine.workCamera);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      // 돌의 오른쪽 가장자리(경계 상자 모서리의 화면 최대 x) 바로 옆에 둔다
      const bb = rig.worldBounds();
      let right = ((p.x + 1) / 2) * w;
      for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) right = Math.max(right, ((corner.set(cx, cy, cz).project(engine.workCamera).x + 1) / 2) * w);
      const x = right + 12;
      const y = ((1 - p.y) / 2) * h;
      const maxX = Math.max(8, w - el.offsetWidth - 8);
      const maxY = Math.max(48, h - el.offsetHeight - 8);
      el.style.transform = `translate(${Math.min(maxX, Math.max(8, x))}px, ${Math.min(maxY, Math.max(48, y - el.offsetHeight / 2))}px)`;
      el.style.visibility = p.z > 1 ? 'hidden' : 'visible';
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, dollId]);

  if (!dollId) return null;

  const rig = () => engine.dolls.get(dollId);
  const apply = (slider: BodySlider, current: number, next: number) => {
    const r = rig();
    if (!r) return;
    dragging.current = true;
    engine.nudgeBodyPose(r, slider, next - current);
    setPose(engine.readBodyPose(r));
  };
  const commit = () => {
    dragging.current = false;
    engine.commitDoll(dollId);
    read();
  };
  const toggle = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(FOLD_KEY, next ? '1' : '0');
    } catch {
      /* 저장 불가 환경 */
    }
  };

  return (
    <div className={`body-sliders ${folded ? 'folded' : ''}`} ref={box} onPointerDown={(e) => e.stopPropagation()}>
      <button className="body-fold" onClick={toggle} title={folded ? '몸통 슬라이더 펼치기' : '접기'}>
        {folded ? '몸통 ▸' : '몸통 ▾'}
      </button>
      {!folded && (
        <>
          <Row label="허리" value={pose.bend} min={-40} max={80} title="허리를 숙이고 폅니다(+ 숙임 · − 젖힘). 더블클릭: 곧게" onChange={(v) => apply({ part: 'bend' }, pose.bend, v)} onCommit={commit} />
          <Row label="왼어깨↑" value={pose.shoulderUp.left} min={-20} max={40} title="왼쪽 어깨를 올리고 내립니다. 더블클릭: 0" onChange={(v) => apply({ part: 'shoulderUp', side: 'left' }, pose.shoulderUp.left, v)} onCommit={commit} />
          <Row label="왼어깨→" value={pose.shoulderFwd.left} min={-30} max={30} title="왼쪽 어깨를 앞으로 밀고 뒤로 당깁니다. 더블클릭: 0" onChange={(v) => apply({ part: 'shoulderFwd', side: 'left' }, pose.shoulderFwd.left, v)} onCommit={commit} />
          <Row label="오른어깨↑" value={pose.shoulderUp.right} min={-20} max={40} title="오른쪽 어깨를 올리고 내립니다. 더블클릭: 0" onChange={(v) => apply({ part: 'shoulderUp', side: 'right' }, pose.shoulderUp.right, v)} onCommit={commit} />
          <Row label="오른어깨→" value={pose.shoulderFwd.right} min={-30} max={30} title="오른쪽 어깨를 앞으로 밀고 뒤로 당깁니다. 더블클릭: 0" onChange={(v) => apply({ part: 'shoulderFwd', side: 'right' }, pose.shoulderFwd.right, v)} onCommit={commit} />
        </>
      )}
    </div>
  );
}
