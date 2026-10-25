import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { propRestHeight } from '../engine/props';
import type { Hand, PropAsset, PropShape, Quat, Vec3 } from '../model/types';
import { newId } from '../model/ids';
import { parseTagList } from '../model/library';
import { createGlbProp, createPrimitiveProp, DEFAULT_PROP_COLOR, gripFor, HAND_LABEL, normalizeSize, PROP_COLORS, PROP_PRESETS, PROP_SHAPES, propsForWork, sizeLabel } from '../model/props';
import { useStore } from '../state/store';
import { storage } from '../storage';
import { endDrag, startDrag } from './dragdrop';
import { Icon } from './icons';
import { useLibrary, useThumb } from './library';

const THUMB = 160;
const SOLO = 1024;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png'));
}

/** 소품 단독 촬영: 돌과 다른 소품 없이 그 소품만 찍어 출력 폴더에 PNG로 쓴다. 돌려주는 값은 쓴 경로 */
export async function shootPropSolo(engine: Engine, asset: PropAsset, instanceId?: string): Promise<string | null> {
  const canvas = await engine.snapshotProp(instanceId ?? asset, SOLO, SOLO);
  if (!canvas) return null;
  const blob = await canvasToBlob(canvas);
  const s = useStore.getState();
  const name = `소품_${asset.name.replace(/[\\/:*?"<>|]/g, '_')}.png`;
  await storage.repository.writeOutput(s.work.code, s.episode.number, name, blob);
  return `${storage.repository.outputFolder(s.work.code, s.episode.number)}/${name}`;
}

async function propThumbnail(engine: Engine, asset: PropAsset): Promise<string | null> {
  const canvas = await engine.snapshotProp(asset, THUMB, THUMB);
  return canvas ? canvas.toDataURL('image/png') : null;
}

/** 에셋 패널 소품 탭: 등록(기본 도형·GLB)·태그, 씬에 놓기, 선택한 돌의 손에 쥐어 주기, 단독 촬영, 씬의 소품 관리 */
export function PropTab({ engine }: { engine: Engine }) {
  const props = useLibrary((s) => s.props);
  const error = useLibrary((s) => s.error);
  const loadProps = useLibrary((s) => s.loadProps);
  const deleteProp = useLibrary((s) => s.deleteProp);
  const workCode = useStore((s) => s.work.code);
  const selectedDollId = useStore((s) => s.selection.dollId);
  const addProp = useStore((s) => s.addProp);
  const attachProp = useStore((s) => s.attachProp);
  const setStatusHint = useStore((s) => s.setStatusHint);
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState<string | null>(null);

  useEffect(() => {
    void loadProps();
  }, [loadProps]);

  const mine = useMemo(() => propsForWork(props ?? [], workCode), [props, workCode]);
  const tags = useMemo(() => [...new Set(mine.flatMap((p) => p.tags))], [mine]);
  const shown = tag ? mine.filter((p) => p.tags.includes(tag)) : mine;

  const place = (p: PropAsset) => {
    const n = useStore.getState().currentCut().props.length;
    addProp(p.id, [((n % 3) - 1) * 0.4, propRestHeight(p), 0.6]);
    setStatusHint(`${p.name}을(를) 놓았습니다 · 끌거나 G/R로 옮기고, 돌을 고른 뒤 손 버튼으로 쥐어 줍니다`);
  };
  const hold = (p: PropAsset, hand: Hand) => {
    const dollId = useStore.getState().selection.dollId;
    if (!dollId) {
      setStatusHint('먼저 돌을 선택하세요');
      return;
    }
    const id = addProp(p.id);
    attachProp(id, dollId, hand, gripFor(p, hand));
    // 손가락도 쥐기 프리셋으로(손가락 뼈가 있는 돌만)
    engine.applyFingerPreset(hand, 'grip', dollId);
    setStatusHint(`${p.name}을(를) ${HAND_LABEL[hand]}에 쥐어 주었습니다 · 소품을 끌거나 G/R로 쥐는 위치·각도를 맞추고 [쥐기 저장]`);
  };
  const shoot = async (p: PropAsset) => {
    try {
      const path = await shootPropSolo(engine, p);
      setStatusHint(path ? `소품 단독 컷을 저장했습니다: ${path} (출력물 보기에서 확인)` : '촬영하지 못했습니다');
    } catch (e) {
      setStatusHint(`촬영 실패: ${message(e)}`);
    }
  };
  const remove = async (p: PropAsset) => {
    if (!window.confirm(`소품 '${p.name}'을(를) 라이브러리에서 지울까요? 컷에 놓인 것은 보이지 않게 됩니다.`)) return;
    await deleteProp(p.id);
  };

  return (
    <>
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="muted small" style={{ flex: 1 }}>
          소품 {mine.length} · 공용/소품
        </span>
        <button className={adding ? 'active' : 'primary'} onClick={() => setAdding((a) => !a)} title="소품 등록: 기본 도형(검·컵 …) 또는 GLB 파일">
          <Icon name="plus" /> 등록
        </button>
      </div>
      {adding && <PropForm engine={engine} workCode={workCode} onDone={() => setAdding(false)} />}
      {tags.length > 0 && (
        <div className="tag-row">
          <button className={`tag ${tag === null ? 'active' : ''}`} onClick={() => setTag(null)}>
            전체
          </button>
          {tags.map((t) => (
            <button key={t} className={`tag ${tag === t ? 'active' : ''}`} onClick={() => setTag(tag === t ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      {props && mine.length === 0 && <div className="muted small" style={{ padding: '2px' }}>등록된 소품이 없습니다. 등록을 눌러 검·컵 같은 기본 도형이나 GLB 파일을 넣으세요.</div>}
      {!selectedDollId && mine.length > 0 && <div className="muted small">돌을 선택하면 카드의 손 버튼으로 바로 쥐어 줄 수 있습니다. 카드를 조작뷰의 돌 위에 끌어다 놓으면 오른손에 쥡니다.</div>}
      {shown.map((p) => (
        <PropRow key={p.id} prop={p} canHold={!!selectedDollId} onPlace={() => place(p)} onHold={(h) => hold(p, h)} onShoot={() => void shoot(p)} onDelete={() => void remove(p)} />
      ))}
      <SceneProps engine={engine} />
    </>
  );
}

function PropRow({ prop, canHold, onPlace, onHold, onShoot, onDelete }: { prop: PropAsset; canHold: boolean; onPlace: () => void; onHold: (hand: Hand) => void; onShoot: () => void; onDelete: () => void }) {
  const url = useThumb(prop.thumbnail);
  return (
    <div className="card prop-row" draggable onDragStart={(e) => startDrag(e, { kind: 'prop', id: prop.id })} onDragEnd={endDrag} title={`${prop.name} · ${sizeLabel(prop)}${prop.tags.length ? `\n${prop.tags.join(', ')}` : ''}\n조작뷰로 끌어다 놓으면 그 자리에, 돌 위에 놓으면 오른손에 쥡니다`}>
      <div className="row">
        <span className="mini-thumb square">{url ? <img src={url} alt="" draggable={false} /> : <Icon name="package" size={18} className="muted" />}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis">
            <b>{prop.name}</b>
            {prop.workCode && <span className="muted small"> · 이 작품</span>}
          </div>
          <div className="sub ellipsis">
            {sizeLabel(prop)}
            {prop.tags.length ? ` · ${prop.tags.join(' ')}` : ''}
          </div>
        </div>
      </div>
      <div className="row prop-actions">
        <button onClick={onPlace} title="씬에 놓기(자유 배치). 끌거나 G/R로 옮깁니다">
          <Icon name="plus" size={12} /> 놓기
        </button>
        <button disabled={!canHold} onClick={() => onHold('right')} title="선택한 돌의 오른손에 쥐어 주기">
          오른손
        </button>
        <button disabled={!canHold} onClick={() => onHold('left')} title="선택한 돌의 왼손에 쥐어 주기">
          왼손
        </button>
        <span style={{ flex: 1 }} />
        <button className="icon" onClick={onShoot} title="단독 촬영: 돌 없이 소품만 찍어 출력 폴더에 PNG로 저장">
          <Icon name="camera" size={13} />
        </button>
        <button className="icon ghost danger" onClick={onDelete} title="라이브러리에서 삭제">
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}

function PropForm({ engine, workCode, onDone }: { engine: Engine; workCode: string; onDone: () => void }) {
  const saveProp = useLibrary((s) => s.saveProp);
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [shape, setShape] = useState<PropShape>('box');
  const [size, setSize] = useState<Vec3>([0.1, 0.1, 0.1]);
  const [color, setColor] = useState(DEFAULT_PROP_COLOR);
  const [scope, setScope] = useState<'shared' | 'work'>('shared');
  const [glb, setGlb] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dims = PROP_SHAPES.find((s) => s.id === shape)?.dims ?? [];

  const applyPreset = (p: (typeof PROP_PRESETS)[number]) => {
    setName(p.name);
    setShape(p.shape);
    setSize(p.size);
    setTags(p.tags.join(', '));
    setColor(p.color ?? DEFAULT_PROP_COLOR);
    setGlb(null);
  };
  const setDim = (i: number, cm: number) => {
    const next = [...size] as Vec3;
    next[i] = cm / 100;
    setSize(normalizeSize(shape, next));
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const opts = { tags: parseTagList(tags), workCode: scope === 'work' ? workCode : null, color };
      let asset: PropAsset;
      if (glb) {
        const id = newId('prop');
        const path = await storage.repository.savePropModel(id, await glb.arrayBuffer());
        asset = createGlbProp(name || glb.name.replace(/\.glb$/i, ''), path, { ...opts, id });
      } else asset = createPrimitiveProp(name, shape, size, opts);
      const thumb = await propThumbnail(engine, asset).catch(() => null);
      await saveProp(asset, thumb);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pose-form">
      <div className="tag-row" title="프리셋: 이름·도형·크기·태그를 채웁니다. 숫자는 고쳐도 됩니다">
        {PROP_PRESETS.map((p) => (
          <button key={p.name} className="tag" onClick={() => applyPreset(p)}>
            {p.name}
          </button>
        ))}
      </div>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="소품 이름" autoFocus spellCheck={false} />
      <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그(쉼표로 구분: 무기, 생활 …)" spellCheck={false} />
      <div className="row">
        <select
          className="grow"
          value={shape}
          disabled={!!glb}
          onChange={(e) => {
            const s = e.target.value as PropShape;
            setShape(s);
            setSize((cur) => normalizeSize(s, cur));
          }}
          title="기본 도형"
        >
          {PROP_SHAPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className={`icon ${glb ? 'active' : ''}`} onClick={() => fileInput.current?.click()} title="GLB 파일로 등록(m 단위, 원점이 바닥이면 좋음)">
          <Icon name="upload" size={13} />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".glb"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setGlb(f);
            e.target.value = '';
          }}
        />
      </div>
      {glb ? (
        <div className="row">
          <span className="sub ellipsis grow" title={glb.name}>
            GLB: {glb.name}
          </span>
          <button className="icon ghost" onClick={() => setGlb(null)} title="GLB 대신 기본 도형으로">
            <Icon name="close" size={12} />
          </button>
        </div>
      ) : (
        <div className="row" title="크기(cm)">
          {dims.map((label, i) => (
            <label key={label} className="field" style={{ gap: 3 }}>
              <span className="sub">{label}</span>
              <input className="h" type="number" min={0.5} max={500} step={0.5} value={Math.round(size[i] * 1000) / 10} onChange={(e) => setDim(i, Number(e.target.value))} />
            </label>
          ))}
          <span className="sub">cm</span>
        </div>
      )}
      <div className="row">
        {PROP_COLORS.map((c) => (
          <span key={c.hex} className="swatch" style={{ background: c.hex, cursor: 'pointer', outline: color === c.hex ? '2px solid var(--text)' : 'none', outlineOffset: 1 }} title={c.name} onClick={() => setColor(c.hex)} />
        ))}
        <span style={{ flex: 1 }} />
        <span className="segmented">
          <button className={scope === 'shared' ? 'active' : ''} onClick={() => setScope('shared')} title="모든 작품에서 씀">
            공용
          </button>
          <button className={scope === 'work' ? 'active' : ''} onClick={() => setScope('work')} title={`이 작품(${workCode})에서만`}>
            이 작품
          </button>
        </span>
      </div>
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onDone}>취소</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          <Icon name="check" /> 등록
        </button>
      </div>
    </div>
  );
}

/** 현재 씬의 소품: 선택, 어느 손에 쥐는지(자유 배치 ↔ 돌·손), 쥐기 기본값 저장, 빼기 */
function SceneProps({ engine }: { engine: Engine }) {
  const cutProps = useStore((s) => s.cuts[s.currentCutIndex].props);
  const dolls = useStore((s) => s.cuts[s.currentCutIndex].dolls);
  const characters = useStore((s) => s.characters);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const removeProp = useStore((s) => s.removeProp);
  const attachProp = useStore((s) => s.attachProp);
  const setStatusHint = useStore((s) => s.setStatusHint);
  const assets = useLibrary((s) => s.props);
  const saveProp = useLibrary((s) => s.saveProp);
  if (!cutProps.length) return null;
  const dollName = (id: string) => characters.find((c) => c.id === dolls.find((d) => d.id === id)?.characterId)?.name ?? '돌';

  return (
    <>
      <div className="panel-title" style={{ border: 'none', padding: '4px 0 0', minHeight: 0 }}>
        씬의 소품 {cutProps.length}
      </div>
      {cutProps.map((p) => {
        const asset = assets?.find((a) => a.id === p.propId);
        const selected = selection.propId === p.id;
        const value = p.attachedTo ? `${p.attachedTo.dollInstanceId}:${p.attachedTo.hand}` : '';
        return (
          <div key={p.id} className={`card ${selected ? 'selected' : ''}`} onClick={() => select({ dollId: null, bone: null, propId: p.id })}>
            <div className="row">
              <b className="grow ellipsis">{asset?.name ?? '소품(정의 없음)'}</b>
              <select
                value={value}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    engine.detachProp(p.id);
                    return;
                  }
                  const [dollId, hand] = v.split(':') as [string, Hand];
                  attachProp(p.id, dollId, hand, gripFor(asset, hand));
                  engine.applyFingerPreset(hand, 'grip', dollId);
                }}
                title="어느 손에 쥐는지. 자유 배치로 바꾸면 지금 자리에 그대로 놓입니다"
              >
                <option value="">자유 배치</option>
                {dolls.flatMap((d) =>
                  (['right', 'left'] as Hand[]).map((h) => (
                    <option key={`${d.id}:${h}`} value={`${d.id}:${h}`}>
                      {dollName(d.id)} {HAND_LABEL[h]}
                    </option>
                  )),
                )}
              </select>
              <button
                className="icon ghost danger"
                onClick={(e) => {
                  e.stopPropagation();
                  removeProp(p.id);
                }}
                title="씬에서 빼기"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {p.attachedTo && asset && (
              <div className="row">
                <span className="sub grow">소품을 끌거나 G/R로 쥐는 위치·각도를 맞춘 뒤</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const hand = p.attachedTo!.hand;
                    const next: PropAsset = { ...asset, grip: { ...asset.grip, [hand]: { position: [...p.position] as Vec3, rotation: [...p.rotation] as Quat } } };
                    void saveProp(next, null).then(() => setStatusHint(`${asset.name}의 ${HAND_LABEL[hand]} 쥐기를 기본값으로 저장했습니다`));
                  }}
                  title="지금 쥐는 위치·각도를 이 소품의 이 손 기본 쥐기로 저장(다음부터 바로 이 자세로 쥠)"
                >
                  쥐기 저장
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
