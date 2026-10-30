import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { gripFor, HAND_LABEL } from '../model/props';
import type { Hand, Vec3 } from '../model/types';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary } from './library';

const MIN_PCT = 5;
const MAX_PCT = 2000;

/**
 * 소품 편집 창: 조작뷰의 소품을 더블클릭하면 뜬다. 크기(전체·X·Y·Z), 어느 손에 쥘지(오른손·왼손·놓기)를 고친다.
 * 창은 떠 있고 옮길 수 있어 뒤의 조작뷰를 그대로 만질 수 있다. 값은 입력칸에서 Enter나 칸 밖을 누르면 적용된다.
 */
export function PropEditor({ engine }: { engine: Engine }) {
  const id = useStore((s) => s.propEditId);
  const inst = useStore((s) => (id ? s.currentCut().props.find((p) => p.id === id) : undefined));
  const dolls = useStore((s) => s.currentCut().dolls);
  const selectedDollId = useStore((s) => s.selection.dollId);
  const setPropEdit = useStore((s) => s.setPropEdit);
  const updateProp = useStore((s) => s.updateProp);
  const attachProp = useStore((s) => s.attachProp);
  const removeProp = useStore((s) => s.removeProp);
  const setStatusHint = useStore((s) => s.setStatusHint);
  const asset = useLibrary((s) => s.props?.find((a) => a.id === inst?.propId));
  const [lock, setLock] = useState(true);
  const [draft, setDraft] = useState<string[]>(['100', '100', '100']);
  const [mini, setMini] = useState(false);
  const [pos, setPos] = useState({ x: Math.max(16, window.innerWidth - 560), y: 56 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const scaleKey = inst ? (inst.scale ?? [1, 1, 1]).join(',') : '';
  useEffect(() => {
    if (!inst) return;
    const s = inst.scale ?? [1, 1, 1];
    setDraft(s.map((v) => String(Math.round(v * 1000) / 10)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, scaleKey]);

  // 편집하던 소품이 사라지면 창을 닫는다
  useEffect(() => {
    if (id && !inst) setPropEdit(null);
  }, [id, inst, setPropEdit]);

  if (!id || !inst) return null;

  const setScale = (s: Vec3) => {
    const next = s.map((v) => Math.min(MAX_PCT / 100, Math.max(MIN_PCT / 100, v))) as Vec3;
    updateProp(inst.id, { scale: next[0] === 1 && next[1] === 1 && next[2] === 1 ? undefined : next });
  };
  const current: Vec3 = inst.scale ?? [1, 1, 1];

  /** 칸 i의 입력을 적용한다. 비율 고정이면 나머지 축도 같은 배율로 맞춘다 */
  const commitAxis = (i: number) => {
    const pct = parseFloat(draft[i]);
    if (!Number.isFinite(pct) || pct <= 0) {
      setDraft(current.map((v) => String(Math.round(v * 1000) / 10)));
      return;
    }
    const v = pct / 100;
    if (lock) {
      // 한 축을 바꾸면 그 축의 변화율을 모든 축에 곱한다(축마다 비율이 달라도 그 비율은 유지)
      const ratio = v / (current[i] || 1);
      setScale(current.map((c) => c * ratio) as Vec3);
    } else {
      const n: Vec3 = [...current];
      n[i] = v;
      setScale(n);
    }
  };

  const dollForHand = inst.attachedTo?.dollInstanceId ?? (dolls.some((d) => d.id === selectedDollId) ? selectedDollId : dolls[0]?.id);
  const attach = (hand: Hand) => {
    if (!dollForHand) {
      setStatusHint('쥐어 줄 돌이 없습니다');
      return;
    }
    attachProp(inst.id, dollForHand, hand, gripFor(asset, hand));
    engine.applyFingerPreset(hand, 'grip', dollForHand);
    setStatusHint(`${asset?.name ?? '소품'}을(를) ${HAND_LABEL[hand]}에 붙였습니다 · 끌거나 G/R로 쥐는 위치를 맞추세요`);
  };

  return (
    <div className="hand-win-layer">
      <div className={`modal gen-float prop-edit${mini ? ' mini' : ''}`} style={{ left: pos.x, top: pos.y }}>
        <h2
          className="hand-win-bar"
          title="제목줄을 끌어 창을 옮깁니다. 창이 떠 있는 동안 조작뷰를 만질 수 있습니다"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setPos({ x: Math.min(window.innerWidth - 120, Math.max(-200, e.clientX - d.dx)), y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - d.dy)) });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <Icon name="edit" /> 소품 편집 <span className="muted small">{asset?.name ?? '소품'}</span>
          <span className="grow" />
          <button className="icon ghost" onClick={() => setMini(!mini)} title={mini ? '창 펼치기' : '창 접기'}>
            <Icon name={mini ? 'plus' : 'minus'} />
          </button>
          <button className="icon close-x" onClick={() => setPropEdit(null)} title="닫기">
            <Icon name="close" />
          </button>
        </h2>
        <div className="pose-form" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div className="muted small">크기(%)</div>
            <div className="row" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <label key={axis} className="small" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                  {axis}
                  <input
                    type="number"
                    min={MIN_PCT}
                    max={MAX_PCT}
                    step={5}
                    value={draft[i]}
                    style={{ width: '100%', minWidth: 0 }}
                    onChange={(e) => setDraft(draft.map((d, j) => (j === i ? e.target.value : d)))}
                    onBlur={() => commitAxis(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    title={axis === 'Y' ? 'Y: 소품 자신의 위쪽(세로) 방향' : `${axis}축 크기`}
                  />
                </label>
              ))}
            </div>
            <div className="row" style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> 비율 고정(전체 크기)
              </label>
              <span className="grow" />
              {[50, 75, 100, 150, 200].map((p) => (
                <button key={p} onClick={() => setScale([p / 100, p / 100, p / 100])} title={`전체 ${p}%`}>
                  {p}%
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="muted small">
              손 {inst.attachedTo ? `· 지금 ${HAND_LABEL[inst.attachedTo.hand]}에 쥐고 있음` : '· 지금 자유 배치'}
            </div>
            <div className="row" style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {(['right', 'left'] as Hand[]).map((h) => (
                <button key={h} className={inst.attachedTo?.hand === h ? 'active' : ''} disabled={!dollForHand} onClick={() => attach(h)} title={`${HAND_LABEL[h]}에 붙이기(쥐기 기본값으로)`}>
                  {HAND_LABEL[h]}
                </button>
              ))}
              <button disabled={!inst.attachedTo} onClick={() => engine.detachProp(inst.id)} title="손에서 놓고 지금 자리에 그대로 둡니다">
                놓기
              </button>
            </div>
          </div>
          <div className="row" style={{ display: 'flex', gap: 6 }}>
            <button
              className="danger"
              onClick={() => {
                removeProp(inst.id);
                setPropEdit(null);
              }}
              title="씬에서 빼기"
            >
              씬에서 빼기
            </button>
            <span className="grow" />
            <button onClick={() => setPropEdit(null)}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
