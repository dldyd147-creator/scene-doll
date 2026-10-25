import { useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { Character } from '../model/types';
import { CHARACTER_COLORS, DOLL_ASSETS, mainReferenceOf, sortCharacters } from '../model/defaults';
import { useStore } from '../state/store';
import { endDrag, startDrag } from './dragdrop';
import { Icon } from './icons';
import { PoseTab } from './PoseTab';
import { PropTab } from './PropTab';
import { useRefUrl } from './refImages';
import { saveNow } from './save';
import { SceneTab } from './SceneTab';

type Tab = 'character' | 'doll' | 'prop' | 'pose' | 'scene';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'character', label: '캐릭터' },
  { id: 'doll', label: '돌' },
  { id: 'prop', label: '소품' },
  { id: 'pose', label: '포즈' },
  { id: 'scene', label: '씬' },
];

export function AssetPanel({ engine }: { engine: Engine }) {
  const open = useStore((s) => s.assetPanelOpen);
  const setOpen = useStore((s) => s.setAssetPanelOpen);
  const [tab, setTab] = useState<Tab>('character');

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
        <button className="icon ghost" onClick={() => setOpen(false)} title="에셋 패널 닫기">
          <Icon name="close" size={14} />
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
        {tab === 'character' && <CharacterTab />}
        {tab === 'doll' && <DollTab />}
        {tab === 'prop' && <PropTab engine={engine} />}
        {tab === 'pose' && <PoseTab engine={engine} />}
        {tab === 'scene' && <SceneTab />}
      </div>
    </aside>
  );
}

/** 이 작품의 등록 캐릭터(임시 제외), 역할 순(주인공 → 조연 → 엑스트라) */
function useWorkCharacters(): Character[] {
  return sortCharacters(useStore((s) => s.characters).filter((c) => !c.temporary));
}

function openManager(): void {
  const s = useStore.getState();
  void (s.dirty ? saveNow() : Promise.resolve()).then(() => useStore.getState().setCharacterManagerFor(s.work.code));
}

/** 캐릭터 탭: 이 작품의 캐릭터를 돌로 꺼낸다 + 씬의 돌 */
function CharacterTab() {
  const characters = useWorkCharacters();
  return (
    <>
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="muted small grow" style={{ flex: 1 }}>
          이 작품의 캐릭터 {characters.length}
        </span>
        <button onClick={openManager} title="캐릭터 등록·설명·레퍼런스·돌 지정">
          <Icon name="user" /> 관리
        </button>
      </div>
      {characters.map((c) => (
        <CharacterRow key={c.id} chr={c} />
      ))}
      {characters.length === 0 && <div className="muted small" style={{ padding: '2px' }}>등록된 캐릭터가 없습니다. 관리에서 등록하거나, 돌 탭의 기본 돌을 꺼내 임시 캐릭터로 쓰세요.</div>}
      <SceneDolls />
    </>
  );
}

function CharacterRow({ chr }: { chr: Character }) {
  const workCode = useStore((s) => s.work.code);
  const addCharacterDoll = useStore((s) => s.addCharacterDoll);
  const main = mainReferenceOf(chr);
  const url = useRefUrl(workCode, chr.id, main?.file);
  const doll = DOLL_ASSETS.find((d) => d.id === chr.dollId);
  return (
    <div className="card chr-row-card" title={`${chr.info.oneLine || chr.description || chr.name}\n조작뷰로 끌어다 놓으면 그 자리에 섭니다`} draggable onDragStart={(e) => startDrag(e, { kind: 'character', id: chr.id })} onDragEnd={endDrag}>
      <div className="row">
        <span className="mini-thumb" style={{ borderColor: chr.color }}>
          {url ? <img src={url} alt="" draggable={false} /> : <span className="swatch" style={{ background: chr.color }} />}
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <b>{chr.name}</b>
          </div>
          <div className="sub">
            {doll?.name ?? chr.dollId} · {chr.heightCm}cm · 레퍼런스 {chr.references.length}
          </div>
        </div>
        <button className="primary icon" onClick={() => addCharacterDoll(chr.id)} title="이 캐릭터의 돌을 조작뷰에 추가">
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

/** 돌 탭: 기본은 이 작품의 캐릭터만, 필터를 풀면 기본 돌(남·여·캡슐) */
function DollTab() {
  const [filter, setFilter] = useState<'work' | 'all'>('work');
  const addDoll = useStore((s) => s.addDoll);
  const characters = useWorkCharacters();
  const [heights, setHeights] = useState<Record<string, number>>(() => Object.fromEntries(DOLL_ASSETS.map((d) => [d.id, d.baseHeightCm])));
  return (
    <>
      <div className="segmented" style={{ alignSelf: 'flex-start' }}>
        <button className={filter === 'work' ? 'active' : ''} onClick={() => setFilter('work')} title="이 작품의 캐릭터만(기본 필터)">
          이 작품 캐릭터
        </button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} title="작품과 무관한 기본 돌. 꺼내면 임시 캐릭터가 됩니다">
          기본 돌
        </button>
      </div>
      {filter === 'work' &&
        (characters.length ? (
          characters.map((c) => <CharacterRow key={c.id} chr={c} />)
        ) : (
          <div className="muted small" style={{ padding: '2px' }}>
            등록된 캐릭터가 없습니다. 캐릭터 탭의 관리에서 등록하거나 기본 돌을 꺼내세요.
          </div>
        ))}
      {filter === 'all' &&
        DOLL_ASSETS.filter((d) => !d.hidden).map((d) => (
          <div key={d.id} className="card" title={d.glbPath ? '실제 인체 메시(MakeHuman, CC0). 같은 뼈대라 포즈가 호환됩니다' : '코드로 만든 단순 캡슐 돌(테스트용)'}>
            <div className="row">
              <b className="grow drag-handle" draggable onDragStart={(e) => startDrag(e, { kind: 'doll', dollId: d.id, heightCm: Math.max(50, Math.min(250, heights[d.id] || d.baseHeightCm)) })} onDragEnd={endDrag} title="끌어서 조작뷰에 놓으면 그 자리에 섭니다(임시 캐릭터)">
                {d.name}
              </b>
              <input className="h" type="number" min={50} max={250} value={heights[d.id]} onChange={(e) => setHeights({ ...heights, [d.id]: Number(e.target.value) })} title="키(cm)" />
              <span className="sub">cm</span>
              <button className="primary icon" onClick={() => addDoll(d.id, Math.max(50, Math.min(250, heights[d.id] || d.baseHeightCm)))} title="조작뷰에 추가(임시 캐릭터)">
                <Icon name="plus" />
              </button>
            </div>
          </div>
        ))}
      <SceneDolls />
    </>
  );
}

/** 현재 씬에 있는 돌 목록. 캐릭터를 지정하거나(등록 캐릭터) 임시 캐릭터 이름·색·키를 고친다 */
function SceneDolls() {
  const dolls = useStore((s) => s.cuts[s.currentCutIndex].dolls);
  const characters = useStore((s) => s.characters);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setDollColor = useStore((s) => s.setDollColor);
  const setDollHeight = useStore((s) => s.setDollHeight);
  const renameCharacter = useStore((s) => s.renameCharacter);
  const removeDoll = useStore((s) => s.removeDoll);
  const assignCharacter = useStore((s) => s.assignCharacter);
  const registered = characters.filter((c) => !c.temporary);

  if (!dolls.length) return <div className="muted small" style={{ padding: '4px 2px' }}>씬에 돌이 없습니다.</div>;
  return (
    <>
      <div className="panel-title" style={{ border: 'none', padding: '4px 0 0', minHeight: 0 }}>
        씬의 돌 {dolls.length}
      </div>
      {dolls.map((d) => {
        const chr = characters.find((c) => c.id === d.characterId);
        const selected = selection.dollId === d.id;
        const isRegistered = !!chr && !chr.temporary;
        return (
          <div key={d.id} className={`card ${selected ? 'selected' : ''}`} onClick={() => select({ dollId: d.id, bone: null })}>
            <div className="row">
              <input type="color" value={d.color} onChange={(e) => setDollColor(d.id, e.target.value)} title={isRegistered ? '이 돌만의 색(캐릭터 고정색은 캐릭터 관리에서)' : '구분색'} onClick={(e) => e.stopPropagation()} />
              <select
                className="grow"
                value={isRegistered ? chr.id : ''}
                onChange={(e) => assignCharacter(d.id, e.target.value || null)}
                onClick={(e) => e.stopPropagation()}
                title="이 돌에 지정한 캐릭터. 지정하면 성별 돌·키·고정색이 캐릭터를 따르고 패키지에 레퍼런스가 실립니다"
              >
                <option value="">임시(미지정{chr?.temporary ? `: ${chr.name}` : ''})</option>
                {registered.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="icon ghost danger" onClick={(e) => (e.stopPropagation(), removeDoll(d.id))} title="삭제">
                <Icon name="close" size={14} />
              </button>
            </div>
            {!isRegistered && chr && (
              <div className="row">
                <input type="text" className="grow" value={chr.name} onChange={(e) => renameCharacter(chr.id, e.target.value)} onClick={(e) => e.stopPropagation()} placeholder="임시 캐릭터 이름" spellCheck={false} title="임시 캐릭터 이름(설명 텍스트에 쓰임)" />
              </div>
            )}
            <div className="row">
              <span className="sub grow">{DOLL_ASSETS.find((a) => a.id === d.dollId)?.name ?? d.dollId}</span>
              <input className="h" type="number" min={50} max={250} value={d.heightCm} onChange={(e) => setDollHeight(d.id, Number(e.target.value))} onClick={(e) => e.stopPropagation()} title="키(cm)" />
              <span className="sub">cm</span>
            </div>
            {!isRegistered && (
              <div className="row" onClick={(e) => e.stopPropagation()}>
                {CHARACTER_COLORS.slice(0, 10).map((c) => (
                  <span key={c.hex} className="swatch" style={{ background: c.hex, cursor: 'pointer', outline: d.color.toLowerCase() === c.hex.toLowerCase() ? '2px solid var(--text)' : 'none', outlineOffset: 1 }} title={c.name} onClick={() => setDollColor(d.id, c.hex)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
