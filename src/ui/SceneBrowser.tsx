import { useEffect, useMemo, useState } from 'react';
import type { Character, SceneLibraryItem } from '../model/types';
import { ANGLE_LABEL, SHOT_LABEL } from '../describe/analyze';
import { DOLL_ASSETS } from '../model/defaults';
import { ANGLE_ORDER, autoTagChips, COUNT_BUCKETS, countLabel, EMPTY_FILTER, filterScenes, hasActiveFilter, SHOT_ORDER, type SceneFilter, type SlotAssignments } from '../model/library';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary, useThumb } from './library';

/**
 * 씬 검색기(` 키): 저장된 씬 썸네일 격자 + 태그 버튼 줄(샷·앵글·인원·상황) + 이름 검색.
 * 썸네일을 고르면 미리보기가 커지고 슬롯마다 캐릭터를 지정해 [교체]/[추가]한다.
 */
export function SceneBrowser() {
  const open = useStore((s) => s.sceneBrowserOpen);
  if (!open) return null;
  return <SceneBrowserDialog />;
}

type ListKey = 'shots' | 'angles' | 'counts' | 'situations';

function SceneBrowserDialog() {
  const setOpen = useStore((s) => s.setSceneBrowserOpen);
  const preselect = useStore((s) => s.sceneBrowserSelectId);
  const setSaveOpen = useStore((s) => s.setSceneSaveOpen);
  const settingTags = useStore((s) => s.settings.situationTags);
  const characters = useStore((s) => s.characters);
  const applyLibraryScene = useStore((s) => s.applyLibraryScene);
  const setStatusHint = useStore((s) => s.setStatusHint);
  const scenes = useLibrary((s) => s.scenes);
  const error = useLibrary((s) => s.error);
  const loadScenes = useLibrary((s) => s.loadScenes);
  const deleteScene = useLibrary((s) => s.deleteScene);
  const [filter, setFilter] = useState<SceneFilter>(EMPTY_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(preselect);
  const [assign, setAssign] = useState<SlotAssignments>({});

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  const registered = useMemo(() => characters.filter((c) => !c.temporary), [characters]);
  const items = useMemo(() => filterScenes(scenes ?? [], filter), [scenes, filter]);
  const selected = scenes?.find((s) => s.id === selectedId) ?? null;
  /** 상황 태그 버튼: 설정의 목록 + 저장된 씬에만 있는 태그 */
  const allTags = useMemo(() => {
    const set = new Set(settingTags);
    for (const s of scenes ?? []) for (const t of s.situationTags) set.add(t);
    return [...set];
  }, [settingTags, scenes]);

  const toggle = <K extends ListKey>(key: K, value: SceneFilter[K][number]) =>
    setFilter((f) => {
      const arr = f[key] as Array<SceneFilter[K][number]>;
      return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });
  const choose = (id: string) => {
    if (id === selectedId) return;
    setSelectedId(id);
    setAssign({});
  };
  const apply = (mode: 'replace' | 'add') => {
    if (!selected) return;
    applyLibraryScene(selected, assign, mode);
    setStatusHint(mode === 'replace' ? `씬 '${selected.name}'으로 교체했습니다(카메라·화면비 포함). Ctrl+Z로 되돌릴 수 있습니다` : `씬 '${selected.name}'의 돌 ${selected.slots.length}개를 현재 씬에 추가했습니다`);
  };
  const remove = async () => {
    if (!selected || !window.confirm(`씬 '${selected.name}'을(를) 라이브러리에서 지울까요?`)) return;
    await deleteScene(selected.id);
    setSelectedId(null);
  };

  const tagButton = <K extends ListKey>(key: K, value: SceneFilter[K][number], label: string) => (
    <button key={String(value)} className={`tag ${(filter[key] as unknown[]).includes(value) ? 'active' : ''}`} onClick={() => toggle(key, value)}>
      {label}
    </button>
  );

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal sb" onClick={(e) => e.stopPropagation()}>
        <div className="sb-head">
          <h2>
            씬 검색기 <span className="muted small">{scenes ? `${items.length} / ${scenes.length}` : ''}</span>
          </h2>
          <input type="text" className="sb-search" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} placeholder="이름 검색" autoFocus spellCheck={false} />
          <button
            onClick={() => {
              setOpen(false);
              setSaveOpen(true);
            }}
            title="현재 씬을 라이브러리에 저장"
          >
            <Icon name="bookmarkPlus" /> 씬 저장
          </button>
          <button className="icon ghost" onClick={() => setOpen(false)} title="닫기 (Esc 또는 `)">
            <Icon name="close" />
          </button>
        </div>
        <div className="sb-filters" title="같은 묶음의 버튼은 '또는', 묶음끼리는 '그리고'. 상황 태그는 누른 것을 모두 가진 씬만. 다시 누르면 풀림">
          <div className="tag-row">
            <span className="label">샷</span>
            {SHOT_ORDER.map((v) => tagButton('shots', v, SHOT_LABEL[v]))}
            <span className="sep" />
            <span className="label">앵글</span>
            {ANGLE_ORDER.map((v) => tagButton('angles', v, ANGLE_LABEL[v]))}
            <span className="sep" />
            <span className="label">인원</span>
            {COUNT_BUCKETS.map((b) => tagButton('counts', b, countLabel(b)))}
          </div>
          <div className="tag-row">
            <span className="label">상황</span>
            {allTags.map((t) => tagButton('situations', t, t))}
            {hasActiveFilter(filter) && (
              <button className="ghost small" onClick={() => setFilter(EMPTY_FILTER)} title="모든 필터 풀기">
                <Icon name="close" size={12} /> 필터 지우기
              </button>
            )}
          </div>
        </div>
        <div className="sb-layout">
          <div className="sb-grid">
            {error && <div className="small" style={{ color: 'var(--danger)', gridColumn: '1 / -1' }}>{error}</div>}
            {scenes === null && !error && <div className="muted" style={{ gridColumn: '1 / -1' }}>불러오는 중…</div>}
            {scenes && scenes.length === 0 && <div className="placeholder" style={{ gridColumn: '1 / -1' }}>저장된 씬이 없습니다. 원고뷰 아래의 책갈피 버튼(씬 저장)으로 현재 씬을 넣으세요.</div>}
            {scenes && scenes.length > 0 && items.length === 0 && <div className="placeholder" style={{ gridColumn: '1 / -1' }}>조건에 맞는 씬이 없습니다.</div>}
            {items.map((it) => (
              <SceneTile key={it.id} item={it} selected={it.id === selectedId} onClick={() => choose(it.id)} />
            ))}
          </div>
          <div className="sb-preview">
            {selected ? (
              <ScenePreview item={selected} characters={registered} assign={assign} setAssign={setAssign} onReplace={() => apply('replace')} onAdd={() => apply('add')} onDelete={() => void remove()} />
            ) : (
              <div className="placeholder">썸네일을 고르면 미리보기와 슬롯별 캐릭터 지정이 나옵니다.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneTile({ item, selected, onClick }: { item: SceneLibraryItem; selected: boolean; onClick: () => void }) {
  const url = useThumb(item.thumbnail);
  const a = item.autoTags;
  return (
    <div className={`sb-tile ${selected ? 'selected' : ''}`} onClick={onClick} title={`${item.name}\n${autoTagChips(a).join(' · ')}${item.situationTags.length ? `\n${item.situationTags.join(', ')}` : ''}`}>
      <div className="img">{url ? <img src={url} alt="" draggable={false} /> : <Icon name="gallery" size={22} className="muted" />}</div>
      <div className="cap">
        <b>{item.name}</b>
      </div>
      <div className="cap">
        {a.count}인 · {SHOT_LABEL[a.shot]} · {ANGLE_LABEL[a.angle]}
        {item.situationTags.length ? ` · ${item.situationTags.join(' ')}` : ''}
      </div>
    </div>
  );
}

function ScenePreview({
  item,
  characters,
  assign,
  setAssign,
  onReplace,
  onAdd,
  onDelete,
}: {
  item: SceneLibraryItem;
  characters: Character[];
  assign: SlotAssignments;
  setAssign: (a: SlotAssignments) => void;
  onReplace: () => void;
  onAdd: () => void;
  onDelete: () => void;
}) {
  const url = useThumb(item.thumbnail);
  return (
    <>
      <div className="big">{url ? <img src={url} alt="" draggable={false} /> : <span className="muted">…</span>}</div>
      <div>
        <b>{item.name}</b>
      </div>
      <div className="tag-row">
        {autoTagChips(item.autoTags).map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
        {item.situationTags.map((t) => (
          <span key={t} className="chip situation">
            {t}
          </span>
        ))}
      </div>
      <div className="panel-title" style={{ border: 'none', padding: '2px 0 0', minHeight: 0 }}>
        슬롯 → 캐릭터 <span className="muted" style={{ fontWeight: 400 }}>비우면 임시 캐릭터</span>
      </div>
      {item.slots.length === 0 && <div className="muted small">돌이 없는 씬(카메라·화면비만)</div>}
      {item.slots.map((slot) => {
        const asset = DOLL_ASSETS.find((d) => d.id === slot.dollId);
        const chr = characters.find((c) => c.id === assign[slot.slot]);
        return (
          <div className="slot-row" key={slot.slot}>
            <span className="n">
              <span className="swatch" style={{ background: chr?.color ?? 'transparent', borderStyle: chr ? 'solid' : 'dashed' }} />
              {slot.slot} · {asset?.name ?? slot.dollId}
            </span>
            <select value={assign[slot.slot] ?? ''} onChange={(e) => setAssign({ ...assign, [slot.slot]: e.target.value || null })} title="이 슬롯의 돌에 넣을 캐릭터. 지정하면 그 캐릭터의 성별 돌·키·고정색으로 들어오고, 비우면 임시 캐릭터(저장 당시 돌·키)">
              <option value="">임시 캐릭터{slot.heightCm ? ` · ${slot.heightCm}cm` : ''}</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.heightCm}cm
                </option>
              ))}
            </select>
          </div>
        );
      })}
      {characters.length === 0 && item.slots.length > 0 && <div className="muted small">이 작품에 등록 캐릭터가 없어 모두 임시 캐릭터로 들어옵니다. 캐릭터 관리에서 등록하면 여기서 지정할 수 있습니다.</div>}
      <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 'auto' }}>
        <button className="primary" onClick={onReplace} title="현재 컷의 씬을 이 씬으로 바꿈(돌·소품·카메라·화면비). Ctrl+Z로 되돌림">
          <Icon name="swap" /> 교체
        </button>
        <button onClick={onAdd} disabled={!item.slots.length} title="돌만 현재 씬에 더함(카메라·화면비는 그대로)">
          <Icon name="plus" /> 추가
        </button>
        <span style={{ flex: 1 }} />
        <button className="icon danger" onClick={onDelete} title="라이브러리에서 삭제">
          <Icon name="trash" />
        </button>
      </div>
    </>
  );
}
