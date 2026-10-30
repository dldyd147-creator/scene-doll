import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { parseTagList } from '../model/library';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { useLibrary } from './library';
import { cancelSceneEdit, useSceneEdit } from './sceneEdit';
import { draftSceneFromCurrent, saveSceneDraft } from './scenes';

/**
 * 씬 수정 창: 씬 카드의 연필 버튼으로 연다. 현재 컷에 그 씬을 불러와 두었으니 조작뷰에서 돌·소품·카메라를 고친 뒤
 * '저장(덮어쓰기)' 또는 '새 씬으로 저장'을 누른다. 창은 떠 있고 옮길 수 있다. 취소하면 컷이 불러오기 전으로 돌아간다.
 */
export function SceneEditor({ engine }: { engine: Engine }) {
  const item = useSceneEdit((s) => s.item);
  const settingTags = useStore((s) => s.settings.situationTags);
  const scenes = useLibrary((s) => s.scenes);
  const saveScene = useLibrary((s) => s.saveScene);
  const [name, setName] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  const [pos, setPos] = useState({ x: Math.max(16, window.innerWidth - 560), y: 56 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setTags(item.situationTags);
    setExtra('');
    setError(null);
    setMini(false);
  }, [item]);

  const options = useMemo(() => {
    const set = new Set([...settingTags, ...tags]);
    for (const s of scenes ?? []) for (const t of s.situationTags) set.add(t);
    return [...set];
  }, [settingTags, scenes, tags]);

  if (!item) return null;

  const finalTags = () => [...new Set([...tags, ...parseTagList(extra)])];

  const save = async (overwrite: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const finalName = name.trim() || item.name;
      const draft = draftSceneFromCurrent(engine, finalName, finalTags());
      if (overwrite) {
        const stored = await saveScene({ ...draft.item, id: item.id, name: finalName, situationTags: finalTags(), createdAt: item.createdAt }, draft.thumb);
        useStore.getState().setStatusHint(`씬 '${stored.name}'을(를) 수정해 저장했습니다 (공용/씬)`);
      } else {
        await saveSceneDraft(draft, finalName, finalTags());
      }
      useSceneEdit.getState().end();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    cancelSceneEdit();
    useStore.getState().setStatusHint('씬 수정을 취소하고 컷을 원래대로 되돌렸습니다');
  };

  return (
    <div className="hand-win-layer">
      <div className={`modal gen-float scene-edit${mini ? ' mini' : ''}`} style={{ left: pos.x, top: pos.y }}>
        <h2
          className="hand-win-bar"
          title="제목줄을 끌어 창을 옮깁니다. 창이 떠 있는 동안 조작뷰에서 돌·소품·카메라를 고치세요"
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
          <Icon name="edit" /> 씬 수정 <span className="muted small">{item.name}</span>
          <span className="grow" />
          <button className="icon ghost" onClick={() => setMini(!mini)} title={mini ? '창 펼치기' : '창 접기'}>
            <Icon name={mini ? 'plus' : 'minus'} />
          </button>
          <button className="icon close-x" onClick={cancel} title="취소(컷을 원래대로)">
            <Icon name="close" />
          </button>
        </h2>
        <div className="pose-form" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="muted small">현재 컷에 이 씬을 불러왔습니다. 조작뷰에서 고친 뒤 저장하세요. 인원·샷·앵글 태그는 저장할 때 다시 계산됩니다.</div>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="씬 이름" spellCheck={false} />
          <div className="tag-row">
            {options.map((t) => (
              <button key={t} type="button" className={`tag ${tags.includes(t) ? 'active' : ''}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>
                {t}
              </button>
            ))}
          </div>
          <input type="text" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="상황 태그 직접 추가(쉼표로 구분)" spellCheck={false} />
          {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="row" style={{ display: 'flex', gap: 6 }}>
            <button className="primary" disabled={busy} onClick={() => void save(true)} title="이 씬을 지금 컷의 모습으로 덮어씁니다(썸네일도 다시 찍음)">
              <Icon name="check" /> 저장(덮어쓰기)
            </button>
            <button disabled={busy} onClick={() => void save(false)} title="원래 씬은 두고 새 씬으로 저장합니다">
              새 씬으로 저장
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
