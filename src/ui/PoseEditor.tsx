import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { createPose, DEFAULT_POSE_CATEGORIES, parseTagList } from '../model/library';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary } from './library';
import { cancelPoseEdit, usePoseEdit } from './poseEdit';
import { PosePropsPicker } from './PosePropsPicker';
import { collectPoseProps, posePropCandidates } from './scenes';

const THUMB = { width: 160, height: 200 };

/**
 * 포즈 수정 창: 포즈 카드의 연필 버튼으로 연다. 선택한 돌에 그 포즈를 입혀 두었으니
 * 조작뷰에서 관절·손발·손가락을 미세수정한 뒤 '저장(덮어쓰기)' 또는 '새 포즈로 저장'을 누른다.
 * 창은 떠 있고 옮길 수 있어 뒤의 조작뷰를 그대로 만질 수 있다. 취소하면 돌이 원래 자세로 돌아간다.
 */
export function PoseEditor({ engine }: { engine: Engine }) {
  const pose = usePoseEdit((s) => s.pose);
  const dollId = usePoseEdit((s) => s.dollId);
  const poses = useLibrary((s) => s.poses);
  const savePose = useLibrary((s) => s.savePose);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('일반');
  const [tags, setTags] = useState('');
  const [propIds, setPropIds] = useState<string[]>([]);
  const placed = usePoseEdit((s) => s.placedPropIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  const [pos, setPos] = useState({ x: Math.max(16, window.innerWidth - 560), y: 56 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!pose) return;
    setName(pose.name);
    setCategory(pose.category);
    setTags(pose.tags.join(', '));
    setError(null);
    setMini(false);
  }, [pose]);

  // 소품 체크 기본값: 이 돌이 쥔 소품 + 포즈를 입히며 놓인 소품
  useEffect(() => {
    if (!dollId) return;
    setPropIds(posePropCandidates(dollId).filter((c) => c.held || placed.includes(c.id)).map((c) => c.id));
  }, [dollId, placed, pose]);

  if (!pose || !dollId) return null;

  const options = [...new Set([...(poses ?? []).map((p) => p.category), ...DEFAULT_POSE_CATEGORIES])];

  const save = async (overwrite: boolean) => {
    if (busy) return;
    const rig = engine.dolls.get(dollId);
    if (!rig) {
      setError('돌을 찾을 수 없습니다');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const joints = rig.getJoints();
      const finalName = name.trim() || pose.name;
      const base = overwrite
        ? { ...pose, name: finalName, category: category.trim() || '일반', tags: parseTagList(tags), joints }
        : { ...createPose(finalName, category, parseTagList(tags), joints), groundOnApply: pose.groundOnApply };
      const props = collectPoseProps(engine, dollId, propIds);
      if (props.length) base.props = props;
      else delete base.props;
      const canvas = engine.renderDollSnapshot(dollId, THUMB.width, THUMB.height);
      const stored = await savePose(base, canvas ? canvas.toDataURL('image/png') : null);
      useStore.getState().setStatusHint(`포즈 '${stored.name}'을(를) ${overwrite ? '수정해 저장' : '새로 저장'}했습니다 (공용/포즈)`);
      usePoseEdit.getState().end();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    cancelPoseEdit(engine);
    useStore.getState().setStatusHint('포즈 수정을 취소하고 돌을 원래 자세로 되돌렸습니다');
  };

  return (
    <div className="hand-win-layer">
      <div className={`modal gen-float pose-edit${mini ? ' mini' : ''}`} style={{ left: pos.x, top: pos.y }}>
        <h2
          className="hand-win-bar"
          title="제목줄을 끌어 창을 옮깁니다. 창이 떠 있는 동안 조작뷰에서 돌을 만지세요"
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
          <Icon name="edit" /> 포즈 수정 <span className="muted small">{pose.name}</span>
          <span className="grow" />
          <button className="icon ghost" onClick={() => setMini(!mini)} title={mini ? '창 펼치기' : '창 접기'}>
            <Icon name={mini ? 'plus' : 'minus'} />
          </button>
          <button className="icon close-x" onClick={cancel} title="취소(돌을 원래 자세로)">
            <Icon name="close" />
          </button>
        </h2>
        <div className="pose-form" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="muted small">돌에 이 포즈를 입혀 두었습니다. 조작뷰에서 관절·손발·손가락을 고친 뒤 저장하세요.</div>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="포즈 이름" spellCheck={false} />
          <div className="tag-row">
            {options.map((c) => (
              <button key={c} type="button" className={`tag ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="분류(위에서 고르거나 직접 입력)" spellCheck={false} />
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="태그(쉼표로 구분)" spellCheck={false} />
          <PosePropsPicker dollId={dollId} checked={propIds} onChange={setPropIds} />
          {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="row" style={{ display: 'flex', gap: 6 }}>
            <button className="primary" disabled={busy} onClick={() => void save(true)} title="이 포즈를 지금 자세로 덮어씁니다">
              <Icon name="check" /> 저장(덮어쓰기)
            </button>
            <button disabled={busy} onClick={() => void save(false)} title="원래 포즈는 두고 새 포즈로 저장합니다">
              새 포즈로 저장
            </button>
            <span className="grow" />
            <button disabled={busy} onClick={cancel}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
