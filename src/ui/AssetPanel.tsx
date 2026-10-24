import { useState } from 'react';
import { CHARACTER_COLORS, DOLL_ASSETS } from '../model/defaults';
import { useStore } from '../state/store';

type Tab = 'character' | 'doll' | 'prop' | 'pose' | 'scene';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'character', label: '캐릭터' },
  { id: 'doll', label: '돌' },
  { id: 'prop', label: '소품' },
  { id: 'pose', label: '포즈' },
  { id: 'scene', label: '씬' },
];

export function AssetPanel() {
  const open = useStore((s) => s.assetPanelOpen);
  const setOpen = useStore((s) => s.setAssetPanelOpen);
  const [tab, setTab] = useState<Tab>('doll');

  if (!open) {
    return (
      <aside className="panel asset-panel collapsed">
        <button className="collapse-btn" onClick={() => setOpen(true)} title="에셋 패널 열기">
          ◀ 에셋
        </button>
      </aside>
    );
  }

  return (
    <aside className="panel asset-panel">
      <div className="panel-title">
        <span>에셋</span>
        <button className="icon" onClick={() => setOpen(false)} title="에셋 패널 닫기">
          ▶
        </button>
      </div>
      <div className="asset-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="asset-body">
        {tab === 'doll' && <DollTab />}
        {tab === 'character' && <SceneDolls />}
        {tab === 'prop' && <div className="placeholder">소품 등록·쥐어주기는 3단계에서 제공합니다.</div>}
        {tab === 'pose' && <div className="placeholder">포즈 라이브러리는 2단계에서 제공합니다.</div>}
        {tab === 'scene' && (
          <div className="placeholder">
            씬 라이브러리·씬 검색기(<kbd>`</kbd>)는 2단계에서 제공합니다.
          </div>
        )}
      </div>
    </aside>
  );
}

function DollTab() {
  const addDoll = useStore((s) => s.addDoll);
  const [heights, setHeights] = useState<Record<string, number>>(() => Object.fromEntries(DOLL_ASSETS.map((d) => [d.id, d.baseHeightCm])));
  return (
    <>
      <div className="muted small">내장 돌. 키(cm)를 정하고 추가하면 조작뷰 가운데에 놓입니다. 추가할 때마다 구분색이 자동 배정됩니다.</div>
      {DOLL_ASSETS.map((d) => (
        <div key={d.id} className="card">
          <div className="row">
            <b className="grow">{d.name}</b>
            <span className="muted small">{d.gender === 'male' ? '남' : '여'} · 기준 {d.baseHeightCm}cm</span>
          </div>
          <div className="row">
            <label className="field">
              키
              <input className="h" type="number" min={50} max={250} value={heights[d.id]} onChange={(e) => setHeights({ ...heights, [d.id]: Number(e.target.value) })} />
              cm
            </label>
            <span className="grow" />
            <button className="primary" onClick={() => addDoll(d.gender, Math.max(50, Math.min(250, heights[d.id] || d.baseHeightCm)))}>
              + 조작뷰에 추가
            </button>
          </div>
        </div>
      ))}
      <SceneDolls />
    </>
  );
}

/** 현재 씬에 있는 돌(= 1단계 임시 캐릭터) 목록 */
function SceneDolls() {
  const dolls = useStore((s) => s.cuts[s.currentCutIndex].dolls);
  const characters = useStore((s) => s.characters);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setDollColor = useStore((s) => s.setDollColor);
  const setDollHeight = useStore((s) => s.setDollHeight);
  const renameCharacter = useStore((s) => s.renameCharacter);
  const removeDoll = useStore((s) => s.removeDoll);

  if (!dolls.length) return <div className="muted small">현재 씬에 돌이 없습니다.</div>;
  return (
    <>
      <div className="panel-title" style={{ border: 'none', padding: '4px 0 0' }}>
        현재 씬의 돌 {dolls.length}
      </div>
      {dolls.map((d) => {
        const chr = characters.find((c) => c.id === d.characterId);
        const selected = selection.dollId === d.id;
        return (
          <div key={d.id} className={`card ${selected ? 'selected' : ''}`} onClick={() => select({ dollId: d.id, bone: null })}>
            <div className="row">
              <input type="color" value={d.color} onChange={(e) => setDollColor(d.id, e.target.value)} title="구분색" onClick={(e) => e.stopPropagation()} />
              <input
                type="text"
                className="grow"
                value={chr?.name ?? ''}
                onChange={(e) => chr && renameCharacter(chr.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="임시 캐릭터 이름"
                spellCheck={false}
              />
              <button className="icon danger" onClick={(e) => (e.stopPropagation(), removeDoll(d.id))} title="삭제">
                ✕
              </button>
            </div>
            <div className="row small">
              <span className="muted">{chr?.info.gender === 'female' ? '여' : '남'}</span>
              <label className="field">
                키
                <input className="h" type="number" min={50} max={250} value={d.heightCm} onChange={(e) => setDollHeight(d.id, Number(e.target.value))} onClick={(e) => e.stopPropagation()} />
                cm
              </label>
              <span className="grow" />
              <span style={{ display: 'inline-flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
                {CHARACTER_COLORS.slice(0, 8).map((c) => (
                  <span key={c.hex} className="swatch" style={{ background: c.hex, cursor: 'pointer', outline: d.color.toLowerCase() === c.hex.toLowerCase() ? '2px solid #fff' : 'none' }} title={c.name} onClick={() => setDollColor(d.id, c.hex)} />
                ))}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}
