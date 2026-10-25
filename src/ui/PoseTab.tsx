import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { Pose } from '../model/types';
import { DEFAULT_POSE_CATEGORIES, parseTagList } from '../model/library';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary, useThumb } from './library';
import { applyPose, savePoseFromSelected } from './scenes';

/** 에셋 패널 포즈 탭: 선택한 돌의 자세를 공용/포즈에 저장하고, 카드를 누르면 선택한 돌에 적용한다(체형과 무관) */
export function PoseTab({ engine }: { engine: Engine }) {
  const poses = useLibrary((s) => s.poses);
  const error = useLibrary((s) => s.error);
  const loadPoses = useLibrary((s) => s.loadPoses);
  const deletePose = useLibrary((s) => s.deletePose);
  const hasDoll = useStore((s) => !!s.selection.dollId);
  const [category, setCategory] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadPoses();
  }, [loadPoses]);

  const categories = useMemo(() => [...new Set((poses ?? []).map((p) => p.category))], [poses]);
  const shown = (poses ?? []).filter((p) => !category || p.category === category);

  return (
    <>
      <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="muted small" style={{ flex: 1 }}>
          포즈 {poses?.length ?? 0} · 공용/포즈
        </span>
        <button className={adding ? 'active' : 'primary'} disabled={!hasDoll} onClick={() => setAdding((a) => !a)} title={hasDoll ? '선택한 돌의 자세를 포즈로 저장' : '먼저 돌을 선택하세요'}>
          <Icon name="plus" /> 저장
        </button>
      </div>
      {adding && hasDoll && <PoseSaveForm engine={engine} categories={categories} onDone={() => setAdding(false)} />}
      {categories.length > 0 && (
        <div className="tag-row">
          <button className={`tag ${category === null ? 'active' : ''}`} onClick={() => setCategory(null)}>
            전체
          </button>
          {categories.map((c) => (
            <button key={c} className={`tag ${category === c ? 'active' : ''}`} onClick={() => setCategory(category === c ? null : c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      {poses && poses.length === 0 && <div className="muted small" style={{ padding: '2px' }}>저장된 포즈가 없습니다. 돌을 선택하고 저장을 누르면 그 자세가 여기에 들어옵니다.</div>}
      {!hasDoll && !!poses?.length && <div className="muted small">돌을 선택하면 카드를 눌러 그 돌에 적용합니다(체형과 무관).</div>}
      <div className="pose-grid">
        {shown.map((p) => (
          <PoseCard
            key={p.id}
            pose={p}
            disabled={!hasDoll}
            onApply={() => applyPose(engine, p)}
            onDelete={() => {
              if (window.confirm(`포즈 '${p.name}'을(를) 지울까요?`)) void deletePose(p.id);
            }}
          />
        ))}
      </div>
    </>
  );
}

function PoseSaveForm({ engine, categories, onDone }: { engine: Engine; categories: string[]; onDone: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('일반');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = [...new Set([...categories, ...DEFAULT_POSE_CATEGORIES])];

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await savePoseFromSelected(engine, name, category, parseTagList(tags));
      if (!p) setError('돌을 먼저 선택하세요');
      else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pose-form">
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="포즈 이름" autoFocus spellCheck={false} />
      <div className="row">
        <input type="text" className="grow" list="pose-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="분류" title="분류(서기·앉기·동작 …). 자유 입력" spellCheck={false} />
        <datalist id="pose-categories">
          {options.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그(쉼표로 구분)" spellCheck={false} />
      {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onDone}>취소</button>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          <Icon name="check" /> 저장
        </button>
      </div>
    </div>
  );
}

function PoseCard({ pose, disabled, onApply, onDelete }: { pose: Pose; disabled: boolean; onApply: () => void; onDelete: () => void }) {
  const url = useThumb(pose.thumbnail);
  return (
    <div className={`pose-card ${disabled ? 'disabled' : ''}`} onClick={() => !disabled && onApply()} title={`${pose.name} · ${pose.category}${pose.tags.length ? `\n${pose.tags.join(', ')}` : ''}\n${disabled ? '돌을 선택하면 클릭해 적용' : '클릭: 선택한 돌에 적용'}`}>
      <div className="img">{url ? <img src={url} alt="" draggable={false} /> : <Icon name="pose" size={28} className="muted" />}</div>
      <div className="cap">
        <b>{pose.name}</b> <span className="muted">{pose.category}</span>
      </div>
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
