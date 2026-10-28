import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { amountsFromCurl, curlFromAmounts, FINGER_LABEL, FINGER_PRESETS, FINGERS, OPEN_AMOUNTS, type FingerAmounts, type FingerName, type HandPose } from '../model/fingers';
import { newId } from '../model/ids';
import { nowIso } from '../model/defaults';
import type { Hand } from '../model/types';
import { selectCurrentCut, useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary } from './library';

const VIEW = 380;
const POS_KEY = 'scene-doll.handOperator.pos';
/** 손 확대 보기는 손바닥 쪽 정면에 고정한다(돌려 보지 않는다) */
const FRONT = { yaw: 0, pitch: 0 };

function loadPos(): { x: number; y: number } {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return v;
  } catch {
    /* 저장 불가 환경 */
  }
  return { x: Math.max(8, window.innerWidth - 900), y: 70 };
}
const HAND_LABEL: Record<Hand, string> = { left: '왼손', right: '오른손' };

/**
 * 핸드 오퍼레이터: 선택한 돌의 왼손·오른손 손가락 모양을 손 확대 보기와 손가락별 슬라이더로 잡는다.
 * 정면에 고정한 손 하나만 편집하고, 창은 제목줄을 끌어 마음대로 옮긴다(뒤의 조작뷰는 그대로 쓸 수 있다). 기본 프리셋과 저장한 손 모양(공용/손포즈)을 불러오고 저장한다.
 */
export function HandOperator({ engine }: { engine: Engine }) {
  const open = useStore((s) => s.handOperatorOpen);
  const hand = useStore((s) => s.handOperatorHand);
  const setOp = useStore((s) => s.setHandOperator);
  const dollId = useStore((s) => s.selection.dollId);
  const chrName = useStore((s) => {
    const d = s.cuts[s.currentCutIndex].dolls.find((x) => x.id === s.selection.dollId);
    return d ? (s.characters.find((c) => c.id === d.characterId)?.name ?? '돌') : null;
  });
  const setHint = useStore((s) => s.setStatusHint);
  const handPoses = useLibrary((s) => s.handPoses);
  const loadHandPoses = useLibrary((s) => s.loadHandPoses);
  const [amounts, setAmounts] = useState<FingerAmounts>(OPEN_AMOUNTS);
  const [noFingers, setNoFingers] = useState(false);
  const [wrist, setWrist] = useState({ flex: 0, dev: 0, twist: 0 });
  const view = FRONT;
  const [pos, setPos] = useState(loadPos);
  const winDrag = useRef<{ dx: number; dy: number } | null>(null);
  const [name, setName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    if (open) void loadHandPoses();
  }, [open, loadHandPoses]);

  // 열거나 손·돌을 바꾸면 지금 손가락 자세에서 슬라이더 값을 읽어 온다
  useEffect(() => {
    if (!open || !dollId) return;
    const curl = engine.estimateFingerCurl(hand, dollId);
    setNoFingers(!curl);
    setAmounts(curl ? amountsFromCurl(curl) : OPEN_AMOUNTS);
    const rig = engine.dolls.get(dollId);
    setWrist((rig && engine.readWrist(rig, hand)) || { flex: 0, dev: 0, twist: 0 });
  }, [open, hand, dollId, engine]);

  const render = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !dollId) return;
    const src = engine.renderHandView(dollId, hand, view.yaw, view.pitch, cv.width, cv.height);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (src) ctx.drawImage(src, 0, 0);
  }, [engine, dollId, hand, view]);

  const scheduleRender = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(render);
  }, [render]);

  useEffect(() => {
    if (!open) return;
    scheduleRender();
    // 다른 곳에서 자세가 바뀌어도(되돌리기 등) 손 보기를 새로 그린다
    const unsub = useStore.subscribe(selectCurrentCut, () => scheduleRender());
    return () => {
      unsub();
      cancelAnimationFrame(raf.current);
    };
  }, [open, scheduleRender, amounts]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) setOp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOp]);

  if (!open) return null;

  const apply = (next: FingerAmounts, commit: boolean) => {
    setAmounts(next);
    if (dollId) engine.applyFingerCurl(hand, curlFromAmounts(next), { dollId, commit });
    scheduleRender();
  };
  const setWristValue = (key: 'flex' | 'dev' | 'twist', v: number) => {
    const next = { ...wrist, [key]: v };
    setWrist(next);
    const rig = dollId ? engine.dolls.get(dollId) : undefined;
    if (rig) {
      engine.setWrist(rig, hand, next);
      setWrist(engine.readWrist(rig, hand) ?? next);
    }
    scheduleRender();
  };
  const commitNow = () => {
    if (dollId) engine.commitDoll(dollId);
  };
  const setFinger = (f: FingerName, v: number, commit = false) => apply({ ...amounts, [f]: v }, commit);
  const setAll = (v: number, commit = false) => apply({ Thumb: v, Index: v, Middle: v, Ring: v, Pinky: v }, commit);
  const avg = FINGERS.reduce((a, f) => a + amounts[f], 0) / FINGERS.length;

  const applyCurl = (curl: HandPose['curl'], label: string) => {
    if (!dollId) return;
    setAmounts(amountsFromCurl(curl));
    engine.applyFingerCurl(hand, curl, { dollId, commit: true });
    setHint(`${HAND_LABEL[hand]}: ${label}`);
    scheduleRender();
  };

  const save = async () => {
    const pose: HandPose = { id: newId('hpose'), name: name.trim() || `손 모양 ${(handPoses?.length ?? 0) + 1}`, curl: curlFromAmounts(amounts), createdAt: nowIso() };
    try {
      await useLibrary.getState().saveHandPose(pose);
      setName('');
      setHint(`손 모양 '${pose.name}' 저장`);
    } catch (e) {
      setHint(`저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async (p: HandPose) => {
    if (!window.confirm(`손 모양 '${p.name}'을 지울까요?`)) return;
    await useLibrary.getState().deleteHandPose(p.id);
  };

  const mirror = () => {
    if (!dollId) return;
    const other: Hand = hand === 'left' ? 'right' : 'left';
    engine.applyFingerCurl(other, curlFromAmounts(amounts), { dollId, commit: true });
    setHint(`${HAND_LABEL[other]}에도 같은 모양을 넣었습니다`);
  };

  const close = () => setOp(false);

  return (
    <div className="hand-win-layer">
      <div className="modal hand-op" style={{ left: pos.x, top: pos.y }}>
        <h2
          className="hand-win-bar"
          title="제목줄을 끌어 창을 옮깁니다"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            winDrag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = winDrag.current;
            if (!d) return;
            setPos({ x: Math.min(window.innerWidth - 120, Math.max(-600, e.clientX - d.dx)), y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - d.dy)) });
          }}
          onPointerUp={() => {
            if (!winDrag.current) return;
            winDrag.current = null;
            try {
              localStorage.setItem(POS_KEY, JSON.stringify(pos));
            } catch {
              /* 저장 불가 환경 */
            }
          }}
        >
          핸드 오퍼레이터 <span className="muted small">{chrName ?? '돌을 선택하세요'}</span>
          <span className="segmented" style={{ marginLeft: 12 }}>
            <button className={hand === 'left' ? 'active' : ''} onClick={() => setOp(true, 'left')}>
              왼손
            </button>
            <button className={hand === 'right' ? 'active' : ''} onClick={() => setOp(true, 'right')}>
              오른손
            </button>
          </span>
          <button className="icon ghost close-x" onClick={close} title="닫기 (Esc)">
            <Icon name="close" size={16} />
          </button>
        </h2>
        {!dollId && <div className="placeholder">먼저 조작뷰에서 돌을 선택한 뒤 여세요.</div>}
        {dollId && noFingers && <div className="placeholder">이 돌에는 손가락 뼈가 없습니다(캡슐 돌). 기본 돌 남·여를 쓰세요.</div>}
        {dollId && !noFingers && (
          <div className="hand-layout">
            <div className="hand-view">
              <canvas
                ref={canvasRef}
                width={VIEW}
                height={VIEW}
                title="손바닥 쪽 정면에 고정된 보기"
              />
              <div className="muted small">손바닥 정면 고정 · 손은 조작뷰에서 더블클릭해도 열립니다 · 제목줄을 끌어 창을 옮기세요</div>
            </div>
            <div className="hand-controls">
              <h3>손목</h3>
              {([['flex', '굽힘·젖힘', '손목을 손바닥 쪽으로 굽히고 손등 쪽으로 젖힙니다'], ['dev', '좌우 꺾임', '손목을 엄지 쪽·새끼 쪽으로 꺾습니다'], ['twist', '비틀기', '손목을 축 둘레로 비틉니다']] as const).map(([k, label, tip]) => (
                <div className="slider-row" key={k} title={tip}>
                  <label>{label}</label>
                  <input type="range" min={-90} max={90} value={Math.round(wrist[k])} onChange={(e) => setWristValue(k, Number(e.target.value))} onDoubleClick={() => { setWristValue(k, 0); commitNow(); }} onPointerUp={commitNow} onKeyUp={commitNow} />
                  <span className="val">{Math.round(wrist[k])}°</span>
                </div>
              ))}
              <h3>손가락</h3>
              <div className="slider-row">
                <label>전체</label>
                <input type="range" min={0} max={100} value={Math.round(avg * 100)} onChange={(e) => setAll(Number(e.target.value) / 100)} onPointerUp={commitNow} onKeyUp={commitNow} title="다섯 손가락을 한꺼번에" />
                <span className="val">{Math.round(avg * 100)}%</span>
              </div>
              {FINGERS.map((f) => (
                <div className="slider-row" key={f}>
                  <label>{FINGER_LABEL[f]}</label>
                  <input type="range" min={0} max={100} value={Math.round(amounts[f] * 100)} onChange={(e) => setFinger(f, Number(e.target.value) / 100)} onPointerUp={commitNow} onKeyUp={commitNow} />
                  <span className="val">{Math.round(amounts[f] * 100)}%</span>
                </div>
              ))}
              <h3>기본 프리셋</h3>
              <div className="row-wrap">
                {FINGER_PRESETS.map((p) => (
                  <button key={p.id} onClick={() => applyCurl(p.curl, p.label)} title={p.hint}>
                    {p.label}
                  </button>
                ))}
                <button onClick={mirror} title="지금 손 모양을 반대 손에도 넣는다">
                  <Icon name="mirror" /> 반대 손에도
                </button>
              </div>
              <h3>저장한 손 모양 — 지금 슬라이더 값을 이름 붙여 저장하면 어느 돌에나 다시 씁니다</h3>
              <div className="row-wrap">
                <input type="text" className="grow" value={name} placeholder="이름(예: 검 쥐기, 브이)" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} spellCheck={false} />
                <button className="primary" onClick={() => void save()}>
                  <Icon name="save" /> 저장
                </button>
              </div>
              <div className="hand-presets">
                {handPoses === null && <span className="muted small">불러오는 중…</span>}
                {handPoses?.length === 0 && <span className="muted small">아직 저장한 손 모양이 없습니다.</span>}
                {handPoses?.map((p) => (
                  <span className="hand-preset" key={p.id}>
                    <button onClick={() => applyCurl(p.curl, p.name)} title="이 손 모양 적용">
                      {p.name}
                    </button>
                    <button className="icon ghost danger" onClick={() => void remove(p)} title="지우기">
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="actions">
          <button className="primary" onClick={close}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
