import { useEffect, useRef, useState } from 'react';
import type { Vector3 } from 'three';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';

/** 버튼을 끌 때 화면 100px당 도는 각도 */
const DEG_PER_100PX = 60;
/** 버튼이 따라 움직이는 최대 거리(px) */
const MAX_TRAVEL = 70;

type Kind = 'spine' | 'hip';

/**
 * 척추 제어점: 선택한 돌의 가슴께에 상시로 떠 있는 두 버튼. 누른 채 그대로 끌면 된다(따로 열 것 없음).
 * - 네모(■): 허리를 위로 끌면 뒤로 젖히고, 아래로 끌면 숙인다
 * - 역삼각(▼): 다리는 가만히 두고 상체 전체를 고관절에서 숙이거나 젖힌다(아래로 = 숙임)
 * 놓으면 버튼은 제자리로 돌아오고 자세만 남는다(끄는 만큼 더 도는 상대 조작)
 */
export function BodySliders({ engine }: { engine: Engine }) {
  const dollId = useStore((s) => s.selection.dollId);
  const [active, setActive] = useState<Kind | null>(null);
  const [offset, setOffset] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const hipBox = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: Kind; startY: number; lastY: number; feet: Map<string, Vector3> | null } | null>(null);

  useEffect(() => {
    setActive(null);
    setOffset(0);
    drag.current = null;
  }, [dollId]);

  // 돌의 가슴께(화면 좌표)를 따라다닌다
  useEffect(() => {
    if (!dollId) return;
    let raf = 0;
    const place = (el: HTMLDivElement | null, rig: NonNullable<ReturnType<typeof engine.dolls.get>>, bone: string) => {
      const parent = el?.parentElement;
      if (!el || !parent) return;
      const p = rig.worldPos(bone).project(engine.workCamera);
      const x = ((p.x + 1) / 2) * parent.clientWidth;
      const y = ((1 - p.y) / 2) * parent.clientHeight;
      el.style.transform = `translate(${Math.round(x) + 26}px, ${Math.round(y)}px)`;
      el.style.visibility = p.z > 1 ? 'hidden' : 'visible';
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const rig = engine.dolls.get(dollId);
      if (!rig) return;
      place(box.current, rig, rig.skel.bones.has('Spine1') ? 'Spine1' : rig.skel.order[0]);
      place(hipBox.current, rig, rig.skel.order[0]);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, dollId]);

  if (!dollId) return null;

  const onDown = (kind: Kind) => (e: React.PointerEvent) => {
    e.stopPropagation();
    // 휠클릭·오른쪽 클릭으로는 조작되지 않는다(시점 조작용)
    if (e.button !== 0) return;
    e.preventDefault();
    const rig = engine.dolls.get(dollId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, startY: e.clientY, lastY: e.clientY, feet: kind === 'hip' && rig ? engine.capturePlantedFeet(rig) : null };
    setActive(kind);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const rig = engine.dolls.get(dollId);
    if (!d || !rig) return;
    const dy = e.clientY - d.lastY;
    d.lastY = e.clientY;
    // 아래로 끌면 숙이고(+) 위로 끌면 젖힌다(−). 관절 한계에서 멈춘다
    const deg = (dy / 100) * DEG_PER_100PX;
    if (d.kind === 'spine') engine.nudgeBodyPose(rig, { part: 'bend' }, deg);
    else engine.nudgeHipHinge(rig, deg, d.feet);
    setOffset(Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, e.clientY - d.startY)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setActive(null);
    setOffset(0);
    engine.commitDoll(dollId);
  };
  const move = (kind: Kind) => ({ transform: active === kind ? `translateY(${offset}px)` : undefined });

  return (
    <>
      <div className="spine-handle" ref={box} onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`spine-dot${active === 'spine' ? ' active' : ''}`}
          style={move('spine')}
          onPointerDown={onDown('spine')}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          title="누른 채 위로: 허리 젖힘 · 아래로: 숙임"
        />
      </div>
      <div className="spine-handle" ref={hipBox} onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`spine-hip${active === 'hip' ? ' active' : ''}`}
          style={move('hip')}
          onPointerDown={onDown('hip')}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          title="골반 · 누른 채 아래로: 다리는 그대로 두고 상체 전체를 숙임 · 위로: 젖힘"
        >
          <i />
        </button>
      </div>
    </>
  );
}
