import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { useStore } from '../state/store';

/** 슬라이더를 끌 때 화면 100px당 허리가 도는 각도 */
const DEG_PER_100PX = 60;
const TRACK = 150;

/**
 * 척추 제어점: 선택한 돌의 가슴께에 상시로 떠 있는 점. 누르면 그 자리에 위아래 반투명 슬라이더가 열린다.
 * 위로 올리면 허리를 뒤로 젖히고, 아래로 내리면 숙인다. 놓으면 손잡이는 가운데로 돌아가고 자세만 남는다(끄는 만큼 더 도는 상대 조작)
 */
export function BodySliders({ engine }: { engine: Engine }) {
  const dollId = useStore((s) => s.selection.dollId);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; lastY: number } | null>(null);

  useEffect(() => setOpen(false), [dollId]);

  // 돌의 가슴께(화면 좌표)를 따라다닌다
  useEffect(() => {
    if (!dollId) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = box.current;
      const rig = engine.dolls.get(dollId);
      const parent = el?.parentElement;
      if (!el || !rig || !parent) return;
      const bone = rig.skel.bones.has('Spine1') ? 'Spine1' : rig.skel.order[0];
      const p = rig.worldPos(bone).project(engine.workCamera);
      const x = ((p.x + 1) / 2) * parent.clientWidth;
      const y = ((1 - p.y) / 2) * parent.clientHeight;
      el.style.transform = `translate(${Math.round(x) + 26}px, ${Math.round(y)}px)`;
      el.style.visibility = p.z > 1 ? 'hidden' : 'visible';
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, dollId]);

  if (!dollId) return null;

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, lastY: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const rig = engine.dolls.get(dollId);
    if (!d || !rig) return;
    const dy = e.clientY - d.lastY;
    d.lastY = e.clientY;
    // 아래로 끌면 숙이고(+) 위로 끌면 젖힌다(−). 관절 한계에서 멈춘다
    engine.nudgeBodyPose(rig, { part: 'bend' }, (dy / 100) * DEG_PER_100PX);
    setOffset(Math.max(-TRACK / 2, Math.min(TRACK / 2, e.clientY - d.startY)));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setOffset(0);
    engine.commitDoll(dollId);
  };

  return (
    <div className="spine-handle" ref={box} onPointerDown={(e) => e.stopPropagation()}>
      {open && (
        <div className="spine-track" style={{ height: TRACK }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title="위로: 허리 젖힘 · 아래로: 숙임">
          <span className="spine-hint up">젖힘</span>
          <span className="spine-hint down">숙임</span>
          <div className="spine-thumb" style={{ transform: `translate(-50%, calc(-50% + ${offset}px))` }} />
        </div>
      )}
      <button className={`spine-dot ${open ? 'active' : ''}`} onClick={() => setOpen((v) => !v)} title="척추 슬라이더(허리 젖힘·숙임) 열기/닫기" />
    </div>
  );
}
