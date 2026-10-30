import { useEffect, useMemo, useState } from 'react';
import { ANGLE_LABEL, SHOT_LABEL } from '../describe/analyze';
import { COUNT_BUCKETS, countLabel, EMPTY_FILTER, filterScenes, hasActiveFilter, type SceneFilter } from '../model/library';
import type { SceneLibraryItem } from '../model/types';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary, useThumb } from './library';
import { startSceneEdit } from './sceneEdit';

/** 에셋 패널 씬 탭: 저장된 씬을 포즈처럼 쭉 나열하고, 제목·인원·태그로 찾는다. 카드를 누르면 슬롯→캐릭터를 지정해 적용하고, 연필로 수정한다 */
export function SceneTab() {
  const scenes = useLibrary((s) => s.scenes);
  const error = useLibrary((s) => s.error);
  const loadScenes = useLibrary((s) => s.loadScenes);
  const deleteScene = useLibrary((s) => s.deleteScene);
  const openBrowser = useStore((s) => s.openSceneBrowser);
  const setSaveOpen = useStore((s) => s.setSceneSaveOpen);
  const settingTags = useStore((s) => s.settings.situationTags);
  const [filter, setFilter] = useState<SceneFilter>(EMPTY_FILTER);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  const allTags = useMemo(() => {
    const set = new Set(settingTags);
    for (const s of scenes ?? []) for (const t of s.situationTags) set.add(t);
    return [...set];
  }, [settingTags, scenes]);
  const shown = useMemo(() => filterScenes(scenes ?? [], filter), [scenes, filter]);

  return (
    <>
      <div className="row" style={{ display: 'flex', gap: 6 }}>
        <button className="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => openBrowser()} title="씬 검색기: 샷·앵글 같은 자세한 조건으로 걸러 보기 (` 키)">
          <Icon name="search" /> 씬 검색기 <kbd>`</kbd>
        </button>
        <button className="icon" onClick={() => setSaveOpen(true)} title="현재 씬을 라이브러리에 저장(자동 태그 + 상황 태그 버튼)">
          <Icon name="bookmarkPlus" />
        </button>
      </div>
      <div className="scene-filter">
        <input type="text" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} placeholder="제목·태그 검색" spellCheck={false} />
        <select
          value={filter.counts[0] ?? ''}
          onChange={(e) => setFilter({ ...filter, counts: e.target.value ? [Number(e.target.value)] : [] })}
          title="인원수로 걸러 보기"
        >
          <option value="">인원 전체</option>
          {COUNT_BUCKETS.map((b) => (
            <option key={b} value={b}>
              {countLabel(b)}인{b >= 4 ? ' 이상' : ''}
            </option>
          ))}
        </select>
        <select value={filter.situations[0] ?? ''} onChange={(e) => setFilter({ ...filter, situations: e.target.value ? [e.target.value] : [] })} title="상황 태그로 걸러 보기">
          <option value="">태그 전체</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="muted small" style={{ flex: 1 }}>
          씬 {scenes ? `${shown.length} / ${scenes.length}` : 0} · 공용/씬
        </span>
        {hasActiveFilter(filter) && (
          <button className="ghost small" onClick={() => setFilter(EMPTY_FILTER)} title="모든 필터 풀기">
            <Icon name="close" size={12} /> 필터 지우기
          </button>
        )}
      </div>
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      {scenes && scenes.length === 0 && <div className="muted small" style={{ padding: '2px' }}>저장된 씬이 없습니다. 위의 책갈피 버튼(또는 원고뷰 아래의 같은 버튼)으로 현재 씬을 저장하세요. 씬은 모든 작품이 함께 씁니다.</div>}
      {scenes && scenes.length > 0 && shown.length === 0 && <div className="muted small">조건에 맞는 씬이 없습니다.</div>}
      <div className="pose-grid">
        {shown.map((it) => (
          <SceneCard
            key={it.id}
            item={it}
            onOpen={() => openBrowser(it.id)}
            onEdit={() => startSceneEdit(it)}
            onDelete={() => {
              if (window.confirm(`씬 '${it.name}'을(를) 라이브러리에서 지울까요?`)) void deleteScene(it.id);
            }}
          />
        ))}
      </div>
    </>
  );
}

function SceneCard({ item, onOpen, onEdit, onDelete }: { item: SceneLibraryItem; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const url = useThumb(item.thumbnail);
  const a = item.autoTags;
  return (
    <div
      className="pose-card"
      onClick={onOpen}
      title={`${item.name}\n${a.count}인 · ${SHOT_LABEL[a.shot]} · ${ANGLE_LABEL[a.angle]}${item.situationTags.length ? `\n${item.situationTags.join(', ')}` : ''}\n클릭: 슬롯마다 캐릭터를 지정해 교체·추가 · 연필: 불러와서 수정`}
    >
      <div className="img">{url ? <img src={url} alt="" draggable={false} /> : <Icon name="gallery" size={22} className="muted" />}</div>
      <div className="cap">
        <b>{item.name}</b>
      </div>
      <div className="cap">
        {a.count}인{item.situationTags.length ? ` · ${item.situationTags.join(' ')}` : ''}
      </div>
      <button
        className="ed"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="씬 수정: 현재 컷에 불러와 고친 뒤 다시 저장"
      >
        <Icon name="edit" size={12} />
      </button>
      <button
        className="rm"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="삭제"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
